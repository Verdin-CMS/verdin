//! Reads and writes documents (docs/architecture.md §8.3, §8.4 and §11).
//!
//! A document with draft & publish has a draft row (`publication_state = 0`) and, once
//! published, a published row (`publication_state = 1`) sharing its `document_id`. Types
//! without draft & publish only have the published row.
//!
//! Relations are rows of link tables (`source_id` → `target_document_id`) owned by one
//! version. Publishing copies the draft's links; reads resolve targets in the matching
//! version, so a published document only ever sees published targets.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value as Json};
use time::OffsetDateTime;
use verdin_db::value::truncate_millis;
use verdin_db::{ColumnKind, Database, DbError, Flavor, SqlValue, Tx};
use verdin_query::sql::{FilterContext, SqlBuilder, write_filter, write_order_by};

use verdin_schema::AttributeKind;

use crate::events::{DocumentEvent, DocumentListener, EventKind};
use verdin_query::{
    Field, FieldCategory, Filter, PageMode, Populate, Query, Sort, Status, SubQuery,
};

use crate::input::{Position, RelationOp, RelationWrite, check_required, prepare};
use crate::locales::Locales;
use crate::output::{OutputOptions, value_to_json};
use crate::{ContentError, Issue, Registry, Result, TypeModel};

const DRAFT: i16 = 0;
const PUBLISHED: i16 = 1;
/// Base table alias in reads.
const BASE: &str = "t0";
/// Largest `IN (…)` list per statement.
pub(crate) const IN_CHUNK: usize = 500;

#[derive(Debug, Clone, Copy, Default)]
pub struct WriteOptions {
    /// Publish after writing (draft & publish types). `false` writes the draft only.
    pub publish: bool,
    /// Admin user performing the write, recorded as `created_by_id` / `updated_by_id`.
    pub actor: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Page {
    pub documents: Vec<Json>,
    pub meta: PageMeta,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum PageMeta {
    #[serde(rename_all = "camelCase")]
    Page {
        page: u64,
        page_size: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        page_count: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total: Option<u64>,
    },
    Offset {
        start: u64,
        limit: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        total: Option<u64>,
    },
}

/// A document being assembled for a response.
struct Doc {
    id: i64,
    document_id: String,
    json: Map<String, Json>,
}

/// Which rows of a table a read selects, besides status and filters.
enum Scope<'a> {
    All,
    Document(&'a str),
    Documents(&'a [String]),
}

type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Clone)]
pub struct DocumentService {
    db: Database,
    registry: Registry,
    output: OutputOptions,
    listeners: Vec<Arc<dyn DocumentListener>>,
    locales: Locales,
    /// The locale requested for localized types (`None`: the default locale).
    locale: Option<String>,
}

impl DocumentService {
    pub fn new(db: Database, registry: Registry, output: OutputOptions) -> Self {
        Self {
            db,
            registry,
            output,
            listeners: Vec::new(),
            locales: Locales::default(),
            locale: None,
        }
    }

    /// Shares the content locales (see [`Locales`]).
    pub fn with_locales(mut self, locales: Locales) -> Self {
        self.locales = locales;
        self
    }

    pub fn locales(&self) -> &Locales {
        &self.locales
    }

    /// The same service, reading and writing localized types in `locale`.
    pub fn in_locale(&self, locale: Option<String>) -> Self {
        Self { locale, ..self.clone() }
    }

    /// The requested locale, or the default one.
    pub fn context_locale(&self) -> String {
        self.locale.clone().unwrap_or_else(|| self.locales.default_code())
    }

    /// The `locale` column value of `model`'s rows for this request: empty for types that
    /// are not localized.
    pub fn locale_of(&self, model: &TypeModel) -> Result<String> {
        if !model.content_type.localized {
            return Ok(String::new());
        }
        let code = self.context_locale();
        if self.locales.contains(&code) {
            Ok(code)
        } else {
            Err(ContentError::BadRequest(format!("unknown locale `{code}`")))
        }
    }

    /// Announces writes to `listener` (see [`DocumentEvent`]).
    pub fn with_listener(mut self, listener: Arc<dyn DocumentListener>) -> Self {
        self.listeners.push(listener);
        self
    }

    async fn emit(&self, kind: EventKind, uid: &str, document_id: &str, actor: Option<i64>) {
        if self.listeners.is_empty() {
            return;
        }
        let locale = self
            .registry
            .get(uid)
            .ok()
            .filter(|model| model.content_type.localized)
            .map(|_| self.context_locale());
        let event = DocumentEvent {
            kind,
            uid: uid.to_owned(),
            document_id: document_id.to_owned(),
            locale,
            actor,
        };
        for listener in &self.listeners {
            listener.notify(&event, self).await;
        }
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    // ---------------------------------------------------------------- reads

    pub async fn find_many(&self, uid: &str, query: &Query) -> Result<Page> {
        let model = self.registry.get(uid)?;
        let fields = public_fields(model, query.fields.as_deref(), &query.populate);
        let state = state_for(model, query.status);
        let page = Some((query.pagination.limit(), query.pagination.offset()));
        let mut docs = self
            .fetch_docs(
                model,
                &fields,
                state,
                Scope::All,
                query.filters.as_ref(),
                query.status,
                &query.sort,
                page,
            )
            .await?;
        self.populate_relations(model, &mut docs, &query.populate, query.status).await?;

        let total = if query.pagination.with_count {
            let mut count = SqlBuilder::new(self.db.flavor());
            count.push("SELECT COUNT(*) FROM ").ident(model.table()).push(" AS ").ident(BASE);
            let (locale, context) = (self.locale_of(model)?, self.context_locale());
            let filter = FilterContext::with_locale(query.status, &context);
            write_scope(&mut count, state, &locale, &Scope::All, query.filters.as_ref(), filter);
            let rows = self
                .db
                .queries()
                .fetch_all(&count.sql, &count.params, &[ColumnKind::BigInt])
                .await?;
            Some(rows.first().and_then(|row| row[0].as_i64()).unwrap_or(0) as u64)
        } else {
            None
        };

        let meta = match query.pagination.mode {
            PageMode::Page { page, page_size } => PageMeta::Page {
                page,
                page_size,
                page_count: total.map(|total| total.div_ceil(page_size)),
                total,
            },
            PageMode::Offset { start, limit } => PageMeta::Offset { start, limit, total },
        };
        Ok(Page { documents: docs.into_iter().map(|doc| Json::Object(doc.json)).collect(), meta })
    }

    pub async fn find_one(
        &self,
        uid: &str,
        document_id: &str,
        query: &Query,
    ) -> Result<Option<Json>> {
        let model = self.registry.get(uid)?;
        let fields = public_fields(model, query.fields.as_deref(), &query.populate);
        let state = state_for(model, query.status);
        let scope = Scope::Document(document_id);
        let mut docs = self
            .fetch_docs(
                model,
                &fields,
                state,
                scope,
                query.filters.as_ref(),
                query.status,
                &[],
                None,
            )
            .await?;
        self.populate_relations(model, &mut docs, &query.populate, query.status).await?;
        Ok(docs.into_iter().next().map(|doc| Json::Object(doc.json)))
    }

    /// The document of a single type, if it exists (any state).
    pub async fn single_document_id(&self, uid: &str) -> Result<Option<String>> {
        let model = self.registry.get(uid)?;
        let mut select = SqlBuilder::new(self.db.flavor());
        select.push("SELECT ").ident("document_id").push(" FROM ").ident(model.table());
        select.push(" ORDER BY ").ident("id").push(" LIMIT 1");
        let rows = self.db.queries().fetch_all(&select.sql, &[], &[ColumnKind::Text]).await?;
        Ok(rows
            .into_iter()
            .next()
            .and_then(|row| row.into_iter().next())
            .and_then(SqlValue::into_text))
    }

    #[allow(clippy::too_many_arguments)]
    async fn fetch_docs(
        &self,
        model: &TypeModel,
        fields: &[&Field],
        state: i16,
        scope: Scope<'_>,
        filters: Option<&Filter>,
        status: Status,
        sort: &[Sort],
        page: Option<(u64, u64)>,
    ) -> Result<Vec<Doc>> {
        let kinds: Vec<ColumnKind> = fields.iter().map(|field| field.kind).collect();
        let chunks: Vec<Scope<'_>> = match scope {
            Scope::Documents([]) => return Ok(Vec::new()),
            Scope::Documents(ids) => ids.chunks(IN_CHUNK).map(Scope::Documents).collect(),
            other => vec![other],
        };
        let (locale, context) = (self.locale_of(model)?, self.context_locale());
        let mut docs = Vec::new();
        for chunk in chunks {
            let mut select = SqlBuilder::new(self.db.flavor());
            write_select(&mut select, model.table(), fields);
            let filter = FilterContext::with_locale(status, &context);
            write_scope(&mut select, state, &locale, &chunk, filters, filter);
            write_order_by(&mut select, sort, Some(BASE));
            if let Some((limit, offset)) = page {
                select.push(" LIMIT ").param(SqlValue::BigInt(to_i64(limit)));
                select.push(" OFFSET ").param(SqlValue::BigInt(to_i64(offset)));
            }
            let rows = self.db.queries().fetch_all(&select.sql, &select.params, &kinds).await?;
            docs.extend(rows.into_iter().map(|row| self.to_doc(fields, row)));
        }
        Ok(docs)
    }

