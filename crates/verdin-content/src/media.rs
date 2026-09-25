//! Media library files as content sees them: the file record in Strapi's JSON shape, and
//! the media link tables (`{table}_{field}_mda`) that attach files to document versions.

use std::collections::HashMap;

use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde_json::{Map, Value as Json, json};
use time::OffsetDateTime;
use verdin_db::value::format_datetime;
use verdin_db::{ColumnKind, Database, SqlValue, Tx};
use verdin_migrate::system::FILES;
use verdin_query::MediaInfo;
use verdin_query::sql::SqlBuilder;
use verdin_schema::MediaType;

use crate::input::MediaWrite;
use crate::{ContentError, Issue, Result};

/// Columns of `vd_files`, in [`FileRecord::from_row`] order.
pub const FILE_COLUMNS: &[(&str, ColumnKind)] = &[
    ("id", ColumnKind::BigInt),
    ("document_id", ColumnKind::Text),
    ("name", ColumnKind::Text),
    ("alternative_text", ColumnKind::Text),
    ("caption", ColumnKind::Text),
    ("width", ColumnKind::Int),
    ("height", ColumnKind::Int),
    ("focal_point", ColumnKind::Json),
    ("formats", ColumnKind::Json),
    ("hash", ColumnKind::Text),
    ("ext", ColumnKind::Text),
    ("mime", ColumnKind::Text),
    ("size", ColumnKind::Decimal),
    ("url", ColumnKind::Text),
    ("preview_url", ColumnKind::Text),
    ("provider", ColumnKind::Text),
    ("provider_metadata", ColumnKind::Json),
    ("folder_id", ColumnKind::BigInt),
    ("folder_path", ColumnKind::Text),
    ("created_by", ColumnKind::BigInt),
    ("updated_by", ColumnKind::BigInt),
    ("created_at", ColumnKind::DateTime),
    ("updated_at", ColumnKind::DateTime),
];

/// One `vd_files` row.
#[derive(Debug, Clone, PartialEq)]
pub struct FileRecord {
    pub id: i64,
    pub document_id: String,
    pub name: String,
    pub alternative_text: Option<String>,
    pub caption: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    /// `{ "x": 0.5, "y": 0.3 }`, fractions of the width and height.
    pub focal_point: Option<Json>,
    /// Responsive versions by name (`thumbnail`, `small`…), Strapi's shape.
    pub formats: Option<Json>,
    pub hash: String,
    pub ext: String,
    pub mime: String,
    /// Kilobytes, two decimals (Strapi's unit).
    pub size: Decimal,
    pub url: String,
    pub preview_url: Option<String>,
    pub provider: String,
    pub provider_metadata: Option<Json>,
    pub folder_id: Option<i64>,
    pub folder_path: String,
    pub created_by: Option<i64>,
    pub updated_by: Option<i64>,
    pub created_at: Option<OffsetDateTime>,
    pub updated_at: Option<OffsetDateTime>,
}

impl FileRecord {
    /// `SELECT` list of [`FILE_COLUMNS`], optionally qualified by `alias`.
    pub fn select_list(out: &mut SqlBuilder, alias: Option<&str>) {
        for (index, (column, _)) in FILE_COLUMNS.iter().enumerate() {
            if index > 0 {
                out.push(", ");
            }
            out.column(alias, column);
        }
    }

    pub fn kinds() -> Vec<ColumnKind> {
        FILE_COLUMNS.iter().map(|(_, kind)| *kind).collect()
    }

    pub fn from_row(row: Vec<SqlValue>) -> Self {
        let mut row = row.into_iter();
        let mut next = || row.next().unwrap_or(SqlValue::Null(ColumnKind::Text));
        let text = |value: SqlValue| value.into_text();
        let json = |value: SqlValue| match value {
            SqlValue::Json(json) if !json.is_null() => Some(json),
            _ => None,
        };
        let datetime = |value: SqlValue| match value {
            SqlValue::DateTime(at) => Some(at),
            _ => None,
        };
        Self {
            id: next().as_i64().unwrap_or_default(),
            document_id: text(next()).unwrap_or_default(),
            name: text(next()).unwrap_or_default(),
            alternative_text: text(next()),
            caption: text(next()),
            width: next().as_i64(),
            height: next().as_i64(),
            focal_point: json(next()),
            formats: json(next()),
            hash: text(next()).unwrap_or_default(),
            ext: text(next()).unwrap_or_default(),
            mime: text(next()).unwrap_or_default(),
            size: match next() {
                SqlValue::Decimal(size) => size,
                _ => Decimal::ZERO,
            },
            url: text(next()).unwrap_or_default(),
            preview_url: text(next()),
            provider: text(next()).unwrap_or_default(),
            provider_metadata: json(next()),
            folder_id: next().as_i64(),
            folder_path: text(next()).unwrap_or_else(|| "/".into()),
            created_by: next().as_i64(),
            updated_by: next().as_i64(),
            created_at: datetime(next()),
            updated_at: datetime(next()),
        }
    }

