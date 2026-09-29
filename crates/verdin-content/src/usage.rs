//! Where used: the document versions that reference a document (relations, polymorphic
//! relations, relations inside components) or a file (media fields, media inside
//! components, images in blocks, URLs in rich text).

use std::collections::{BTreeSet, HashSet};

use serde::Serialize;
use serde_json::Value as Json;
use verdin_db::{ColumnKind, Database, SqlValue};
use verdin_query::sql::SqlBuilder;
use verdin_schema::{Attribute, AttributeKind, Schema};

use super::{DocumentService, PUBLISHED};
use crate::refs::{self, Target};
use crate::{ContentError, Result, TypeModel};

/// Rows read per page when scanning JSON and text columns.
const PAGE: i64 = 500;

/// One version of a document that references the target, and where.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub uid: String,
    pub document_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// `draft` or `published`.
    pub status: &'static str,
    /// Attribute path (`category`, `seo.image`, `blocks.2.gallery`).
    pub field: String,
    /// The version's first text attribute, to name it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// For `is-creator` permissions.
    #[serde(skip)]
    pub created_by: Option<i64>,
}

/// What is looked up.
enum Wanted<'a> {
    Document { uid: &'a str, document_id: &'a str },
    File { id: i64, url: Option<String> },
}

impl DocumentService {
    /// The versions referencing a document of `uid`.
    pub async fn document_usage(&self, uid: &str, document_id: &str) -> Result<Vec<Usage>> {
        self.registry.get(uid)?;
        self.usage(Wanted::Document { uid, document_id }).await
    }

    /// The versions referencing a file.
    pub async fn file_usage(&self, file_id: i64) -> Result<Vec<Usage>> {
        let files = crate::media::files_by_ids(&self.db, &[file_id]).await?;
        let file = files.get(&file_id).ok_or(ContentError::NotFound)?;
        let url = file.get("url").and_then(Json::as_str).map(str::to_owned);
        self.usage(Wanted::File { id: file_id, url }).await
    }

    async fn usage(&self, wanted: Wanted<'_>) -> Result<Vec<Usage>> {
        let schema = &self.registry.schema;
        // Plain reads, no transaction: a scan must not hold up writers (SQLite).
        let db = &self.db;
        let mut found = BTreeSet::new();
        let mut models: Vec<_> = self.registry.types().collect();
        models.sort_by(|a, b| a.uid().cmp(b.uid()));
        for model in models {
            let scan = Scan::new(model);
            for field in model.fields.iter() {
                let Some(attribute) = &field.attribute else { continue };
                // Link tables: owning relations to the type, and polymorphic owners.
                let link = match &wanted {
                    Wanted::Document { uid, document_id } => field
                        .relation
                        .as_ref()
                        .filter(|relation| relation.owner && relation.target == *uid)
                        .map(|relation| (relation.link_table.as_str(), None))
                        .or_else(|| {
                            let info = field.morph.as_ref().filter(|info| info.owner)?;
                            Some((info.link_table.as_str(), Some(*uid)))
                        })
                        .map(|(table, target_type)| (table, target_type, *document_id)),
                    Wanted::File { .. } => None,
                };
                if let Some((table, target_type, id)) = link {
                    let rows = scan
                        .linked(
                            db,
                            table,
                            "target_document_id",
                            SqlValue::Text(id.into()),
                            target_type,
                        )
                        .await?;
                    found.extend(rows.into_iter().map(|row| row.usage(model, &field.api)));
                    continue;
                }
                if let (Wanted::File { id, .. }, Some(media)) = (&wanted, &field.media) {
                    let rows = scan
                        .linked(db, &media.link_table, "file_id", SqlValue::BigInt(*id), None)
                        .await?;
                    found.extend(rows.into_iter().map(|row| row.usage(model, &field.api)));
                    continue;
                }
                if field.column.is_empty() || !may_contain(schema, attribute, &wanted) {
                    continue;
                }
                let like = match (&wanted, &attribute.kind) {
                    (Wanted::File { url: Some(url), .. }, AttributeKind::RichText { .. }) => {
                        Some(format!("%{url}%"))
                    }
                    _ => None,
                };
                let mut after = 0;
                loop {
                    let (rows, last) = scan.page(db, &field.column, like.as_deref(), after).await?;
                    for (row, value) in rows {
                        for path in matches(schema, attribute, &value, &field.api, &wanted) {
                            found.insert(row.usage(model, &path));
                        }
                    }
                    match last {
                        Some(last) => after = last,
                        None => break,
                    }
                }
            }
        }
        Ok(found.into_iter().collect())
    }
}