    fn to_doc(&self, fields: &[&Field], row: Vec<SqlValue>) -> Doc {
        let mut json = Map::with_capacity(fields.len());
        let (mut id, mut document_id) = (0, String::new());
        for (field, value) in fields.iter().zip(row) {
            match field.api.as_str() {
                "id" => id = value.as_i64().unwrap_or_default(),
                "documentId" => document_id = value.as_text().unwrap_or_default().to_owned(),
                _ => {}
            }
            let kind = field.attribute.as_ref().map(|attribute| &attribute.kind);
            json.insert(field.api.clone(), value_to_json(kind, value, self.output));
        }
        Doc { id, document_id, json }
    }

    /// Resolves populated relations of `docs`, one batched query per relation and level.
    /// Depth is bounded by the query parser (`max_populate_depth`).
    fn populate_relations<'a>(
        &'a self,
        model: &'a TypeModel,
        docs: &'a mut [Doc],
        populate: &'a [Populate],
        status: Status,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            if docs.is_empty() {
                return Ok(());
            }
            for item in populate {
                let Some(field) = model.fields.get(&item.field) else { continue };
                if field.category == FieldCategory::Nested
                    && let Some(attribute) = &field.attribute
                {
                    self.resolve_references(&attribute.kind, &item.field, docs, status).await?;
                    continue;
                }
                if let Some(info) = &field.media {
                    let ids: Vec<i64> = docs.iter().map(|doc| doc.id).collect();
                    let mut files = crate::media::files_of_sources(&self.db, info, &ids).await?;
                    for doc in docs.iter_mut() {
                        let items: Vec<Json> = files
                            .remove(&doc.id)
                            .unwrap_or_default()
                            .iter()
                            .map(crate::media::FileRecord::to_json)
                            .collect();
                        let value = if info.multiple {
                            Json::Array(items)
                        } else {
                            items.into_iter().next().unwrap_or(Json::Null)
                        };
                        doc.json.insert(item.field.clone(), value);
                    }
                    continue;
                }
                let Some(relation) = &field.relation else { continue };
                let target = self.registry.get(&relation.target)?;
                let default = SubQuery::default();
                let sub = item.query.as_ref().unwrap_or(&default);
                let target_fields = public_fields(target, sub.fields.as_deref(), &sub.populate);
                let target_state = state_for(target, status);

                // Related documents per source row id.
                let mut related: HashMap<i64, Vec<Json>> = HashMap::new();
                if relation.owner {
                    let ids: Vec<i64> = docs.iter().map(|doc| doc.id).collect();
                    let links = self.links_of_sources(&relation.link_table, &ids).await?;
                    let mut wanted: Vec<String> = Vec::new();
                    let mut seen = HashSet::new();
                    for (_, target_id) in &links {
                        if seen.insert(target_id.clone()) {
                            wanted.push(target_id.clone());
                        }
                    }
                    let scope = Scope::Documents(&wanted);
                    let filters = sub.filters.as_ref();
                    let mut targets = self
                        .fetch_docs(
                            target,
                            &target_fields,
                            target_state,
                            scope,
                            filters,
                            status,
                            &sub.sort,
                            None,
                        )
                        .await?;
                    self.populate_relations(target, &mut targets, &sub.populate, status).await?;
                    let order: HashMap<String, usize> = targets
                        .iter()
                        .enumerate()
                        .map(|(index, doc)| (doc.document_id.clone(), index))
                        .collect();
                    let by_document: HashMap<String, Json> = targets
                        .into_iter()
                        .map(|doc| (doc.document_id, Json::Object(doc.json)))
                        .collect();

                    let mut ranked: HashMap<i64, Vec<(usize, Json)>> = HashMap::new();
                    for (position, (source_id, target_id)) in links.into_iter().enumerate() {
                        // Targets missing here are not in the matching version (e.g. unpublished).
                        if let Some(document) = by_document.get(&target_id) {
                            let rank =
                                if sub.sort.is_empty() { position } else { order[&target_id] };
                            ranked.entry(source_id).or_default().push((rank, document.clone()));
                        }
                    }
                    for (source_id, mut items) in ranked {
                        items.sort_by_key(|(rank, _)| *rank);
                        related
                            .insert(source_id, items.into_iter().map(|(_, json)| json).collect());
                    }
                } else {
                    let wanted: Vec<String> =
                        docs.iter().map(|doc| doc.document_id.clone()).collect();
                    let owners = self
                        .fetch_inverse(
                            target,
                            &target_fields,
                            &relation.link_table,
                            &wanted,
                            target_state,
                            sub,
                            status,
                        )
                        .await?;
                    let (keys, mut owner_docs): (Vec<String>, Vec<Doc>) =
                        owners.into_iter().unzip();
                    self.populate_relations(target, &mut owner_docs, &sub.populate, status).await?;
                    let mut by_target: HashMap<String, Vec<Json>> = HashMap::new();
                    for (key, doc) in keys.into_iter().zip(owner_docs) {
                        by_target.entry(key).or_default().push(Json::Object(doc.json));
                    }
                    for doc in docs.iter() {
                        if let Some(items) = by_target.get(&doc.document_id) {
                            related.insert(doc.id, items.clone());
                        }
                    }
                }

                for doc in docs.iter_mut() {
                    let mut items = related.remove(&doc.id).unwrap_or_default();
                    let value = if relation.to_many {
                        Json::Array(items)
                    } else if items.is_empty() {
                        Json::Null
                    } else {
                        items.swap_remove(0)
                    };
                    doc.json.insert(item.field.clone(), value);
                }
            }
            Ok(())
        })
    }

    /// `(source_id, target_document_id)` links of the given source rows, in order.
    async fn links_of_sources(
        &self,
        link_table: &str,
        sources: &[i64],
    ) -> Result<Vec<(i64, String)>> {
        let mut links = Vec::new();
        for chunk in sources.chunks(IN_CHUNK) {
            let mut select = SqlBuilder::new(self.db.flavor());
            select.push("SELECT ").ident("source_id").push(", ").ident("target_document_id");
            select.push(" FROM ").ident(link_table).push(" WHERE ").ident("source_id").push(" IN ");
            write_list(&mut select, chunk.iter().map(|id| SqlValue::BigInt(*id)));
            select
                .push(" ORDER BY ")
                .ident("source_id")
                .push(", ")
                .ident("position")
                .push(", ")
                .ident("id");
            let kinds = [ColumnKind::BigInt, ColumnKind::Text];
            let rows = self.db.queries().fetch_all(&select.sql, &select.params, &kinds).await?;
            links.extend(rows.into_iter().map(|row| {
                let mut row = row.into_iter();
                let source = row.next().and_then(|value| value.as_i64()).unwrap_or_default();
                let target = row.next().and_then(SqlValue::into_text).unwrap_or_default();
                (source, target)
            }));
        }
        Ok(links)
    }

    /// Owner rows linking to any of `targets` (inverse side of a relation), each paired
    /// with the target document id it links to.
    #[allow(clippy::too_many_arguments)]
    async fn fetch_inverse(
        &self,
        owner: &TypeModel,
        fields: &[&Field],
        link_table: &str,
        targets: &[String],
        state: i16,
        sub: &SubQuery,
        status: Status,
    ) -> Result<Vec<(String, Doc)>> {
        let mut kinds = vec![ColumnKind::Text];
        kinds.extend(fields.iter().map(|field| field.kind));
        let mut out = Vec::new();
        for chunk in targets.chunks(IN_CHUNK) {
            let mut select = SqlBuilder::new(self.db.flavor());
            select.push("SELECT ").column(Some("l"), "target_document_id");
            for field in fields {
                select.push(", ").column(Some(BASE), &field.column);
            }
            select.push(" FROM ").ident(link_table).push(" AS ").ident("l");
            select.push(" JOIN ").ident(owner.table()).push(" AS ").ident(BASE).push(" ON ");
            select.column(Some(BASE), "id").push(" = ").column(Some("l"), "source_id");
            select.push(" WHERE ").column(Some("l"), "target_document_id").push(" IN ");
            write_list(&mut select, chunk.iter().map(|id| SqlValue::Text(id.clone())));
            select.push(" AND ").column(Some(BASE), "locale").push(" = ");
            select.param(SqlValue::Text(self.locale_of(owner)?)).push(" AND ");
            select
                .column(Some(BASE), "publication_state")
                .push(" = ")
                .param(SqlValue::SmallInt(state));
            if let Some(filter) = &sub.filters {
                select.push(" AND ");
                let context = self.context_locale();
                write_filter(
                    &mut select,
                    filter,
                    BASE,
                    FilterContext::with_locale(status, &context),
                );
            }
            write_order_by(&mut select, &sub.sort, Some(BASE));
            let rows = self.db.queries().fetch_all(&select.sql, &select.params, &kinds).await?;
            for row in rows {
                let mut row = row.into_iter();
                let key = row.next().and_then(SqlValue::into_text).unwrap_or_default();
                out.push((key, self.to_doc(fields, row.collect())));
            }
        }
        Ok(out)
    }

    // --------------------------------------------------------------- writes

    /// Creates a document and returns its id.
    pub async fn create(&self, uid: &str, data: &Json, options: WriteOptions) -> Result<String> {
        let model = self.registry.get(uid)?;
        let prepared =
            prepare(model, &self.registry.schema, data, true).map_err(ContentError::Validation)?;
        let document_id = ulid::Ulid::generate().to_string().to_lowercase();
        let now = now();
        let draft_and_publish = model.draft_and_publish();
        let state = if draft_and_publish { DRAFT } else { PUBLISHED };

        let mut tx = self.db.begin().await?;
        let mut values: Vec<(String, SqlValue)> = vec![
            ("document_id".into(), SqlValue::Text(document_id.clone())),
            ("locale".into(), SqlValue::Text(self.locale_of(model)?)),
            ("publication_state".into(), SqlValue::SmallInt(state)),
            (
                "published_at".into(),
                if draft_and_publish {
                    SqlValue::Null(ColumnKind::DateTime)
                } else {
                    SqlValue::DateTime(now)
                },
            ),
            ("created_at".into(), SqlValue::DateTime(now)),
            ("updated_at".into(), SqlValue::DateTime(now)),
            ("created_by_id".into(), actor_value(options.actor)),
            ("updated_by_id".into(), actor_value(options.actor)),
        ];
        self.check_references(&mut tx, model, &prepared.columns).await?;
        values.extend(prepared.columns);
        let mut insert = SqlBuilder::new(self.db.flavor());
        write_insert(&mut insert, model.table(), values);
        let id = tx
            .insert_returning_id(&insert.sql, &insert.params)
            .await
            .map_err(|error| db_error(model, error))?;
        self.write_relations(&mut tx, model, id, &document_id, state, &prepared.relations).await?;
        crate::media::write_media(&mut tx, id, &prepared.media).await?;

        if draft_and_publish {
            if options.publish {
                self.publish_in(&mut tx, model, &document_id, now, options.actor).await?;
            }
        } else {
            self.ensure_required(&mut tx, model, &document_id, PUBLISHED).await?;
        }
        tx.commit().await?;
        self.emit(EventKind::Created, uid, &document_id, options.actor).await;
        if draft_and_publish && options.publish {
            self.emit(EventKind::Published, uid, &document_id, options.actor).await;
        }
        Ok(document_id)
    }

    /// Updates the given attributes of a document (its draft, for draft & publish types).
    pub async fn update(
        &self,
        uid: &str,
        document_id: &str,
        data: &Json,
        options: WriteOptions,
    ) -> Result<()> {
        let model = self.registry.get(uid)?;
        let prepared =
            prepare(model, &self.registry.schema, data, false).map_err(ContentError::Validation)?;
        let state = if model.draft_and_publish() { DRAFT } else { PUBLISHED };
        let now = now();

        let locale = self.locale_of(model)?;
        let mut tx = self.db.begin().await?;
        let id = match row_id(&mut tx, model, document_id, state, &locale, true).await? {
            Some(id) => id,
            // A new locale of an existing document.
            None if model.content_type.localized => {
                self.create_locale_version(
                    &mut tx,
                    model,
                    document_id,
                    state,
                    &locale,
                    now,
                    options.actor,
                )
                .await?
            }
            None => return Err(ContentError::NotFound),
        };
        self.check_references(&mut tx, model, &prepared.columns).await?;
        let shared = shared_columns(model, &prepared.columns);
        let mut assignments = prepared.columns;
        assignments.push(("updated_at".into(), SqlValue::DateTime(now)));
        assignments.push(("updated_by_id".into(), actor_value(options.actor)));
        let mut update = SqlBuilder::new(self.db.flavor());
        write_update(&mut update, model.table(), assignments, id);
        tx.execute(&update.sql, &update.params).await.map_err(|error| db_error(model, error))?;
        self.write_relations(&mut tx, model, id, document_id, state, &prepared.relations).await?;
        crate::media::write_media(&mut tx, id, &prepared.media).await?;
        if model.content_type.localized {
            let relations: Vec<RelationWrite> = prepared
                .relations
                .iter()
                .filter(|write| !localized_field(model, &write.field))
                .cloned()
                .collect();
            let media: Vec<crate::input::MediaWrite> = prepared
                .media
                .iter()
                .filter(|write| !localized_field(model, &write.field))
                .cloned()
                .collect();
            for sibling in sibling_rows(&mut tx, model, document_id, state, &locale).await? {
                if !shared.is_empty() {
                    let mut update = SqlBuilder::new(self.db.flavor());
                    write_update(&mut update, model.table(), shared.clone(), sibling);
                    tx.execute(&update.sql, &update.params)
                        .await
                        .map_err(|error| db_error(model, error))?;
                }
                self.write_relations(&mut tx, model, sibling, document_id, state, &relations)
                    .await?;
                crate::media::write_media(&mut tx, sibling, &media).await?;
            }
        }

        if model.draft_and_publish() {
            if options.publish {
                self.publish_in(&mut tx, model, document_id, now, options.actor).await?;
            }
        } else {
            self.ensure_required(&mut tx, model, document_id, PUBLISHED).await?;
        }
        tx.commit().await?;
        self.emit(EventKind::Updated, uid, document_id, options.actor).await;
        if model.draft_and_publish() && options.publish {
            self.emit(EventKind::Published, uid, document_id, options.actor).await;
        }
        Ok(())
    }

    /// Deletes every version of a document, and every link pointing at it.
    pub async fn delete(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.registry.get(uid)?;
        let locale = self.locale_of(model)?;
        let mut tx = self.db.begin().await?;
        let mut delete = SqlBuilder::new(self.db.flavor());
        delete.push("DELETE FROM ").ident(model.table()).push(" WHERE ").ident("document_id");
        delete.push(" = ").param(SqlValue::Text(document_id.into())).push(" AND ");
        delete.ident("locale").push(" = ").param(SqlValue::Text(locale));
        let deleted = tx.execute(&delete.sql, &delete.params).await?;
        if deleted == 0 {
            return Err(ContentError::NotFound);
        }
        // Links pointing at the document go once no locale is left.
        let mut remaining = SqlBuilder::new(self.db.flavor());
        remaining.push("SELECT 1 FROM ").ident(model.table()).push(" WHERE ").ident("document_id");
        remaining.push(" = ").param(SqlValue::Text(document_id.into())).push(" LIMIT 1");
        let gone = !tx.has_rows(&remaining.sql, &remaining.params).await?;
        if gone {
            for link_table in self.registry.incoming_links(uid) {
                let mut delete = SqlBuilder::new(self.db.flavor());
                delete.push("DELETE FROM ").ident(link_table).push(" WHERE ");
                delete.ident("target_document_id").push(" = ");
                delete.param(SqlValue::Text(document_id.into()));
                tx.execute(&delete.sql, &delete.params).await?;
            }
        }
        tx.commit().await?;
        self.emit(EventKind::Deleted, uid, document_id, None).await;
        Ok(())
    }

    /// Copies the draft over the published version (creating it if needed).
    pub async fn publish(&self, uid: &str, document_id: &str, actor: Option<i64>) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let mut tx = self.db.begin().await?;
        self.publish_in(&mut tx, model, document_id, now(), actor).await?;
        tx.commit().await?;
        self.emit(EventKind::Published, uid, document_id, actor).await;
        Ok(())
    }

    /// Removes the published version (its links go with it); the draft stays.
    pub async fn unpublish(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let locale = self.locale_of(model)?;
        let mut tx = self.db.begin().await?;
        row_id(&mut tx, model, document_id, DRAFT, &locale, true)
            .await?
            .ok_or(ContentError::NotFound)?;
        let mut delete = SqlBuilder::new(self.db.flavor());
        delete.push("DELETE FROM ").ident(model.table());
        write_version(&mut delete, PUBLISHED, &locale, document_id);
        tx.execute(&delete.sql, &delete.params).await?;
        tx.commit().await?;
        self.emit(EventKind::Unpublished, uid, document_id, None).await;
        Ok(())
    }

    /// Replaces the draft (fields and links) with the published version.
    pub async fn discard_draft(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let locale = self.locale_of(model)?;
        let mut tx = self.db.begin().await?;
        let draft_id = row_id(&mut tx, model, document_id, DRAFT, &locale, true)
            .await?
            .ok_or(ContentError::NotFound)?;
        let published = load_internal(&mut tx, model, document_id, PUBLISHED, &locale).await?;
        let published = published.ok_or_else(|| {
            ContentError::BadRequest("the document has no published version".into())
        })?;
        let published_id = row_id_of(&published);
        let mut assignments = attribute_values(published);
        assignments.push(("updated_at".into(), SqlValue::DateTime(now())));
        let mut update = SqlBuilder::new(self.db.flavor());
        write_update(&mut update, model.table(), assignments, draft_id);
        tx.execute(&update.sql, &update.params).await?;
        self.copy_links(&mut tx, model, published_id, draft_id, document_id, DRAFT).await?;
        tx.commit().await?;
        self.emit(EventKind::DraftDiscarded, uid, document_id, None).await;
        Ok(())
    }

    fn draft_and_publish_model(&self, uid: &str) -> Result<&TypeModel> {
        let model = self.registry.get(uid)?;
        if !model.draft_and_publish() {
            return Err(ContentError::BadRequest(format!("{uid} does not use draft & publish")));
        }
        Ok(model)
    }

    /// Whether `value` is free for the `uid`/unique attribute `field` (ignoring
    /// `document_id`'s own versions), plus a free suggestion derived from it.
    pub async fn uid_availability(
        &self,
        uid: &str,
        field: &str,
        value: &str,
        document_id: Option<&str>,
    ) -> Result<(bool, String)> {
        let model = self.registry.get(uid)?;
        model
            .content_type
            .attributes
            .get(field)
            .filter(|attribute| matches!(attribute.kind, verdin_schema::AttributeKind::Uid { .. }))
            .ok_or_else(|| ContentError::BadRequest(format!("`{field}` is not a uid attribute")))?;
        let column = verdin_schema::Attribute::column_name(field);
        let locale = self.locale_of(model)?;
        let base = slugify(value);
        let taken = |candidate: String| {
            let mut select = SqlBuilder::new(self.db.flavor());
            select
                .push("SELECT 1 FROM ")
                .ident(model.table())
                .push(" WHERE ")
                .ident(&column)
                .push(" = ");
            select.param(SqlValue::Text(candidate));
            select.push(" AND ").ident("locale").push(" = ").param(SqlValue::Text(locale.clone()));
            if let Some(document_id) = document_id {
                select
                    .push(" AND ")
                    .ident("document_id")
                    .push(" <> ")
                    .param(SqlValue::Text(document_id.into()));
            }
            select.push(" LIMIT 1");
            select
        };
        let exact = taken(value.to_owned());
        let available = !self.db.queries().has_rows(&exact.sql, &exact.params).await?;
        let mut suggestion = base.clone();
        for counter in 1..=100 {
            let query = taken(suggestion.clone());
            if !self.db.queries().has_rows(&query.sql, &query.params).await? {
                break;
            }
            suggestion = format!("{base}-{counter}");
        }
        Ok((available, suggestion))
    }

    /// The admin who created a document (`None` when created through the content API).
    /// `NotFound` if the document does not exist.
    pub async fn created_by(&self, uid: &str, document_id: &str) -> Result<Option<i64>> {
        let model = self.registry.get(uid)?;
        let mut select = SqlBuilder::new(self.db.flavor());
        select.push("SELECT ").ident("created_by_id").push(" FROM ").ident(model.table());
        select.push(" WHERE ").ident("document_id").push(" = ");
        select.param(SqlValue::Text(document_id.into()));
        select
            .push(" ORDER BY ")
            .ident("publication_state")
            .push(", ")
            .ident("id")
            .push(" LIMIT 1");
        let rows =
            self.db.queries().fetch_all(&select.sql, &select.params, &[ColumnKind::BigInt]).await?;
        let row = rows.into_iter().next().ok_or(ContentError::NotFound)?;
        Ok(row[0].as_i64())
    }

    async fn publish_in(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        document_id: &str,
        now: OffsetDateTime,
        actor: Option<i64>,
    ) -> Result<()> {
        let locale = self.locale_of(model)?;
        let draft = load_internal(tx, model, document_id, DRAFT, &locale)
            .await?
            .ok_or(ContentError::NotFound)?;
        let document = internal_json(&draft);
        let draft_id = row_id_of(&draft);
        let mut issues =
            check_required(&self.registry.schema, &model.content_type.attributes, &document, &[]);
        issues.extend(missing_media(tx, model, draft_id).await?);
        if !issues.is_empty() {
            return Err(ContentError::Validation(issues));
        }

        let created_at = draft
            .iter()
            .find(|(field, _)| field.api == "createdAt")
            .map(|(_, value)| value.clone());
        let mut values = attribute_values(draft);
        let shared = shared_columns(model, &values);
        values.push(("published_at".into(), SqlValue::DateTime(now)));
        values.push(("updated_at".into(), SqlValue::DateTime(now)));
        values.push(("updated_by_id".into(), actor_value(actor)));

        let mut statement = SqlBuilder::new(self.db.flavor());
        let published_id = match row_id(tx, model, document_id, PUBLISHED, &locale, true).await? {
            Some(id) => {
                write_update(&mut statement, model.table(), values, id);
                tx.execute(&statement.sql, &statement.params)
                    .await
                    .map_err(|error| db_error(model, error))?;
                id
            }
            None => {
                values.push(("document_id".into(), SqlValue::Text(document_id.into())));
                values.push(("locale".into(), SqlValue::Text(locale.clone())));
                values.push(("publication_state".into(), SqlValue::SmallInt(PUBLISHED)));
                values.push(("created_at".into(), created_at.unwrap_or(SqlValue::DateTime(now))));
                values.push((
                    "created_by_id".into(),
                    actor_value(created_by(tx, model, document_id, &locale).await?),
                ));
                write_insert(&mut statement, model.table(), values);
                tx.insert_returning_id(&statement.sql, &statement.params)
                    .await
                    .map_err(|error| db_error(model, error))?
            }
        };
        self.copy_links(tx, model, draft_id, published_id, document_id, PUBLISHED).await?;
        if model.content_type.localized {
            self.share_published(tx, model, document_id, &locale, &shared, published_id).await?;
        }
        Ok(())
    }

    /// Copies the shared (non-localized) fields of a just published row to the published
    /// versions of the other locales.
    async fn share_published(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        document_id: &str,
        locale: &str,
        shared: &[(String, SqlValue)],
        published_id: i64,
    ) -> Result<()> {
        let is_shared =
            |field: &&Field| field.attribute.as_ref().is_some_and(|attribute| !attribute.localized);
        for sibling in sibling_rows(tx, model, document_id, PUBLISHED, locale).await? {
            if !shared.is_empty() {
                let mut update = SqlBuilder::new(tx.flavor());
                write_update(&mut update, model.table(), shared.to_vec(), sibling);
                tx.execute(&update.sql, &update.params)
                    .await
                    .map_err(|error| db_error(model, error))?;
            }
            let media =
                model.fields.iter().filter(is_shared).filter_map(|field| field.media.as_ref());
            crate::media::copy_media(tx, media, published_id, sibling).await?;
            for relation in model
                .fields
                .iter()
                .filter(is_shared)
                .filter_map(|field| field.relation.as_ref())
                .filter(|relation| relation.owner)
            {
                let links = current_links(tx, &relation.link_table, published_id).await?;
                replace_links(tx, &relation.link_table, sibling, &links).await?;
            }
        }
        Ok(())
    }

    /// Types without draft & publish are always published, so `required` holds on every write.
    async fn ensure_required(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        document_id: &str,
        state: i16,
    ) -> Result<()> {
        let locale = self.locale_of(model)?;
        let row = load_internal(tx, model, document_id, state, &locale)
            .await?
            .ok_or(ContentError::NotFound)?;
        let document = internal_json(&row);
        let mut issues =
            check_required(&self.registry.schema, &model.content_type.attributes, &document, &[]);
        issues.extend(missing_media(tx, model, row_id_of(&row)).await?);
        if issues.is_empty() { Ok(()) } else { Err(ContentError::Validation(issues)) }
    }

    /// Relations and media stored inside components and dynamic zones must point at
    /// existing documents and files of an allowed type.
    async fn check_references(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        columns: &[(String, SqlValue)],
    ) -> Result<()> {
        let schema = &self.registry.schema;
        let mut issues = Vec::new();
        for (name, attribute) in &model.content_type.attributes {
            if !matches!(
                attribute.kind,
                AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. }
            ) {
                continue;
            }
            let column = verdin_schema::Attribute::column_name(name);
            let Some((_, SqlValue::Json(value))) = columns.iter().find(|(c, _)| *c == column)
            else {
                continue;
            };
            for reference in
                crate::refs::collect(schema, &attribute.kind, value, &[Json::from(name.as_str())])
            {
                match &reference.target {
                    crate::refs::Target::Documents { uid } => {
                        let ids: Vec<String> = reference
                            .values
                            .iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect();
                        let table = self.registry.get(uid)?.table().to_owned();
                        let missing = missing_documents(tx, &table, &ids).await?;
                        if !missing.is_empty() {
                            issues.push(crate::refs::issue(
                                &reference.path,
                                format!("related documents do not exist: {}", missing.join(", ")),
                            ));
                        }
                    }
                    crate::refs::Target::Files { allowed } => {
                        let ids: Vec<i64> =
                            reference.values.iter().filter_map(Json::as_i64).collect();
                        let mimes = crate::media::file_mimes(tx, &ids).await?;
                        let missing: Vec<String> = ids
                            .iter()
                            .filter(|id| !mimes.contains_key(id))
                            .map(i64::to_string)
                            .collect();
                        if !missing.is_empty() {
                            issues.push(crate::refs::issue(
                                &reference.path,
                                format!("files do not exist: {}", missing.join(", ")),
                            ));
                        } else if !allowed.is_empty()
                            && ids.iter().any(|id| {
                                !allowed.contains(&verdin_schema::MediaType::of_mime(&mimes[id]))
                            })
                        {
                            let kinds: Vec<&str> = allowed.iter().map(|ty| ty.as_str()).collect();
                            issues.push(crate::refs::issue(
                                &reference.path,
                                format!("only {} are allowed", kinds.join(", ")),
                            ));
                        }
                    }
                }
            }
        }
        if issues.is_empty() { Ok(()) } else { Err(ContentError::Validation(issues)) }
    }

    /// Resolves the references inside a populated component or dynamic zone field, in
    /// batches: related documents in the version being read, and files.
    async fn resolve_references(
        &self,
        kind: &AttributeKind,
        field: &str,
        docs: &mut [Doc],
        status: Status,
    ) -> Result<()> {
        let schema = &self.registry.schema;
        let mut wanted: HashMap<String, Vec<String>> = HashMap::new();
        let mut file_ids: Vec<i64> = Vec::new();
        for doc in docs.iter() {
            let Some(value) = doc.json.get(field) else { continue };
            for reference in crate::refs::collect(schema, kind, value, &[]) {
                match reference.target {
                    crate::refs::Target::Documents { uid } => {
                        let ids = wanted.entry(uid).or_default();
                        ids.extend(
                            reference.values.iter().filter_map(|v| v.as_str().map(str::to_owned)),
                        );
                    }
                    crate::refs::Target::Files { .. } => {
                        file_ids.extend(reference.values.iter().filter_map(Json::as_i64));
                    }
                }
            }
        }
        if wanted.is_empty() && file_ids.is_empty() {
            return Ok(());
        }
        let mut documents: HashMap<(String, String), Json> = HashMap::new();
        for (uid, mut ids) in wanted {
            ids.sort();
            ids.dedup();
            let target = self.registry.get(&uid)?;
            let fields = public_fields(target, None, &[]);
            let found = self
                .fetch_docs(
                    target,
                    &fields,
                    state_for(target, status),
                    Scope::Documents(&ids),
                    None,
                    status,
                    &[],
                    None,
                )
                .await?;
            for doc in found {
                documents.insert((uid.clone(), doc.document_id), Json::Object(doc.json));
            }
        }
        file_ids.sort_unstable();
        file_ids.dedup();
        let files = if file_ids.is_empty() {
            HashMap::new()
        } else {
            crate::media::files_by_ids(&self.db, &file_ids).await?
        };
        for doc in docs.iter_mut() {
            if let Some(value) = doc.json.get_mut(field) {
                crate::refs::substitute(schema, kind, value, &documents, &files);
            }
        }
        Ok(())
    }

    /// Applies relation writes to the links of one row.
    async fn write_relations(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        source_id: i64,
        document_id: &str,
        state: i16,
        writes: &[RelationWrite],
    ) -> Result<()> {
        let mut issues = Vec::new();
        for write in writes {
            let path = vec![Json::from(write.field.as_str())];
            let referenced: Vec<String> = match &write.op {
                RelationOp::Set(ids) => ids.clone(),
                RelationOp::Change { connect, .. } => {
                    connect.iter().map(|item| item.document_id.clone()).collect()
                }
            };
            let missing = missing_documents(tx, &write.info.target_table, &referenced).await?;
            if !missing.is_empty() {
                issues.push(Issue::new(
                    path,
                    format!("related documents do not exist: {}", missing.join(", ")),
                ));
                continue;
            }

            let current = current_links(tx, &write.info.link_table, source_id).await?;
            let links = match next_links(current, &write.op, write.info.to_many) {
                Ok(links) => links,
                Err(message) => {
                    issues.push(Issue::new(path, message));
                    continue;
                }
            };
            replace_links(tx, &write.info.link_table, source_id, &links).await?;
            if write.info.kind.has_unique_target() {
                steal_targets(
                    tx,
                    &write.info.link_table,
                    model.table(),
                    &links,
                    state,
                    document_id,
                )
                .await?;
            }
        }
        if issues.is_empty() { Ok(()) } else { Err(ContentError::Validation(issues)) }
    }

    /// Replaces the links of `to_row` with those of `from_row`, for every owning relation.
    async fn copy_links(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        from_row: i64,
        to_row: i64,
        document_id: &str,
        to_state: i16,
    ) -> Result<()> {
        let media = model.fields.iter().filter_map(|field| field.media.as_ref());
        crate::media::copy_media(tx, media, from_row, to_row).await?;
        let owned = model
            .fields
            .iter()
            .filter_map(|field| field.relation.as_ref())
            .filter(|relation| relation.owner);
        for relation in owned {
            let links = current_links(tx, &relation.link_table, from_row).await?;
            replace_links(tx, &relation.link_table, to_row, &links).await?;
            if relation.kind.has_unique_target() {
                steal_targets(
                    tx,
                    &relation.link_table,
                    model.table(),
                    &links,
                    to_state,
                    document_id,
                )
                .await?;
            }
        }
        Ok(())
    }
}