    pub fn media_type(&self) -> MediaType {
        MediaType::of_mime(&self.mime)
    }

    /// The Strapi v5 file object (`publishedAt` mirrors `createdAt`: files have no drafts).
    pub fn to_json(&self) -> Json {
        let created = self.created_at.map(format_datetime);
        let mut object = Map::new();
        object.insert("id".into(), json!(self.id));
        object.insert("documentId".into(), json!(self.document_id));
        object.insert("name".into(), json!(self.name));
        object.insert("alternativeText".into(), json!(self.alternative_text));
        object.insert("caption".into(), json!(self.caption));
        object.insert("width".into(), json!(self.width));
        object.insert("height".into(), json!(self.height));
        object.insert("focalPoint".into(), json!(self.focal_point));
        object.insert("formats".into(), json!(self.formats));
        object.insert("hash".into(), json!(self.hash));
        object.insert("ext".into(), json!(self.ext));
        object.insert("mime".into(), json!(self.mime));
        object.insert("size".into(), json!(self.size.round_dp(2).to_f64().unwrap_or_default()));
        object.insert("url".into(), json!(self.url));
        object.insert("previewUrl".into(), json!(self.preview_url));
        object.insert("provider".into(), json!(self.provider));
        object.insert("provider_metadata".into(), json!(self.provider_metadata));
        object.insert("createdAt".into(), json!(created));
        object.insert("updatedAt".into(), json!(self.updated_at.map(format_datetime)));
        object.insert("publishedAt".into(), json!(created));
        Json::Object(object)
    }
}

/// Files by id (for references inside components).
pub(crate) async fn files_by_ids(db: &Database, ids: &[i64]) -> Result<HashMap<i64, Json>> {
    let mut files = HashMap::new();
    for chunk in ids.chunks(crate::service::IN_CHUNK) {
        let mut select = SqlBuilder::new(db.flavor());
        select.push("SELECT ");
        FileRecord::select_list(&mut select, None);
        select.push(" FROM ").ident(FILES).push(" WHERE ").ident("id").push(" IN (");
        for (index, id) in chunk.iter().enumerate() {
            if index > 0 {
                select.push(", ");
            }
            select.param(SqlValue::BigInt(*id));
        }
        select.push(")");
        for row in db.queries().fetch_all(&select.sql, &select.params, &FileRecord::kinds()).await?
        {
            let file = FileRecord::from_row(row);
            files.insert(file.id, file.to_json());
        }
    }
    Ok(files)
}

/// Files linked to each source row of one media field, in order.
pub(crate) async fn files_of_sources(
    db: &Database,
    info: &MediaInfo,
    source_ids: &[i64],
) -> Result<HashMap<i64, Vec<FileRecord>>> {
    let mut files: HashMap<i64, Vec<FileRecord>> = HashMap::new();
    for chunk in source_ids.chunks(crate::service::IN_CHUNK) {
        let mut select = SqlBuilder::new(db.flavor());
        select.push("SELECT ").column(Some("l"), "source_id").push(", ");
        FileRecord::select_list(&mut select, Some("f"));
        select.push(" FROM ").ident(&info.link_table).push(" l JOIN ").ident(FILES);
        select.push(" f ON ").column(Some("f"), "id").push(" = ").column(Some("l"), "file_id");
        select.push(" WHERE ").column(Some("l"), "source_id").push(" IN (");
        for (index, id) in chunk.iter().enumerate() {
            if index > 0 {
                select.push(", ");
            }
            select.param(SqlValue::BigInt(*id));
        }
        select.push(") ORDER BY ").column(Some("l"), "source_id").push(", ");
        select.column(Some("l"), "position");
        let mut kinds = vec![ColumnKind::BigInt];
        kinds.extend(FileRecord::kinds());
        for mut row in db.queries().fetch_all(&select.sql, &select.params, &kinds).await? {
            let source = row.remove(0).as_i64().unwrap_or_default();
            files.entry(source).or_default().push(FileRecord::from_row(row));
        }
    }
    Ok(files)
}

