//! Reads and writes documents (docs/architecture.md §8.3 and §11).
//!
//! A document with draft & publish has a draft row (`publication_state = 0`) and, once
//! published, a published row (`publication_state = 1`) sharing its `document_id`. Types
//! without draft & publish only have the published row.

use serde::Serialize;
use serde_json::{Map, Value as Json};
use time::OffsetDateTime;
use verdin_db::value::truncate_millis;
use verdin_db::{ColumnKind, Database, DbError, Flavor, SqlValue, Tx};
use verdin_query::sql::{SqlBuilder, write_filter, write_order_by};
use verdin_query::{Field, FieldCategory, Filter, PageMode, Query, Status};

use crate::input::{check_required, prepare};
use crate::output::{OutputOptions, value_to_json};
use crate::{ContentError, Registry, Result, TypeModel};

const DRAFT: i16 = 0;
const PUBLISHED: i16 = 1;

#[derive(Debug, Clone, Copy)]
pub struct WriteOptions {
    /// Publish after writing (draft & publish types). `false` writes the draft only.
    pub publish: bool,
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

    pub async fn find_many(&self, uid: &str, query: &Query) -> Result<Page> {
        let model = self.registry.get(uid)?;
        let fields = public_fields(model, query);
        let state = state_for(model, query.status);
        let flavor = self.db.flavor();

        let mut select = SqlBuilder::new(flavor);
        write_select(&mut select, model, &fields);
        write_where(&mut select, state, None, query.filters.as_ref());
        write_order_by(&mut select, &query.sort, None);
        select
            .push(" LIMIT ")
            .param(SqlValue::BigInt(to_i64(query.pagination.limit())))
            .push(" OFFSET ")
            .param(SqlValue::BigInt(to_i64(query.pagination.offset())));
        let kinds: Vec<ColumnKind> = fields.iter().map(|field| field.kind).collect();
        let rows = self.db.queries().fetch_all(&select.sql, &select.params, &kinds).await?;
        let documents = rows.into_iter().map(|row| self.to_json(&fields, row)).collect();

        let total = if query.pagination.with_count {
            let mut count = SqlBuilder::new(flavor);
            count.push("SELECT COUNT(*) FROM ").ident(model.table());
            write_where(&mut count, state, None, query.filters.as_ref());
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
        Ok(Page { documents, meta })
    }

    pub async fn find_one(
        &self,
        uid: &str,
        document_id: &str,
        query: &Query,
    ) -> Result<Option<Json>> {
        let model = self.registry.get(uid)?;
        let fields = public_fields(model, query);
        let mut select = SqlBuilder::new(self.db.flavor());
        write_select(&mut select, model, &fields);
        write_where(
            &mut select,
            state_for(model, query.status),
            Some(document_id),
            query.filters.as_ref(),
        );
        let kinds: Vec<ColumnKind> = fields.iter().map(|field| field.kind).collect();
        let rows = self.db.queries().fetch_all(&select.sql, &select.params, &kinds).await?;
        Ok(rows.into_iter().next().map(|row| self.to_json(&fields, row)))
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

    /// Creates a document and returns its id.
    pub async fn create(&self, uid: &str, data: &Json, options: WriteOptions) -> Result<String> {
        let model = self.registry.get(uid)?;
        let columns =
            prepare(model, &self.registry.schema, data, true).map_err(ContentError::Validation)?;
        let document_id = ulid::Ulid::generate().to_string().to_lowercase();
        let now = now();
        let draft_and_publish = model.draft_and_publish();

        let mut tx = self.db.begin().await?;
        let mut insert = SqlBuilder::new(self.db.flavor());
        let mut values: Vec<(String, SqlValue)> = vec![
            ("document_id".into(), SqlValue::Text(document_id.clone())),
            ("locale".into(), SqlValue::Text(String::new())),
            (
                "publication_state".into(),
                SqlValue::SmallInt(if draft_and_publish { DRAFT } else { PUBLISHED }),
            ),
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
        ];
        values.extend(columns);
        write_insert(&mut insert, model.table(), values);
        tx.execute(&insert.sql, &insert.params).await.map_err(|error| db_error(model, error))?;

        if draft_and_publish {
            if options.publish {
                self.publish_in(&mut tx, model, &document_id, now).await?;
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
        let columns =
            prepare(model, &self.registry.schema, data, false).map_err(ContentError::Validation)?;
        let state = if model.draft_and_publish() { DRAFT } else { PUBLISHED };
        let now = now();

        let mut tx = self.db.begin().await?;
        let id = row_id(&mut tx, model, document_id, state, true)
            .await?
            .ok_or(ContentError::NotFound)?;
        let mut update = SqlBuilder::new(self.db.flavor());
        let mut assignments: Vec<(String, SqlValue)> = columns;
        assignments.push(("updated_at".into(), SqlValue::DateTime(now)));
        write_update(&mut update, model.table(), assignments, id);
        tx.execute(&update.sql, &update.params).await.map_err(|error| db_error(model, error))?;

        if model.draft_and_publish() {
            if options.publish {
                self.publish_in(&mut tx, model, document_id, now).await?;
            }
        } else {
            self.ensure_required(&mut tx, model, document_id, PUBLISHED).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Deletes every version of a document.
    pub async fn delete(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.registry.get(uid)?;
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
        let deleted = self.db.queries().execute(&delete.sql, &delete.params).await?;
        if deleted == 0 { Err(ContentError::NotFound) } else { Ok(()) }
    }

    /// Copies the draft over the published version (creating it if needed).
    pub async fn publish(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let mut tx = self.db.begin().await?;
        self.publish_in(&mut tx, model, document_id, now()).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Removes the published version; the draft stays.
    pub async fn unpublish(&self, uid: &str, document_id: &str) -> Result<()> {
        let model = self.draft_and_publish_model(uid)?;
        let mut tx = self.db.begin().await?;
        row_id(&mut tx, model, document_id, DRAFT, true).await?.ok_or(ContentError::NotFound)?;
        let mut delete = SqlBuilder::new(self.db.flavor());
        delete.push("DELETE FROM ").ident(model.table());
        write_where(&mut delete, PUBLISHED, Some(document_id), None);
        tx.execute(&delete.sql, &delete.params).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Replaces the draft with the published version.
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
        let mut assignments = attribute_values(model, published);
        assignments.push(("updated_at".into(), SqlValue::DateTime(now())));
        let mut update = SqlBuilder::new(self.db.flavor());
        write_update(&mut update, model.table(), assignments, draft_id);
        tx.execute(&update.sql, &update.params).await?;
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

    async fn publish_in(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        document_id: &str,
        now: OffsetDateTime,
    ) -> Result<()> {
        let draft =
            load_internal(tx, model, document_id, DRAFT).await?.ok_or(ContentError::NotFound)?;
        let document = self.internal_json(model, &draft);
        let issues =
            check_required(&self.registry.schema, &model.content_type.attributes, &document, &[]);
        if !issues.is_empty() {
            return Err(ContentError::Validation(issues));
        }

        let created_at = draft
            .iter()
            .find(|(field, _)| field.api == "createdAt")
            .map(|(_, value)| value.clone());
        let mut values = attribute_values(model, draft);
        values.push(("published_at".into(), SqlValue::DateTime(now)));
        values.push(("updated_at".into(), SqlValue::DateTime(now)));

        let mut statement = SqlBuilder::new(self.db.flavor());
        match row_id(tx, model, document_id, PUBLISHED, true).await? {
            Some(id) => write_update(&mut statement, model.table(), values, id),
            None => {
                values.push(("document_id".into(), SqlValue::Text(document_id.into())));
                values.push(("locale".into(), SqlValue::Text(String::new())));
                values.push(("publication_state".into(), SqlValue::SmallInt(PUBLISHED)));
                values.push(("created_at".into(), created_at.unwrap_or(SqlValue::DateTime(now))));
                write_insert(&mut statement, model.table(), values);
            }
        }
        tx.execute(&statement.sql, &statement.params)
            .await
            .map_err(|error| db_error(model, error))?;
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
        let row =
            load_internal(tx, model, document_id, state).await?.ok_or(ContentError::NotFound)?;
        let document = self.internal_json(model, &row);
        let issues =
            check_required(&self.registry.schema, &model.content_type.attributes, &document, &[]);
        if issues.is_empty() { Ok(()) } else { Err(ContentError::Validation(issues)) }
    }

    fn to_json(&self, fields: &[&Field], row: Vec<SqlValue>) -> Json {
        let mut object = Map::with_capacity(fields.len());
        for (field, value) in fields.iter().zip(row) {
            let kind = field.attribute.as_ref().map(|attribute| &attribute.kind);
            object.insert(field.api.clone(), value_to_json(kind, value, self.output));
        }
        Json::Object(object)
    }

    fn internal_json(&self, _model: &TypeModel, row: &[(&Field, SqlValue)]) -> Json {
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

/// Fields returned by the content API for `query`, in response order.
fn public_fields<'a>(model: &'a TypeModel, query: &Query) -> Vec<&'a Field> {
    model
        .fields
        .iter()
        .filter(|field| match field.api.as_str() {
            "id" | "documentId" => true,
            _ if field.is_private() => false,
            _ => match field.category {
                FieldCategory::Scalar => {
                    query.fields.as_ref().is_none_or(|selected| selected.contains(&field.api))
                }
                FieldCategory::Nested => query.populate.contains(&field.api),
                FieldCategory::Relation => false,
            },
        })
        .collect()
}

/// Every stored field, private and nested included.
fn internal_fields(model: &TypeModel) -> Vec<&Field> {
    model.fields.iter().filter(|field| field.category != FieldCategory::Relation).collect()
}

fn write_select(out: &mut SqlBuilder, model: &TypeModel, fields: &[&Field]) {
    out.push("SELECT ");
    for (index, field) in fields.iter().enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.ident(&field.column);
    }
    out.push(" FROM ").ident(model.table());
}

fn write_where(
    out: &mut SqlBuilder,
    state: i16,
    document_id: Option<&str>,
    filters: Option<&Filter>,
) {
    out.push(" WHERE ").ident("locale").push(" = '' AND ").ident("publication_state").push(" = ");
    out.param(SqlValue::SmallInt(state));
    if let Some(document_id) = document_id {
        out.push(" AND ")
            .ident("document_id")
            .push(" = ")
            .param(SqlValue::Text(document_id.into()));
    }
    if let Some(filter) = filters {
        out.push(" AND ");
        write_filter(out, filter, None);
    }
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
    write_where(&mut select, state, Some(document_id), None);
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
    write_select(&mut select, model, &fields);
    write_where(&mut select, state, Some(document_id), None);
    let kinds: Vec<ColumnKind> = fields.iter().map(|field| field.kind).collect();
    let rows = tx.fetch_all(&select.sql, &select.params, &kinds).await?;
    Ok(rows.into_iter().next().map(|row| fields.into_iter().zip(row).collect()))
}

/// `(column, value)` for every attribute column of a loaded row.
fn attribute_values(_model: &TypeModel, row: Vec<(&Field, SqlValue)>) -> Vec<(String, SqlValue)> {
    row.into_iter()
        .filter(|(field, _)| !field.is_system())
        .map(|(field, value)| (field.column.clone(), value))
        .collect()
}