/// The links a relation write produces, in order.
fn next_links(
    current: Vec<String>,
    op: &RelationOp,
    to_many: bool,
) -> std::result::Result<Vec<String>, String> {
    let mut links = match op {
        RelationOp::Set(ids) => {
            let mut seen = HashSet::new();
            ids.iter().filter(|id| seen.insert((*id).clone())).cloned().collect()
        }
        RelationOp::Change { connect, disconnect } => {
            let mut links: Vec<String> =
                current.into_iter().filter(|id| !disconnect.contains(id)).collect();
            for item in connect {
                let present = links.iter().position(|id| *id == item.document_id);
                match (present, &item.position) {
                    (Some(_), None) => continue,
                    (Some(index), Some(_)) => {
                        links.remove(index);
                    }
                    (None, _) => {}
                }
                let index = match &item.position {
                    None | Some(Position::End) => links.len(),
                    Some(Position::Start) => 0,
                    Some(Position::Before(reference) | Position::After(reference)) => {
                        let index =
                            links.iter().position(|id| id == reference).ok_or_else(|| {
                                format!("position reference `{reference}` is not connected")
                            })?;
                        if matches!(item.position, Some(Position::After(_))) {
                            index + 1
                        } else {
                            index
                        }
                    }
                };
                links.insert(index, item.document_id.clone());
            }
            links
        }
    };
    if !to_many && links.len() > 1 {
        // Connecting to a to-one relation replaces the current target.
        links = links.split_off(links.len() - 1);
    }
    Ok(links)
}

