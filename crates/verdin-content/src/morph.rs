//! Polymorphic relations (`morphToOne`, `morphToMany` and their inverse `morphOne`,
//! `morphMany`): owners store `(target_type, target_document_id)` links in
//! `{table}_{attribute}_mph`; populated items carry the target's uid in `__type`.

use std::collections::HashMap;

use serde_json::{Map, Value as Json};
use verdin_db::{ColumnKind, SqlValue, Tx};
use verdin_query::sql::SqlBuilder;
use verdin_query::{Status, SubQuery};

use super::{Doc, DocumentService, IN_CHUNK, Scope, public_fields, state_for, write_list};
use crate::input::MorphWrite;
use crate::{ContentError, Issue, Result, TypeModel};

/// Links of one source row, in order.
pub(crate) async fn current(
    tx: &mut Tx,
    table: &str,
    source_id: i64,
) -> Result<Vec<(String, String)>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("target_type").push(", ").ident("target_document_id");
    select.push(" FROM ").ident(table).push(" WHERE ").ident("source_id").push(" = ");
    select.param(SqlValue::BigInt(source_id));
    select.push(" ORDER BY ").ident("position").push(", ").ident("id");
    let rows =
        tx.fetch_all(&select.sql, &select.params, &[ColumnKind::Text, ColumnKind::Text]).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let mut row = row.into_iter();
            let mut next = || row.next().and_then(SqlValue::into_text).unwrap_or_default();
            (next(), next())
        })
        .collect())
}

pub(crate) async fn replace(
    tx: &mut Tx,
    table: &str,
    source_id: i64,
    links: &[(String, String)],
) -> Result<()> {
    let mut delete = SqlBuilder::new(tx.flavor());
    delete.push("DELETE FROM ").ident(table).push(" WHERE ").ident("source_id").push(" = ");
    delete.param(SqlValue::BigInt(source_id));
    tx.execute(&delete.sql, &delete.params).await?;
    const ROWS_PER_INSERT: usize = IN_CHUNK / 4;
    for (chunk_index, chunk) in links.chunks(ROWS_PER_INSERT).enumerate() {
        let mut insert = SqlBuilder::new(tx.flavor());
        insert.push("INSERT INTO ").ident(table).push(" (").ident("source_id").push(", ");
        insert.ident("target_type").push(", ").ident("target_document_id").push(", ");
        insert.ident("position").push(") VALUES ");
        for (index, (uid, document_id)) in chunk.iter().enumerate() {
            if index > 0 {
                insert.push(", ");
            }
            let position = (chunk_index * ROWS_PER_INSERT + index + 1) as f64;
            insert.push("(").param(SqlValue::BigInt(source_id)).push(", ");
            insert.param(SqlValue::Text(uid.clone())).push(", ");
            insert.param(SqlValue::Text(document_id.clone())).push(", ");
            insert.param(SqlValue::Double(position)).push(")");
        }
        tx.execute(&insert.sql, &insert.params).await?;
    }
    Ok(())
}

impl DocumentService {
    /// Checks that every target exists, then replaces each attribute's links.
    pub(crate) async fn write_morphs(
        &self,
        tx: &mut Tx,
        source_id: i64,
        writes: &[MorphWrite],
    ) -> Result<()> {
        let mut issues = Vec::new();
        for write in writes {
            let path = vec![Json::from(write.field.as_str())];
            let mut by_type: HashMap<&str, Vec<String>> = HashMap::new();
            for (uid, document_id) in &write.targets {
                by_type.entry(uid.as_str()).or_default().push(document_id.clone());
            }
            let mut valid = true;
            for (uid, ids) in by_type {
                let Ok(target) = self.registry().get(uid) else {
                    issues.push(Issue::new(path.clone(), format!("unknown content type `{uid}`")));
                    valid = false;
                    continue;
                };
                let missing = super::missing_documents(tx, target.table(), &ids).await?;
                if !missing.is_empty() {
                    issues.push(Issue::new(
                        path.clone(),
                        format!("related {uid} documents do not exist: {}", missing.join(", ")),
                    ));
                    valid = false;
                }
            }
            if valid {
                replace(tx, &write.info.link_table, source_id, &write.targets).await?;
            }
        }
        if issues.is_empty() { Ok(()) } else { Err(ContentError::Validation(issues)) }
    }

    /// Copies the links of owner attributes from one row to another (publish, discard,
    /// new locales); `only` limits them to some attributes.
    pub(crate) async fn copy_morphs(
        &self,
        tx: &mut Tx,
        model: &TypeModel,
        from_row: i64,
        to_row: i64,
        only: &(dyn Fn(&verdin_query::Field) -> bool + Sync),
    ) -> Result<()> {
        for field in model.fields.iter().filter(|field| only(field)) {
            let Some(info) = field.morph.as_ref().filter(|info| info.owner) else { continue };
            let links = current(tx, &info.link_table, from_row).await?;
            replace(tx, &info.link_table, to_row, &links).await?;
        }
        Ok(())
    }