/// A source row, as read for a usage.
struct Row {
    document_id: String,
    locale: String,
    state: i16,
    title: Option<String>,
    created_by: Option<i64>,
}

impl Row {
    fn usage(&self, model: &TypeModel, field: &str) -> Usage {
        Usage {
            uid: model.uid().to_owned(),
            document_id: self.document_id.clone(),
            locale: (!self.locale.is_empty() && model.content_type.localized)
                .then(|| self.locale.clone()),
            status: if self.state == PUBLISHED && model.draft_and_publish() {
                "published"
            } else if model.draft_and_publish() {
                "draft"
            } else {
                "published"
            },
            field: field.to_owned(),
            title: self.title.clone(),
            created_by: self.created_by,
        }
    }
}

/// Reads the rows of one content type.
struct Scan<'a> {
    model: &'a TypeModel,
    /// Column of the first text attribute.
    title: Option<String>,
}

impl<'a> Scan<'a> {
    fn new(model: &'a TypeModel) -> Self {
        let title = model
            .content_type
            .attributes
            .iter()
            .find(|(_, attribute)| {
                !attribute.private
                    && matches!(
                        attribute.kind,
                        AttributeKind::String { .. }
                            | AttributeKind::Email { .. }
                            | AttributeKind::Uid { .. }
                            | AttributeKind::Text { .. }
                            | AttributeKind::Enumeration { .. }
                    )
            })
            .map(|(name, _)| Attribute::column_name(name));
        Self { model, title }
    }

    fn select(&self, out: &mut SqlBuilder, extra: Option<&str>) {
        out.push("SELECT ").column(Some("s"), "document_id").push(", ");
        out.column(Some("s"), "locale").push(", ").column(Some("s"), "publication_state");
        out.push(", ").column(Some("s"), "created_by_id").push(", ");
        match &self.title {
            Some(title) => out.column(Some("s"), title),
            None => out.push("NULL"),
        };
        if let Some(extra) = extra {
            out.push(", ").column(Some("s"), "id").push(", ").column(Some("s"), extra);
        }
        out.push(" FROM ").ident(self.model.table()).push(" s");
    }

    fn kinds(extra: Option<ColumnKind>) -> Vec<ColumnKind> {
        let mut kinds = vec![
            ColumnKind::Text,
            ColumnKind::Text,
            ColumnKind::SmallInt,
            ColumnKind::BigInt,
            ColumnKind::Text,
        ];
        if let Some(extra) = extra {
            kinds.extend([ColumnKind::BigInt, extra]);
        }
        kinds
    }

    fn row(values: &mut impl Iterator<Item = SqlValue>) -> Row {
        let document_id = values.next().and_then(SqlValue::into_text).unwrap_or_default();
        let locale = values.next().and_then(SqlValue::into_text).unwrap_or_default();
        let state = values.next().and_then(|value| value.as_i64()).unwrap_or(0) as i16;
        let created_by = values.next().and_then(|value| value.as_i64());
        let title = values.next().and_then(SqlValue::into_text).filter(|title| !title.is_empty());
        Row { document_id, locale, state, title, created_by }
    }