/// `Hola Verdín!` → `hola-verdin`: lowercase ASCII letters and digits joined by dashes.
pub fn slugify(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars().flat_map(fold_accent) {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_owned()
}

fn fold_accent(c: char) -> impl Iterator<Item = char> {
    let folded = match c {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' | 'Á' | 'À' | 'Ä' | 'Â' | 'Ã' | 'Å' => "a",
        'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => "e",
        'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => "i",
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'Ó' | 'Ò' | 'Ö' | 'Ô' | 'Õ' => "o",
        'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => "u",
        'ñ' | 'Ñ' => "n",
        'ç' | 'Ç' => "c",
        'ß' => "ss",
        _ => "",
    };
    let mut buffer = [0u8; 4];
    let own: String =
        if folded.is_empty() { c.encode_utf8(&mut buffer).to_owned() } else { folded.to_owned() };
    own.chars().collect::<Vec<_>>().into_iter()
}

/// `required` media fields without files on row `id`.
async fn missing_media(tx: &mut Tx, model: &TypeModel, id: i64) -> Result<Vec<Issue>> {
    let mut issues = Vec::new();
    for field in model.fields.iter() {
        let (Some(info), Some(attribute)) = (&field.media, &field.attribute) else { continue };
        if attribute.required && crate::media::media_count(tx, &info.link_table, id).await? == 0 {
            issues.push(Issue::new(
                vec![Json::from(field.api.as_str())],
                format!("{} is a required field", field.api),
            ));
        }
    }
    Ok(issues)
}

impl DocumentService {
    /// Adds `locale` to an existing document: a new row sharing the document id, holding
    /// the values of the non-localized fields of another locale.
    #[allow(clippy::too_many_arguments)]
    async fn create_locale_version(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        document_id: &str,
        state: i16,
        locale: &str,
        now: OffsetDateTime,
        actor: Option<i64>,
    ) -> Result<i64> {
        let mut select = SqlBuilder::new(tx.flavor());
        select.push("SELECT ").ident("locale").push(" FROM ").ident(model.table());
        select.push(" WHERE ").ident("document_id").push(" = ");
        select.param(SqlValue::Text(document_id.into()));
        select
            .push(" ORDER BY ")
            .ident("publication_state")
            .push(", ")
            .ident("id")
            .push(" LIMIT 1");
        let rows = tx.fetch_all(&select.sql, &select.params, &[ColumnKind::Text]).await?;
        let source_locale = rows
            .into_iter()
            .next()
            .and_then(|row| row.into_iter().next())
            .and_then(SqlValue::into_text)
            .ok_or(ContentError::NotFound)?;
        // Prefer the source's version in the same state (the draft, usually).
        let source = match load_internal(tx, model, document_id, state, &source_locale).await? {
            Some(row) => row,
            None => load_internal(tx, model, document_id, PUBLISHED, &source_locale)
                .await?
                .ok_or(ContentError::NotFound)?,
        };
        let source_id = row_id_of(&source);
        let mut values: Vec<(String, SqlValue)> = source
            .into_iter()
            .filter(|(field, _)| {
                field.attribute.as_ref().is_some_and(|attribute| !attribute.localized)
            })
            .map(|(field, value)| (field.column.clone(), value))
            .collect();
        values.extend([
            ("document_id".into(), SqlValue::Text(document_id.into())),
            ("locale".into(), SqlValue::Text(locale.into())),
            ("publication_state".into(), SqlValue::SmallInt(state)),
            (
                "published_at".into(),
                if state == PUBLISHED {
                    SqlValue::DateTime(now)
                } else {
                    SqlValue::Null(ColumnKind::DateTime)
                },
            ),
            ("created_at".into(), SqlValue::DateTime(now)),
            ("updated_at".into(), SqlValue::DateTime(now)),
            ("created_by_id".into(), actor_value(actor)),
            ("updated_by_id".into(), actor_value(actor)),
        ]);
        let mut insert = SqlBuilder::new(tx.flavor());
        write_insert(&mut insert, model.table(), values);
        let id = tx
            .insert_returning_id(&insert.sql, &insert.params)
            .await
            .map_err(|error| db_error(model, error))?;
        // Shared relations and media come along.
        let shared =
            |field: &&Field| field.attribute.as_ref().is_some_and(|attribute| !attribute.localized);
        let media = model.fields.iter().filter(shared).filter_map(|field| field.media.as_ref());
        crate::media::copy_media(tx, media, source_id, id).await?;
        for relation in model
            .fields
            .iter()
            .filter(shared)
            .filter_map(|field| field.relation.as_ref())
            .filter(|relation| relation.owner)
        {
            let links = current_links(tx, &relation.link_table, source_id).await?;
            replace_links(tx, &relation.link_table, id, &links).await?;
        }
        Ok(id)
    }

    /// The locales a document exists in, with whether each has a draft and a published
    /// version (empty for types that are not localized).
    pub async fn document_locales(
        &self,
        uid: &str,
        document_id: &str,
    ) -> Result<Vec<LocaleVersion>> {
        let model = self.registry.get(uid)?;
        if !model.content_type.localized {
            return Ok(Vec::new());
        }
        let mut select = SqlBuilder::new(self.db.flavor());
        select.push("SELECT ").ident("locale").push(", ").ident("publication_state");
        select.push(" FROM ").ident(model.table()).push(" WHERE ").ident("document_id").push(" = ");
        select.param(SqlValue::Text(document_id.into()));
        let kinds = [ColumnKind::Text, ColumnKind::SmallInt];
        let rows = self.db.queries().fetch_all(&select.sql, &select.params, &kinds).await?;
        let mut out: Vec<LocaleVersion> = Vec::new();
        for row in rows {
            let mut row = row.into_iter();
            let locale = row.next().and_then(SqlValue::into_text).unwrap_or_default();
            let published =
                row.next().and_then(|value| value.as_i64()) == Some(i64::from(PUBLISHED));
            let entry = match out.iter_mut().find(|entry| entry.locale == locale) {
                Some(entry) => entry,
                None => {
                    out.push(LocaleVersion { locale, draft: false, published: false });
                    out.last_mut().expect("just pushed")
                }
            };
            if published || !model.draft_and_publish() {
                entry.published = true;
            } else {
                entry.draft = true;
            }
        }
        out.sort_by(|a, b| a.locale.cmp(&b.locale));
        Ok(out)
    }
}

/// One locale of a document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LocaleVersion {
    pub locale: String,
    pub draft: bool,
    pub published: bool,
}