    /// Fills a populated polymorphic field of `docs`.
    pub(super) async fn populate_morph(
        &self,
        model: &TypeModel,
        field: &verdin_query::Field,
        docs: &mut [Doc],
        sub: &SubQuery,
        status: Status,
    ) -> Result<()> {
        let info = field.morph.as_ref().expect("morph field");
        let mut related: HashMap<i64, Vec<Json>> = HashMap::new();
        if info.owner {
            let ids: Vec<i64> = docs.iter().map(|doc| doc.id).collect();
            let links = self
                .morph_links(
                    &info.link_table,
                    "source_id",
                    &ids.iter().map(|id| SqlValue::BigInt(*id)).collect::<Vec<_>>(),
                    None,
                )
                .await?;
            let mut wanted: HashMap<String, Vec<String>> = HashMap::new();
            for (_, uid, document_id) in &links {
                let list = wanted.entry(uid.clone()).or_default();
                if !list.contains(document_id) {
                    list.push(document_id.clone());
                }
            }
            let mut found: HashMap<(String, String), Json> = HashMap::new();
            for (uid, ids) in wanted {
                // Types removed from the schema since: their links are skipped.
                let Ok(target) = self.registry().get(&uid) else { continue };
                let fields = public_fields(target, sub.fields.as_deref(), &[]);
                let targets = self
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
                for doc in targets {
                    let mut json = doc.json;
                    json.insert("__type".into(), Json::String(uid.clone()));
                    found.insert((uid.clone(), doc.document_id), Json::Object(json));
                }
            }
            for (source, uid, document_id) in links {
                if let Some(document) = found.get(&(uid, document_id)) {
                    related.entry(source).or_default().push(document.clone());
                }
            }
        } else {
            let owner_uid = info.owner_uid.as_deref().expect("inverse sides know their owner");
            let owner = self.registry().get(owner_uid)?;
            let wanted: Vec<SqlValue> =
                docs.iter().map(|doc| SqlValue::Text(doc.document_id.clone())).collect();
            let links = self
                .morph_links(
                    &info.link_table,
                    "target_document_id",
                    &wanted,
                    Some(&model.content_type.uid),
                )
                .await?;
            // (owner row id, target document id) → owner documents by their row.
            let owner_rows: Vec<i64> = links.iter().map(|(source, ..)| *source).collect();
            let fields = public_fields(owner, sub.fields.as_deref(), &[]);
            let rows =
                self.fetch_rows(owner, &fields, &owner_rows, state_for(owner, status)).await?;
            let by_row: HashMap<i64, Json> =
                rows.into_iter().map(|doc| (doc.id, Json::Object(doc.json))).collect();
            let by_document: HashMap<&str, i64> =
                docs.iter().map(|doc| (doc.document_id.as_str(), doc.id)).collect();
            for (source, _, document_id) in &links {
                if let (Some(owner), Some(target_row)) =
                    (by_row.get(source), by_document.get(document_id.as_str()))
                {
                    related.entry(*target_row).or_default().push(owner.clone());
                }
            }
        }
        for doc in docs.iter_mut() {
            let mut items = related.remove(&doc.id).unwrap_or_default();
            let value = if sub.count {
                serde_json::json!({ "count": items.len() })
            } else if info.to_many {
                Json::Array(items)
            } else if items.is_empty() {
                Json::Null
            } else {
                items.swap_remove(0)
            };
            doc.json.insert(field.api.clone(), value);
        }
        Ok(())
    }

    /// `(source_id, target_type, target_document_id)` rows whose `column` is in `values`
    /// (and whose type is `target_type`, when given), in order.
    async fn morph_links(
        &self,
        table: &str,
        column: &str,
        values: &[SqlValue],
        target_type: Option<&str>,
    ) -> Result<Vec<(i64, String, String)>> {
        let mut links = Vec::new();
        for chunk in values.chunks(IN_CHUNK) {
            let mut select = SqlBuilder::new(self.db().flavor());
            select.push("SELECT ").ident("source_id").push(", ").ident("target_type").push(", ");
            select.ident("target_document_id").push(" FROM ").ident(table).push(" WHERE ");
            select.ident(column).push(" IN ");
            write_list(&mut select, chunk.iter().cloned());
            if let Some(uid) = target_type {
                select
                    .push(" AND ")
                    .ident("target_type")
                    .push(" = ")
                    .param(SqlValue::Text(uid.into()));
            }
            select
                .push(" ORDER BY ")
                .ident("source_id")
                .push(", ")
                .ident("position")
                .push(", ")
                .ident("id");
            let kinds = [ColumnKind::BigInt, ColumnKind::Text, ColumnKind::Text];
            for row in self.db().queries().fetch_all(&select.sql, &select.params, &kinds).await? {
                let mut row = row.into_iter();
                let source = row.next().and_then(|value| value.as_i64()).unwrap_or_default();
                let uid = row.next().and_then(SqlValue::into_text).unwrap_or_default();
                let document_id = row.next().and_then(SqlValue::into_text).unwrap_or_default();
                links.push((source, uid, document_id));
            }
        }
        Ok(links)
    }