    /// Rows whose link table has `column = value` (and `target_type`, for morphs).
    async fn linked(
        &self,
        db: &Database,
        table: &str,
        column: &str,
        value: SqlValue,
        target_type: Option<&str>,
    ) -> Result<Vec<Row>> {
        let mut select = SqlBuilder::new(db.flavor());
        self.select(&mut select, None);
        select.push(" JOIN ").ident(table).push(" l ON ").column(Some("l"), "source_id");
        select.push(" = ").column(Some("s"), "id").push(" WHERE ").column(Some("l"), column);
        select.push(" = ").param(value);
        if let Some(target_type) = target_type {
            select.push(" AND ").column(Some("l"), "target_type").push(" = ");
            select.param(SqlValue::Text(target_type.into()));
        }
        let rows = db.queries().fetch_all(&select.sql, &select.params, &Self::kinds(None)).await?;
        Ok(rows.into_iter().map(|row| Self::row(&mut row.into_iter())).collect())
    }

    /// A page of rows with `column` set (and `LIKE like`), after row id `after`; the last
    /// id when more may follow.
    async fn page(
        &self,
        db: &Database,
        column: &str,
        like: Option<&str>,
        after: i64,
    ) -> Result<(Vec<(Row, Json)>, Option<i64>)> {
        let kind = if like.is_some() { ColumnKind::Text } else { ColumnKind::Json };
        let mut select = SqlBuilder::new(db.flavor());
        self.select(&mut select, Some(column));
        select.push(" WHERE ").column(Some("s"), column).push(" IS NOT NULL AND ");
        select.column(Some("s"), "id").push(" > ").param(SqlValue::BigInt(after));
        if let Some(like) = like {
            select.push(" AND ").column(Some("s"), column).push(" LIKE ");
            select.param(SqlValue::Text(like.into()));
        }
        select.push(" ORDER BY ").column(Some("s"), "id").push(" LIMIT ");
        select.push(&PAGE.to_string());
        let rows =
            db.queries().fetch_all(&select.sql, &select.params, &Self::kinds(Some(kind))).await?;
        let full = rows.len() as i64 == PAGE;
        let mut last = None;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let mut values = row.into_iter();
            let source = Self::row(&mut values);
            last = values.next().and_then(|value| value.as_i64());
            let value = match values.next() {
                Some(SqlValue::Json(value)) => value,
                Some(other) => other.into_text().map_or(Json::Null, Json::String),
                None => Json::Null,
            };
            out.push((source, value));
        }
        Ok((out, if full { last } else { None }))
    }
}

/// Whether values of `attribute` can hold a reference to `wanted` (by the schema).
fn may_contain(schema: &Schema, attribute: &Attribute, wanted: &Wanted) -> bool {
    fn walk(
        schema: &Schema,
        kind: &AttributeKind,
        wanted: &Wanted,
        seen: &mut HashSet<String>,
    ) -> bool {
        let components = |uids: Vec<&String>, seen: &mut HashSet<String>| {
            uids.into_iter().any(|uid| {
                seen.insert(uid.clone())
                    && schema.component(uid).is_some_and(|component| {
                        component
                            .attributes
                            .values()
                            .any(|attribute| walk(schema, &attribute.kind, wanted, seen))
                    })
            })
        };
        match (kind, wanted) {
            (AttributeKind::Relation { target, .. }, Wanted::Document { uid, .. }) => {
                schema.content_type(target).is_some_and(|target| target.uid == *uid)
            }
            (AttributeKind::Media { .. } | AttributeKind::Blocks, Wanted::File { .. }) => true,
            (AttributeKind::RichText { .. }, Wanted::File { url, .. }) => url.is_some(),
            (AttributeKind::Component { component, .. }, _) => components(vec![component], seen),
            (AttributeKind::DynamicZone { components: uids, .. }, _) => {
                components(uids.iter().collect(), seen)
            }
            _ => false,
        }
    }
    walk(schema, &attribute.kind, wanted, &mut HashSet::new())
}