/// Whether `field` has one value per locale.
fn localized_field(model: &TypeModel, field: &str) -> bool {
    model.content_type.attributes.get(field).is_none_or(|attribute| attribute.localized)
}

/// Assignments of non-localized attributes, shared by every locale.
fn shared_columns(model: &TypeModel, columns: &[(String, SqlValue)]) -> Vec<(String, SqlValue)> {
    if !model.content_type.localized {
        return Vec::new();
    }
    columns
        .iter()
        .filter(|(column, _)| {
            model.fields.iter().any(|field| {
                &field.column == column
                    && field.attribute.as_ref().is_some_and(|attribute| !attribute.localized)
            })
        })
        .cloned()
        .collect()
}

/// Rows of the other locales of a document in `state`.
async fn sibling_rows(
    tx: &mut Tx,
    model: &TypeModel,
    document_id: &str,
    state: i16,
    locale: &str,
) -> Result<Vec<i64>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("id").push(" FROM ").ident(model.table());
    select
        .push(" WHERE ")
        .ident("document_id")
        .push(" = ")
        .param(SqlValue::Text(document_id.into()));
    select.push(" AND ").ident("publication_state").push(" = ").param(SqlValue::SmallInt(state));
    select.push(" AND ").ident("locale").push(" <> ").param(SqlValue::Text(locale.into()));
    let rows = tx.fetch_all(&select.sql, &select.params, &[ColumnKind::BigInt]).await?;
    Ok(rows.into_iter().filter_map(|row| row.first().and_then(SqlValue::as_i64)).collect())
}