/// Replaces the files of each written media field, after checking they exist and are of
/// an allowed type.
pub(crate) async fn write_media(tx: &mut Tx, source_id: i64, writes: &[MediaWrite]) -> Result<()> {
    let mut issues = Vec::new();
    for write in writes {
        let path = vec![Json::from(write.field.as_str())];
        let mimes = file_mimes(tx, &write.files).await?;
        let missing: Vec<String> =
            write.files.iter().filter(|id| !mimes.contains_key(id)).map(i64::to_string).collect();
        if !missing.is_empty() {
            issues.push(Issue::new(path, format!("files do not exist: {}", missing.join(", "))));
            continue;
        }
        let allowed = &write.info.allowed_types;
        let refused: Vec<String> = write
            .files
            .iter()
            .filter(|id| !allowed.is_empty() && !allowed.contains(&MediaType::of_mime(&mimes[id])))
            .map(|id| format!("{id} ({})", mimes[id]))
            .collect();
        if !refused.is_empty() {
            let kinds: Vec<&str> = allowed.iter().map(|ty| ty.as_str()).collect();
            issues.push(Issue::new(
                path,
                format!("only {} are allowed, got {}", kinds.join(", "), refused.join(", ")),
            ));
            continue;
        }
        replace_media(tx, &write.info.link_table, source_id, &write.files).await?;
    }
    if issues.is_empty() { Ok(()) } else { Err(ContentError::Validation(issues)) }
}

/// Copies every media field's files from one row to another (publish, discard draft).
pub(crate) async fn copy_media(
    tx: &mut Tx,
    fields: impl Iterator<Item = &MediaInfo>,
    from_row: i64,
    to_row: i64,
) -> Result<()> {
    for info in fields {
        let files = current_media(tx, &info.link_table, from_row).await?;
        replace_media(tx, &info.link_table, to_row, &files).await?;
    }
    Ok(())
}

/// Number of files linked to `source_id` in `link_table`.
pub(crate) async fn media_count(tx: &mut Tx, link_table: &str, source_id: i64) -> Result<usize> {
    Ok(current_media(tx, link_table, source_id).await?.len())
}

async fn current_media(tx: &mut Tx, link_table: &str, source_id: i64) -> Result<Vec<i64>> {
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("file_id").push(" FROM ").ident(link_table);
    select.push(" WHERE ").ident("source_id").push(" = ").param(SqlValue::BigInt(source_id));
    select.push(" ORDER BY ").ident("position");
    let rows = tx.fetch_all(&select.sql, &select.params, &[ColumnKind::BigInt]).await?;
    Ok(rows.iter().filter_map(|row| row[0].as_i64()).collect())
}

async fn replace_media(tx: &mut Tx, link_table: &str, source_id: i64, files: &[i64]) -> Result<()> {
    let mut delete = SqlBuilder::new(tx.flavor());
    delete.push("DELETE FROM ").ident(link_table).push(" WHERE ").ident("source_id");
    delete.push(" = ").param(SqlValue::BigInt(source_id));
    tx.execute(&delete.sql, &delete.params).await?;
    for (index, file) in files.iter().enumerate() {
        let mut insert = SqlBuilder::new(tx.flavor());
        insert.push("INSERT INTO ").ident(link_table).push(" (");
        insert.ident("source_id").push(", ").ident("file_id").push(", ").ident("position");
        insert.push(") VALUES (").param(SqlValue::BigInt(source_id)).push(", ");
        insert.param(SqlValue::BigInt(*file)).push(", ");
        insert.param(SqlValue::Double(index as f64 + 1.0)).push(")");
        tx.execute(&insert.sql, &insert.params).await?;
    }
    Ok(())
}

pub(crate) async fn file_mimes(tx: &mut Tx, ids: &[i64]) -> Result<HashMap<i64, String>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut select = SqlBuilder::new(tx.flavor());
    select.push("SELECT ").ident("id").push(", ").ident("mime").push(" FROM ").ident(FILES);
    select.push(" WHERE ").ident("id").push(" IN (");
    for (index, id) in ids.iter().enumerate() {
        if index > 0 {
            select.push(", ");
        }
        select.param(SqlValue::BigInt(*id));
    }
    select.push(")");
    let rows =
        tx.fetch_all(&select.sql, &select.params, &[ColumnKind::BigInt, ColumnKind::Text]).await?;
    Ok(rows
        .into_iter()
        .filter_map(|mut row| {
            let mime = row.pop()?.into_text()?;
            Some((row[0].as_i64()?, mime))
        })
        .collect())
}