/// Paths inside `value` (of `attribute`, named `name`) that reference `wanted`.
fn matches(
    schema: &Schema,
    attribute: &Attribute,
    value: &Json,
    name: &str,
    wanted: &Wanted,
) -> Vec<String> {
    let mut paths = Vec::new();
    match &attribute.kind {
        AttributeKind::RichText { .. } => {
            if let (Wanted::File { url: Some(url), .. }, Json::String(text)) = (wanted, value)
                && text.contains(url.as_str())
            {
                paths.push(name.to_owned());
            }
            return paths;
        }
        AttributeKind::Blocks => {
            if blocks_use(value, wanted) {
                paths.push(name.to_owned());
            }
            return paths;
        }
        _ => {}
    }
    let root = [Json::from(name)];
    for reference in refs::collect(schema, &attribute.kind, value, &root) {
        let hit = match (&reference.target, wanted) {
            (Target::Documents { uid }, Wanted::Document { uid: wanted, document_id }) => {
                uid == wanted && reference.values.iter().any(|v| v.as_str() == Some(document_id))
            }
            (Target::Files { .. }, Wanted::File { id, .. }) => {
                reference.values.iter().any(|v| v.as_i64() == Some(*id))
            }
            _ => false,
        };
        if hit {
            paths.push(dotted(&reference.path));
        }
    }
    // Blocks and rich text inside components.
    if let Wanted::File { .. } = wanted
        && matches!(
            attribute.kind,
            AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. }
        )
    {
        nested_text(schema, &attribute.kind, value, &root, wanted, &mut paths);
    }
    paths.sort();
    paths.dedup();
    paths
}

/// Blocks and rich text attributes inside component items.
fn nested_text(
    schema: &Schema,
    kind: &AttributeKind,
    value: &Json,
    path: &[Json],
    wanted: &Wanted,
    paths: &mut Vec<String>,
) {
    let mut item = |item: &Json, uid: Option<&str>, path: &[Json]| {
        let uid = match (kind, uid) {
            (AttributeKind::Component { component, .. }, _) => Some(component.as_str()),
            (_, uid) => uid,
        };
        let Some(component) = uid.and_then(|uid| schema.component(uid)) else { return };
        for (name, attribute) in &component.attributes {
            let Some(child) = item.get(name) else { continue };
            let mut child_path = path.to_vec();
            child_path.push(Json::from(name.as_str()));
            match &attribute.kind {
                AttributeKind::Blocks if blocks_use(child, wanted) => {
                    paths.push(dotted(&child_path))
                }
                AttributeKind::RichText { .. } => {
                    if let (Wanted::File { url: Some(url), .. }, Json::String(text)) =
                        (wanted, child)
                        && text.contains(url.as_str())
                    {
                        paths.push(dotted(&child_path));
                    }
                }
                AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. } => {
                    nested_text(schema, &attribute.kind, child, &child_path, wanted, paths)
                }
                _ => {}
            }
        }
    };
    match value {
        Json::Array(items) => {
            for (index, entry) in items.iter().enumerate() {
                let mut entry_path = path.to_vec();
                entry_path.push(Json::from(index));
                let uid = entry.get("__component").and_then(Json::as_str);
                item(entry, uid, &entry_path);
            }
        }
        Json::Object(_) => item(value, None, path),
        _ => {}
    }
}

/// Whether blocks show the file (an `image` node with its id or URL).
fn blocks_use(value: &Json, wanted: &Wanted) -> bool {
    let Wanted::File { id, url } = wanted else { return false };
    match value {
        Json::Array(items) => items.iter().any(|item| blocks_use(item, wanted)),
        Json::Object(node) => {
            let image = node
                .get("type")
                .and_then(Json::as_str)
                .filter(|kind| *kind == "image")
                .and_then(|_| node.get("image"));
            let shown = image.is_some_and(|image| {
                image.get("id").and_then(Json::as_i64) == Some(*id)
                    || url
                        .as_deref()
                        .is_some_and(|url| image.get("url").and_then(Json::as_str) == Some(url))
            });
            shown || node.get("children").is_some_and(|children| blocks_use(children, wanted))
        }
        _ => false,
    }
}

fn dotted(path: &[Json]) -> String {
    path.iter()
        .map(|segment| match segment {
            Json::String(text) => text.clone(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}