fn actor_value(actor: Option<i64>) -> SqlValue {
    actor.map_or(SqlValue::Null(ColumnKind::BigInt), SqlValue::BigInt)
}

/// `created_by_id` of a document's draft (inside a transaction).
async fn created_by(
    tx: &mut Tx,
    model: &TypeModel,
    document_id: &str,
    locale: &str,
) -> Result<Option<i64>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("created_by_id").push(" FROM ").ident(model.table());
    write_version(&mut select, DRAFT, locale, document_id);
    let rows = tx.fetch_all(&select.sql, &select.params, &[ColumnKind::BigInt]).await?;
    Ok(rows.first().and_then(|row| row[0].as_i64()))
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn state_for(model: &TypeModel, status: Status) -> i16 {
    if model.draft_and_publish() && status == Status::Draft { DRAFT } else { PUBLISHED }
}

fn db_error(model: &TypeModel, error: DbError) -> ContentError {
    match model.unique_issue(&error) {
        Some(issue) => ContentError::Validation(vec![issue]),
        None => ContentError::Db(error),
    }
}

/// Fields selected for a response, in response order. Relations are added by population.
fn public_fields<'a>(
    model: &'a TypeModel,
    selected: Option<&[String]>,
    populate: &[Populate],
) -> Vec<&'a Field> {
    model
        .fields
        .iter()
        .filter(|field| match field.api.as_str() {
            "id" | "documentId" => true,
            _ if field.is_private() => false,
            _ => match field.category {
                FieldCategory::Scalar => {
                    selected.is_none_or(|selected| selected.contains(&field.api))
                }
                FieldCategory::Nested => populate.iter().any(|item| item.field == field.api),
                FieldCategory::Relation | FieldCategory::Media => false,
            },
        })
        .collect()
}