    /// Rows of `model` by id, in `state` (inverse sides: the owners of links).
    async fn fetch_rows(
        &self,
        model: &TypeModel,
        fields: &[&verdin_query::Field],
        rows: &[i64],
        state: i16,
    ) -> Result<Vec<Doc>> {
        let mut docs = Vec::new();
        let kinds: Vec<ColumnKind> = fields.iter().map(|field| field.kind).collect();
        for chunk in rows.chunks(IN_CHUNK) {
            let mut select = SqlBuilder::new(self.db().flavor());
            super::write_select(&mut select, model.table(), fields);
            select.push(" WHERE ").column(Some(super::BASE), "id").push(" IN ");
            write_list(&mut select, chunk.iter().map(|id| SqlValue::BigInt(*id)));
            select.push(" AND ").column(Some(super::BASE), "publication_state").push(" = ");
            select.param(SqlValue::SmallInt(state));
            // Localized owners: the request's locale only.
            select.push(" AND ").column(Some(super::BASE), "locale").push(" = ");
            select.param(SqlValue::Text(self.locale_of(model)?));
            for row in self.db().queries().fetch_all(&select.sql, &select.params, &kinds).await? {
                docs.push(self.to_doc(fields, row));
            }
        }
        Ok(docs)
    }

    /// Owner links of every row of `model` (exports): row id → attribute → items.
    pub(crate) async fn morph_exports(
        &self,
        model: &TypeModel,
        rows: &[i64],
    ) -> Result<HashMap<i64, Map<String, Json>>> {
        let mut out: HashMap<i64, Map<String, Json>> = HashMap::new();
        let values: Vec<SqlValue> = rows.iter().map(|id| SqlValue::BigInt(*id)).collect();
        for field in model.fields.iter() {
            let Some(info) = field.morph.as_ref().filter(|info| info.owner) else { continue };
            for (source, uid, document_id) in
                self.morph_links(&info.link_table, "source_id", &values, None).await?
            {
                let list = out
                    .entry(source)
                    .or_default()
                    .entry(field.api.clone())
                    .or_insert_with(|| Json::Array(Vec::new()));
                if let Json::Array(items) = list {
                    items.push(serde_json::json!({ "__type": uid, "documentId": document_id }));
                }
            }
        }
        Ok(out)
    }

    /// Sets the links of a polymorphic owner attribute of a row (importers).
    pub async fn import_morph_links(
        &self,
        uid: &str,
        field: &str,
        source_row: i64,
        targets: &[(String, String)],
    ) -> Result<()> {
        let model = self.registry().get(uid)?;
        let info = model
            .fields
            .get(field)
            .and_then(|field| field.morph.as_ref())
            .filter(|info| info.owner)
            .ok_or_else(|| {
                ContentError::BadRequest(format!("`{field}` is not a polymorphic owner attribute"))
            })?;
        let mut tx = self.db().begin().await?;
        replace(&mut tx, &info.link_table, source_row, targets).await?;
        tx.commit().await?;
        Ok(())
    }
}

/// Link tables of every polymorphic owner attribute.
pub(crate) fn owner_tables(registry: &crate::Registry) -> Vec<String> {
    registry
        .types()
        .flat_map(|model| model.fields.iter().filter_map(|field| field.morph.as_ref()))
        .filter(|info| info.owner)
        .map(|info| info.link_table.clone())
        .collect()
}

/// Populated polymorphic items back to their write form.
pub(crate) fn write_form(value: &Json) -> Json {
    let item = |value: &Json| {
        let uid = value.get("__type")?.as_str()?;
        let id = value.get("documentId")?.as_str()?;
        Some(serde_json::json!({ "__type": uid, "documentId": id }))
    };
    match value {
        Json::Array(items) => Json::Array(items.iter().filter_map(item).collect()),
        Json::Null => Json::Null,
        other => item(other).unwrap_or(Json::Null),
    }
}
