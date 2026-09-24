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

use serde::Serialize;
use serde_json::{Map, Value as Json};
use time::OffsetDateTime;
use verdin_db::value::truncate_millis;
use verdin_db::{ColumnKind, Database, DbError, Flavor, SqlValue, Tx};
use verdin_query::sql::{FilterContext, SqlBuilder, write_filter, write_order_by};
use verdin_query::{
    Field, FieldCategory, Filter, PageMode, Populate, Query, Sort, Status, SubQuery,
};

use crate::input::{Position, RelationOp, RelationWrite, check_required, prepare};
use crate::output::{OutputOptions, value_to_json};
use crate::{ContentError, Issue, Registry, Result, TypeModel};

const DRAFT: i16 = 0;
const PUBLISHED: i16 = 1;
/// Base table alias in reads.
const BASE: &str = "t0";
/// Largest `IN (…)` list per statement.
const IN_CHUNK: usize = 500;

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
}

impl DocumentService {
    pub fn new(db: Database, registry: Registry, output: OutputOptions) -> Self {
        Self { db, registry, output }
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
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
            write_scope(&mut count, state, &Scope::All, query.filters.as_ref(), query.status);
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
        select.push(" WHERE ").ident("locale").push(" = '' ORDER BY ").ident("id").push(" LIMIT 1");
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
        let mut docs = Vec::new();
        for chunk in chunks {
            let mut select = SqlBuilder::new(self.db.flavor());
            write_select(&mut select, model.table(), fields);
            write_scope(&mut select, state, &chunk, filters, status);
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
            select.push(" AND ").column(Some(BASE), "locale").push(" = '' AND ");
            select
                .column(Some(BASE), "publication_state")
                .push(" = ")
                .param(SqlValue::SmallInt(state));
            if let Some(filter) = &sub.filters {
                select.push(" AND ");
                write_filter(&mut select, filter, BASE, FilterContext::new(status));
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
            ("locale".into(), SqlValue::Text(String::new())),
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
        values.extend(prepared.columns);
        let mut insert = SqlBuilder::new(self.db.flavor());
        write_insert(&mut insert, model.table(), values);
        let id = tx
            .insert_returning_id(&insert.sql, &insert.params)
            .await
            .map_err(|error| db_error(model, error))?;
        self.write_relations(&mut tx, model, id, &document_id, state, &prepared.relations).await?;

        if draft_and_publish {
            if options.publish {
                self.publish_in(&mut tx, model, &document_id, now, options.actor).await?;
            }
        } else {
            self.ensure_required(&mut tx, model, &document_id, PUBLISHED).await?;
        }
        tx.commit().await?;
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

        let mut tx = self.db.begin().await?;
        let id = row_id(&mut tx, model, document_id, state, true)
            .await?
            .ok_or(ContentError::NotFound)?;
        let mut assignments = prepared.columns;
        assignments.push(("updated_at".into(), SqlValue::DateTime(now)));
        assignments.push(("updated_by_id".into(), actor_value(options.actor)));
        let mut update = SqlBuilder::new(self.db.flavor());
        write_update(&mut update, model.table(), assignments, id);
        tx.execute(&update.sql, &update.params).await.map_err(|error| db_error(model, error))?;
        self.write_relations(&mut tx, model, id, document_id, state, &prepared.relations).await?;

        if model.draft_and_publish() {
            if options.publish {
                self.publish_in(&mut tx, model, document_id, now, options.actor).await?;
            }
        } else {
            self.ensure_required(&mut tx, model, document_id, PUBLISHED).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Deletes every version of a document, and every link pointing at it.
    pub async fn delete(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.registry.get(uid)?;
        let mut tx = self.db.begin().await?;
        for link_table in self.registry.incoming_links(uid) {
            let mut delete = SqlBuilder::new(self.db.flavor());
            delete
                .push("DELETE FROM ")
                .ident(link_table)
                .push(" WHERE ")
                .ident("target_document_id");
            delete.push(" = ").param(SqlValue::Text(document_id.into()));
            tx.execute(&delete.sql, &delete.params).await?;
        }
        let mut delete = SqlBuilder::new(self.db.flavor());
        delete
            .push("DELETE FROM ")
            .ident(model.table())
            .push(" WHERE ")
            .ident("document_id")
            .push(" = ");
        delete
            .param(SqlValue::Text(document_id.into()))
            .push(" AND ")
            .ident("locale")
            .push(" = ''");
        let deleted = tx.execute(&delete.sql, &delete.params).await?;
        if deleted == 0 {
            return Err(ContentError::NotFound);
        }
        tx.commit().await?;
        Ok(())
    }

    /// Copies the draft over the published version (creating it if needed).
    pub async fn publish(&self, uid: &str, document_id: &str, actor: Option<i64>) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let mut tx = self.db.begin().await?;
        self.publish_in(&mut tx, model, document_id, now(), actor).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Removes the published version (its links go with it); the draft stays.
    pub async fn unpublish(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let mut tx = self.db.begin().await?;
        row_id(&mut tx, model, document_id, DRAFT, true).await?.ok_or(ContentError::NotFound)?;
        let mut delete = SqlBuilder::new(self.db.flavor());
        delete.push("DELETE FROM ").ident(model.table());
        write_version(&mut delete, PUBLISHED, document_id);
        tx.execute(&delete.sql, &delete.params).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Replaces the draft (fields and links) with the published version.
    pub async fn discard_draft(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let mut tx = self.db.begin().await?;
        let draft_id = row_id(&mut tx, model, document_id, DRAFT, true)
            .await?
            .ok_or(ContentError::NotFound)?;
        let published = load_internal(&mut tx, model, document_id, PUBLISHED).await?;
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
        select.push(" WHERE ").ident("locale").push(" = '' AND ").ident("document_id").push(" = ");
        select.param(SqlValue::Text(document_id.into()));
        select.push(" ORDER BY ").ident("publication_state").push(" LIMIT 1");
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
        let draft =
            load_internal(tx, model, document_id, DRAFT).await?.ok_or(ContentError::NotFound)?;
        let document = internal_json(&draft);
        let issues =
            check_required(&self.registry.schema, &model.content_type.attributes, &document, &[]);
        if !issues.is_empty() {
            return Err(ContentError::Validation(issues));
        }

        let draft_id = row_id_of(&draft);
        let created_at = draft
            .iter()
            .find(|(field, _)| field.api == "createdAt")
            .map(|(_, value)| value.clone());
        let mut values = attribute_values(draft);
        values.push(("published_at".into(), SqlValue::DateTime(now)));
        values.push(("updated_at".into(), SqlValue::DateTime(now)));
        values.push(("updated_by_id".into(), actor_value(actor)));

        let mut statement = SqlBuilder::new(self.db.flavor());
        let published_id = match row_id(tx, model, document_id, PUBLISHED, true).await? {
            Some(id) => {
                write_update(&mut statement, model.table(), values, id);
                tx.execute(&statement.sql, &statement.params)
                    .await
                    .map_err(|error| db_error(model, error))?;
                id
            }
            None => {
                values.push(("document_id".into(), SqlValue::Text(document_id.into())));
                values.push(("locale".into(), SqlValue::Text(String::new())));
                values.push(("publication_state".into(), SqlValue::SmallInt(PUBLISHED)));
                values.push(("created_at".into(), created_at.unwrap_or(SqlValue::DateTime(now))));
                values.push((
                    "created_by_id".into(),
                    actor_value(created_by(tx, model, document_id).await?),
                ));
                write_insert(&mut statement, model.table(), values);
                tx.insert_returning_id(&statement.sql, &statement.params)
                    .await
                    .map_err(|error| db_error(model, error))?
            }
        };
        self.copy_links(tx, model, draft_id, published_id, document_id, PUBLISHED).await
    }

    /// Types without draft & publish are always published, so `required` holds on every write.
    async fn ensure_required(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        document_id: &str,
        state: i16,
    ) -> Result<()> {
        let row =
            load_internal(tx, model, document_id, state).await?.ok_or(ContentError::NotFound)?;
        let document = internal_json(&row);
        let issues =
            check_required(&self.registry.schema, &model.content_type.attributes, &document, &[]);
        if issues.is_empty() { Ok(()) } else { Err(ContentError::Validation(issues)) }
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

fn actor_value(actor: Option<i64>) -> SqlValue {
    actor.map_or(SqlValue::Null(ColumnKind::BigInt), SqlValue::BigInt)
}

/// `created_by_id` of a document's draft (inside a transaction).
async fn created_by(tx: &mut Tx, model: &TypeModel, document_id: &str) -> Result<Option<i64>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("created_by_id").push(" FROM ").ident(model.table());
    write_version(&mut select, DRAFT, document_id);
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
                FieldCategory::Relation => false,
            },
        })
        .collect()
}

/// Every stored field, private and nested included.
fn internal_fields(model: &TypeModel) -> Vec<&Field> {
    model.fields.iter().filter(|field| field.category != FieldCategory::Relation).collect()
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
    scope: &Scope<'_>,
    filters: Option<&Filter>,
    status: Status,
) {
    out.push(" WHERE ").column(Some(BASE), "locale").push(" = '' AND ");
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
        write_filter(out, filter, BASE, FilterContext::new(status));
    }
}

/// ` WHERE` clause selecting one version of a document (unaliased, for DML).
fn write_version(out: &mut SqlBuilder, state: i16, document_id: &str) {
    out.push(" WHERE ").ident("locale").push(" = '' AND ").ident("publication_state").push(" = ");
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
    lock: bool,
) -> Result<Option<i64>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("id").push(" FROM ").ident(model.table());
    write_version(&mut select, state, document_id);
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
    write_version(&mut select, state, document_id);
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
async fn missing_documents(tx: &mut Tx, table: &str, ids: &[String]) -> Result<Vec<String>> {
    let mut found = HashSet::new();
    for chunk in ids.chunks(IN_CHUNK) {
        let mut select = SqlBuilder::new(tx.flavor());
        select.push("SELECT DISTINCT ").ident("document_id").push(" FROM ").ident(table);
        select.push(" WHERE ").ident("locale").push(" = '' AND ").ident("document_id").push(" IN ");
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