/// Every stored field, private and nested included.
fn internal_fields(model: &TypeModel) -> Vec<&Field> {
    model
        .fields
        .iter()
        .filter(|field| !matches!(field.category, FieldCategory::Relation | FieldCategory::Media))
        .collect()
}

fn internal_json(row: &[(&Field, SqlValue)]) -> Json {
    let mut object = Map::with_capacity(row.len());
    for (field, value) in row {
        let kind = field.attribute.as_ref().map(|attribute| &attribute.kind);
        object.insert(
            field.api.clone(),
            value_to_json(kind, value.clone(), OutputOptions::default()),
        );
    }
    Json::Object(object)
}

fn row_id_of(row: &[(&Field, SqlValue)]) -> i64 {
    row.iter()
        .find(|(field, _)| field.api == "id")
        .and_then(|(_, value)| value.as_i64())
        .unwrap_or_default()
}

fn write_select(out: &mut SqlBuilder, table: &str, fields: &[&Field]) {
    out.push("SELECT ");
    for (index, field) in fields.iter().enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.column(Some(BASE), &field.column);
    }
    out.push(" FROM ").ident(table).push(" AS ").ident(BASE);
}

/// ` WHERE` clause of an aliased read.
fn write_scope(
    out: &mut SqlBuilder,
    state: i16,
    locale: &str,
    scope: &Scope<'_>,
    filters: Option<&Filter>,
    context: FilterContext,
) {
    out.push(" WHERE ").column(Some(BASE), "locale").push(" = ");
    out.param(SqlValue::Text(locale.into())).push(" AND ");
    out.column(Some(BASE), "publication_state").push(" = ").param(SqlValue::SmallInt(state));
    match scope {
        Scope::All => {}
        Scope::Document(document_id) => {
            out.push(" AND ").column(Some(BASE), "document_id").push(" = ");
            out.param(SqlValue::Text((*document_id).into()));
        }
        Scope::Documents(ids) => {
            out.push(" AND ").column(Some(BASE), "document_id").push(" IN ");
            write_list(out, ids.iter().map(|id| SqlValue::Text(id.clone())));
        }
    }
    if let Some(filter) = filters {
        out.push(" AND ");
        write_filter(out, filter, BASE, context);
    }
}

/// ` WHERE` clause selecting one version of a document (unaliased, for DML).
fn write_version(out: &mut SqlBuilder, state: i16, locale: &str, document_id: &str) {
    out.push(" WHERE ").ident("locale").push(" = ").param(SqlValue::Text(locale.into()));
    out.push(" AND ").ident("publication_state").push(" = ");
    out.param(SqlValue::SmallInt(state)).push(" AND ").ident("document_id").push(" = ");
    out.param(SqlValue::Text(document_id.into()));
}

fn write_list(out: &mut SqlBuilder, values: impl Iterator<Item = SqlValue>) {
    out.push("(");
    for (index, value) in values.enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.param(value);
    }
    out.push(")");
}

fn write_insert(out: &mut SqlBuilder, table: &str, values: Vec<(String, SqlValue)>) {
    out.push("INSERT INTO ").ident(table).push(" (");
    for (index, (column, _)) in values.iter().enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.ident(column);
    }
    out.push(") VALUES (");
    for (index, (_, value)) in values.into_iter().enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.param(value);
    }
    out.push(")");
}

fn write_update(out: &mut SqlBuilder, table: &str, assignments: Vec<(String, SqlValue)>, id: i64) {
    out.push("UPDATE ").ident(table).push(" SET ");
    for (index, (column, value)) in assignments.into_iter().enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.ident(&column).push(" = ").param(value);
    }
    out.push(" WHERE ").ident("id").push(" = ").param(SqlValue::BigInt(id));
}

/// Row id of one version of a document, locking it for the transaction.
async fn row_id(
    tx: &mut Tx,
    model: &TypeModel,
    document_id: &str,
    state: i16,
    locale: &str,
    lock: bool,
) -> Result<Option<i64>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("id").push(" FROM ").ident(model.table());
    write_version(&mut select, state, locale, document_id);
    // SQLite transactions already hold the write lock (`BEGIN IMMEDIATE`).
    if lock && tx.flavor() != Flavor::Sqlite {
        select.push(" FOR UPDATE");
    }
    let rows = tx.fetch_all(&select.sql, &select.params, &[ColumnKind::BigInt]).await?;
    Ok(rows.first().and_then(|row| row[0].as_i64()))
}

/// Every stored field of one version of a document.
async fn load_internal<'a>(
    tx: &mut Tx,
    model: &'a TypeModel,
    document_id: &str,
    state: i16,
    locale: &str,
) -> Result<Option<Vec<(&'a Field, SqlValue)>>> {
    let fields = internal_fields(model);
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ");
    for (index, field) in fields.iter().enumerate() {
        if index > 0 {
            select.push(", ");
        }
        select.ident(&field.column);
    }
    select.push(" FROM ").ident(model.table());
    write_version(&mut select, state, locale, document_id);
    let kinds: Vec<ColumnKind> = fields.iter().map(|field| field.kind).collect();
    let rows = tx.fetch_all(&select.sql, &select.params, &kinds).await?;
    Ok(rows.into_iter().next().map(|row| fields.into_iter().zip(row).collect()))
}

/// `(column, value)` for every attribute column of a loaded row.
fn attribute_values(row: Vec<(&Field, SqlValue)>) -> Vec<(String, SqlValue)> {
    row.into_iter()
        .filter(|(field, _)| !field.is_system())
        .map(|(field, value)| (field.column.clone(), value))
        .collect()
}

/// Document ids among `ids` that exist in no version of `table`.
pub(crate) async fn missing_documents(
    tx: &mut Tx,
    table: &str,
    ids: &[String],
) -> Result<Vec<String>> {
    let mut found = HashSet::new();
    for chunk in ids.chunks(IN_CHUNK) {
        let mut select = SqlBuilder::new(tx.flavor());
        select.push("SELECT DISTINCT ").ident("document_id").push(" FROM ").ident(table);
        select.push(" WHERE ").ident("document_id").push(" IN ");
        write_list(&mut select, chunk.iter().map(|id| SqlValue::Text(id.clone())));
        for row in tx.fetch_all(&select.sql, &select.params, &[ColumnKind::Text]).await? {
            if let Some(id) = row.into_iter().next().and_then(SqlValue::into_text) {
                found.insert(id);
            }
        }
    }
    let mut seen = HashSet::new();
    Ok(ids
        .iter()
        .filter(|id| !found.contains(*id) && seen.insert((*id).clone()))
        .cloned()
        .collect())
}

async fn current_links(tx: &mut Tx, link_table: &str, source_id: i64) -> Result<Vec<String>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("target_document_id").push(" FROM ").ident(link_table);
    select.push(" WHERE ").ident("source_id").push(" = ").param(SqlValue::BigInt(source_id));
    select.push(" ORDER BY ").ident("position").push(", ").ident("id");
    let rows = tx.fetch_all(&select.sql, &select.params, &[ColumnKind::Text]).await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.into_iter().next().and_then(SqlValue::into_text))
        .collect())
}

/// Rewrites the links of a row, numbering positions 1..n.
async fn replace_links(
    tx: &mut Tx,
    link_table: &str,
    source_id: i64,
    links: &[String],
) -> Result<()> {
    const ROWS_PER_INSERT: usize = IN_CHUNK / 3;
    let mut delete = SqlBuilder::new(tx.flavor());
    delete.push("DELETE FROM ").ident(link_table).push(" WHERE ").ident("source_id").push(" = ");
    delete.param(SqlValue::BigInt(source_id));
    tx.execute(&delete.sql, &delete.params).await?;
    for (chunk_index, chunk) in links.chunks(ROWS_PER_INSERT).enumerate() {
        let mut insert = SqlBuilder::new(tx.flavor());
        insert.push("INSERT INTO ").ident(link_table).push(" (").ident("source_id").push(", ");
        insert.ident("target_document_id").push(", ").ident("position").push(") VALUES ");
        for (index, target) in chunk.iter().enumerate() {
            if index > 0 {
                insert.push(", ");
            }
            let position = (chunk_index * ROWS_PER_INSERT + index + 1) as f64;
            insert.push("(").param(SqlValue::BigInt(source_id)).push(", ");
            insert
                .param(SqlValue::Text(target.clone()))
                .push(", ")
                .param(SqlValue::Double(position))
                .push(")");
        }
        tx.execute(&insert.sql, &insert.params).await?;
    }
    Ok(())
}

/// For relations whose targets belong to one source document (`oneToOne`, `oneToMany`):
/// removes links to `targets` held by other documents' rows in the same state.
async fn steal_targets(
    tx: &mut Tx,
    link_table: &str,
    source_table: &str,
    targets: &[String],
    state: i16,
    document_id: &str,
) -> Result<()> {
    for chunk in targets.chunks(IN_CHUNK) {
        let mut delete = SqlBuilder::new(tx.flavor());
        delete
            .push("DELETE FROM ")
            .ident(link_table)
            .push(" WHERE ")
            .ident("target_document_id")
            .push(" IN ");
        write_list(&mut delete, chunk.iter().map(|id| SqlValue::Text(id.clone())));
        delete.push(" AND ").ident("source_id").push(" IN (SELECT ").ident("id").push(" FROM ");
        delete.ident(source_table).push(" WHERE ").ident("publication_state").push(" = ");
        delete.param(SqlValue::SmallInt(state)).push(" AND ").ident("document_id").push(" <> ");
        delete.param(SqlValue::Text(document_id.into())).push(")");
        tx.execute(&delete.sql, &delete.params).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::Connect;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn connect(id: &str, position: Option<Position>) -> Connect {
        Connect { document_id: id.into(), position }
    }

    #[test]
    fn slugifies() {
        assert_eq!(slugify("Hola Verdín!"), "hola-verdin");
        assert_eq!(slugify("  Rust & SQL -- 2026 "), "rust-sql-2026");
        assert_eq!(slugify("Straße"), "strasse");
        assert_eq!(slugify("¿?"), "");
    }

    #[test]
    fn computes_next_links() {
        let current = ids(&["a", "b", "c"]);
        let set = RelationOp::Set(ids(&["x", "x", "y"]));
        assert_eq!(next_links(current.clone(), &set, true).unwrap(), ids(&["x", "y"]));

        let change = RelationOp::Change {
            connect: vec![
                connect("d", None),
                connect("e", Some(Position::Start)),
                connect("f", Some(Position::Before("c".into()))),
                connect("a", Some(Position::After("c".into()))),
                connect("b", None),
            ],
            disconnect: ids(&["x"]),
        };
        assert_eq!(
            next_links(current.clone(), &change, true).unwrap(),
            ids(&["e", "b", "f", "c", "a", "d"])
        );

        let bad = RelationOp::Change {
            connect: vec![connect("d", Some(Position::After("zz".into())))],
            disconnect: vec![],
        };
        assert!(next_links(current, &bad, true).is_err());

        let replace = RelationOp::Change { connect: vec![connect("z", None)], disconnect: vec![] };
        assert_eq!(
            next_links(ids(&["a"]), &replace, false).unwrap(),
            ids(&["z"]),
            "to-one connect replaces"
        );
        let clear = RelationOp::Change { connect: vec![], disconnect: ids(&["a"]) };
        assert!(next_links(ids(&["a"]), &clear, false).unwrap().is_empty());
    }
}
