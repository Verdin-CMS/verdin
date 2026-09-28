//! CSV and JSON import and export of one content type from the admin list.
//!
//! Export (`GET /content/{uid}/export?format=csv|json`, with the list's filters, sort,
//! `status` and `locale`) writes one row per document: `documentId`, then the attributes
//! in the write format — relations as `documentId`s, media as file ids, polymorphic
//! relations as `uid:documentId`, components, dynamic zones, blocks and JSON as JSON. In
//! CSV, lists are joined with `|`.
//!
//! Import (`POST /content/{uid}/import`) reads the same shapes, maps columns to
//! attributes, and creates each row (or updates the document named by `documentId`).
//! Rows are written one by one: failing rows are reported and skipped. `dryRun` checks
//! every row (constraints and references included) without writing.

use std::collections::{HashMap, HashSet};

use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json as AxumJson, Router};
use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::{Map, Value as Json, json};
use verdin_auth::actions;
use verdin_content::{ContentError, WriteOptions};
use verdin_query::{FieldCategory, PageMode, Pagination, Status};
use verdin_schema::AttributeKind;

use super::{
    AdminState, ApiResult, admin_query, body, content_grant, ensure_owner, localized,
    writable_fields,
};
use crate::error::ApiError;

/// Most rows one import takes.
const MAX_ROWS: usize = 5000;
/// Most documents one export writes.
const MAX_EXPORT: usize = 50_000;
/// Row errors listed in a report.
const MAX_ERRORS: usize = 100;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/content/{uid}/export", get(export))
        .route("/content/{uid}/import", post(import))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Format {
    Csv,
    Json,
}

/// How an attribute is exported and imported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    Text,
    Integer,
    Number,
    Decimal,
    Boolean,
    /// Dates and times, as the API writes them.
    Plain,
    /// Components, dynamic zones, blocks, JSON.
    Structured,
    Relation {
        many: bool,
    },
    Media {
        many: bool,
    },
    Morph {
        many: bool,
    },
}

/// The attributes an admin may export or import, in schema order.
fn columns(
    state: &AdminState,
    uid: &str,
    allowed: Option<&[String]>,
) -> Result<Vec<(String, Shape)>, ApiError> {
    let model = state.service.registry().get(uid)?;
    let mut out = Vec::new();
    for field in model.fields.attributes() {
        let Some(attribute) = &field.attribute else { continue };
        if allowed.is_some_and(|allowed| !allowed.contains(&field.api)) {
            continue;
        }
        let shape = match &attribute.kind {
            AttributeKind::Password { .. } => continue,
            AttributeKind::String { .. }
            | AttributeKind::Text { .. }
            | AttributeKind::RichText { .. }
            | AttributeKind::Email { .. }
            | AttributeKind::Uid { .. }
            | AttributeKind::Enumeration { .. } => Shape::Text,
            AttributeKind::Integer { .. } | AttributeKind::BigInteger { .. } => Shape::Integer,
            AttributeKind::Float { .. } => Shape::Number,
            AttributeKind::Decimal { .. } => Shape::Decimal,
            AttributeKind::Boolean => Shape::Boolean,
            AttributeKind::Date { .. }
            | AttributeKind::Time { .. }
            | AttributeKind::DateTime { .. } => Shape::Plain,
            AttributeKind::Relation { .. } => match &field.relation {
                // Inverse sides are read-only.
                Some(relation) if relation.owner => Shape::Relation { many: relation.to_many },
                _ => continue,
            },
            AttributeKind::Morph { .. } => match &field.morph {
                Some(info) if info.owner => Shape::Morph { many: info.to_many },
                _ => continue,
            },
            AttributeKind::Media { .. } => {
                Shape::Media { many: field.media.as_ref().is_some_and(|media| media.multiple) }
            }
            _ if field.category == FieldCategory::Nested
                || field.kind == verdin_db::ColumnKind::Json =>
            {
                Shape::Structured
            }
            _ => Shape::Plain,
        };
        out.push((field.api.clone(), shape));
    }
    Ok(out)
}

/// `raw` without the given parameters.
fn without(raw: Option<&str>, names: &[&str]) -> Option<String> {
    let kept: Vec<&str> = raw?
        .split('&')
        .filter(|pair| {
            let name = pair.split('=').next().unwrap_or_default();
            let name = name.split('[').next().unwrap_or_default();
            !pair.is_empty() && !names.contains(&name)
        })
        .collect();
    (!kept.is_empty()).then(|| kept.join("&"))
}

fn param<'a>(raw: Option<&'a str>, name: &str) -> Option<&'a str> {
    raw?.split('&').find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
}

async fn export(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    let format = match param(raw.as_deref(), "format") {
        None | Some("csv") => Format::Csv,
        Some("json") => Format::Json,
        Some(other) => return Err(ApiError::BadRequest(format!("unknown format `{other}`"))),
    };
    let rest = without(raw.as_deref(), &["format", "pagination", "fields", "populate"]);
    let mut query = admin_query(&state, &uid, rest.as_deref(), &principal, grant)?;
    query.fields = Some(vec!["documentId".into()]);
    query.populate = Vec::new();
    let status = query.status;

    // The documents the list shows, in its order.
    let mut order: Vec<String> = Vec::new();
    let mut page = 1;
    loop {
        query.pagination =
            Pagination { mode: PageMode::Page { page, page_size: 100 }, with_count: false };
        let found = state.service.find_many(&uid, &query).await?;
        let count = found.documents.len();
        order.extend(
            found.documents.iter().filter_map(|doc| doc["documentId"].as_str().map(str::to_owned)),
        );
        if count < 100 || order.len() >= MAX_EXPORT {
            break;
        }
        page += 1;
    }
    order.truncate(MAX_EXPORT);

    let model = state.service.registry().get(&uid)?;
    let locale = state.service.locale_of(model)?;
    let published = status == Status::Published || !model.draft_and_publish();
    let wanted: HashSet<&str> = order.iter().map(String::as_str).collect();
    let mut versions: HashMap<String, verdin_content::ExportedVersion> = state
        .service
        .export_versions(&uid)
        .await?
        .into_iter()
        .filter(|version| {
            version.locale == locale
                && version.published == published
                && wanted.contains(version.document_id.as_str())
        })
        .map(|version| (version.document_id.clone(), version))
        .collect();
    let allowed = principal.permissions.content_fields(actions::CONTENT_READ, &uid);
    let columns = columns(&state, &uid, allowed.as_deref())?;
    let rows: Vec<Map<String, Json>> = order
        .iter()
        .filter_map(|id| versions.remove(id))
        .map(|version| export_row(version, &columns))
        .collect();

    let date = time::OffsetDateTime::now_utc().date();
    let name = format!("{}-{date}", model.content_type.plural_name);
    let (body, content_type, extension) = match format {
        Format::Json => (
            serde_json::to_string_pretty(&rows).expect("JSON serializes"),
            "application/json; charset=utf-8",
            "json",
        ),
        Format::Csv => (to_csv(&rows, &columns), "text/csv; charset=utf-8", "csv"),
    };
    let mut response = body.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Ok(value) =
        HeaderValue::from_str(&format!("attachment; filename=\"{name}.{extension}\""))
    {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
}

fn export_row(
    version: verdin_content::ExportedVersion,
    columns: &[(String, Shape)],
) -> Map<String, Json> {
    let mut row = Map::new();
    row.insert("documentId".into(), Json::String(version.document_id));
    for (name, shape) in columns {
        let value = match shape {
            Shape::Relation { many } => single(version.relations.get(name), *many),
            Shape::Media { many } => single(version.media.get(name), *many),
            Shape::Morph { many } => single(version.morph.get(name), *many),
            _ => version.data.get(name).cloned().unwrap_or(Json::Null),
        };
        row.insert(name.clone(), value);
    }
    row
}

/// Link lists as stored; to-one attributes as their single item.
fn single(list: Option<&Json>, many: bool) -> Json {
    match (list, many) {
        (Some(list), true) => list.clone(),
        (None, true) => Json::Array(Vec::new()),
        (Some(Json::Array(items)), false) => items.first().cloned().unwrap_or(Json::Null),
        (_, false) => Json::Null,
    }
}

fn to_csv(rows: &[Map<String, Json>], columns: &[(String, Shape)]) -> String {
    let mut out = String::new();
    let header: Vec<String> = std::iter::once("documentId".to_owned())
        .chain(columns.iter().map(|(name, _)| name.clone()))
        .collect();
    write_record(&mut out, header.iter().map(String::as_str));
    for row in rows {
        let mut cells = vec![row["documentId"].as_str().unwrap_or_default().to_owned()];
        for (name, shape) in columns {
            cells.push(to_cell(row.get(name).unwrap_or(&Json::Null), *shape));
        }
        write_record(&mut out, cells.iter().map(String::as_str));
    }
    out
}

fn to_cell(value: &Json, shape: Shape) -> String {
    let item = |value: &Json| match value {
        Json::String(text) => text.clone(),
        Json::Object(object)
            if shape == (Shape::Morph { many: true })
                || shape == (Shape::Morph { many: false }) =>
        {
            format!(
                "{}:{}",
                object.get("__type").and_then(Json::as_str).unwrap_or_default(),
                object.get("documentId").and_then(Json::as_str).unwrap_or_default()
            )
        }
        other => other.to_string(),
    };
    match (value, shape) {
        (Json::Null, _) => String::new(),
        (Json::String(text), Shape::Text) => guard_formula(text),
        (Json::String(text), _) => text.clone(),
        (
            Json::Array(items),
            Shape::Relation { .. } | Shape::Media { .. } | Shape::Morph { .. },
        ) => items.iter().map(item).collect::<Vec<_>>().join("|"),
        (value, Shape::Morph { .. }) => item(value),
        (value @ (Json::Array(_) | Json::Object(_)), _) => value.to_string(),
        (value, _) => value.to_string(),
    }
}

/// Spreadsheets run cells that start like formulas: text gets a leading `'`, which
/// imports drop again.
fn guard_formula(text: &str) -> String {
    if text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{text}")
    } else {
        text.to_owned()
    }
}

fn unguard_formula(text: &str) -> &str {
    match text.strip_prefix('\'') {
        Some(rest) if rest.starts_with(['=', '+', '-', '@', '\t', '\r']) => rest,
        _ => text,
    }
}

pub(super) fn write_record<'a>(out: &mut String, cells: impl Iterator<Item = &'a str>) {
    for (index, cell) in cells.enumerate() {
        if index > 0 {
            out.push(',');
        }
        if cell.contains([',', '"', '\n', '\r']) {
            out.push('"');
            out.push_str(&cell.replace('"', "\"\""));
            out.push('"');
        } else {
            out.push_str(cell);
        }
    }
    out.push_str("\r\n");
}

/// RFC 4180 records (quotes, doubled quotes, CRLF or LF; a leading BOM is skipped).
fn parse_csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    let mut line = 1;
    while let Some(c) = chars.next() {
        match (quoted, c) {
            (true, '"') if chars.peek() == Some(&'"') => {
                chars.next();
                cell.push('"');
            }
            (true, '"') => quoted = false,
            (true, c) => {
                if c == '\n' {
                    line += 1;
                }
                cell.push(c);
            }
            (false, '"') if cell.is_empty() => quoted = true,
            (false, ',') => record.push(std::mem::take(&mut cell)),
            (false, '\r') if chars.peek() == Some(&'\n') => {}
            (false, '\n' | '\r') => {
                line += 1;
                record.push(std::mem::take(&mut cell));
                records.push(std::mem::take(&mut record));
            }
            (false, c) => cell.push(c),
        }
    }
    if quoted {
        return Err(format!("unterminated quote before line {line}"));
    }
    if !cell.is_empty() || !record.is_empty() {
        record.push(cell);
        records.push(record);
    }
    // Blank lines carry nothing.
    records.retain(|record| !(record.len() == 1 && record[0].is_empty()));
    Ok(records)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ImportBody {
    format: Format,
    /// The file's content.
    data: String,
    /// Column → attribute (`null` skips the column); unmapped columns keep their name.
    #[serde(default)]
    mapping: IndexMap<String, Option<String>>,
    #[serde(default)]
    dry_run: bool,
    /// Publish each row (draft & publish types).
    #[serde(default)]
    publish: bool,
}

async fn import(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    // Importing needs at least one of creating or updating.
    let create = content_grant(&state, &headers, &uid, actions::CONTENT_CREATE).await.ok();
    let update = content_grant(&state, &headers, &uid, actions::CONTENT_UPDATE).await.ok();
    let principal = match (&create, &update) {
        (Some((principal, _)), _) | (None, Some((principal, _))) => principal.clone(),
        (None, None) => return Err(ApiError::Forbidden),
    };
    let input: ImportBody = body(&bytes)?;
    let model = state.service.registry().get(&uid)?;
    if input.publish {
        if !model.draft_and_publish() {
            return Err(ApiError::BadRequest(format!("`{uid}` has no draft and publish")));
        }
        content_grant(&state, &headers, &uid, actions::CONTENT_PUBLISH).await?;
    }
    let columns: HashMap<String, Shape> = columns(&state, &uid, None)?.into_iter().collect();

    // Rows as `field → value`, and the columns that were left out.
    let target = |column: &str| -> Option<String> {
        match input.mapping.get(column) {
            Some(Some(field)) => Some(field.clone()),
            Some(None) => None,
            None => Some(column.to_owned()),
        }
        .filter(|field| field == "documentId" || columns.contains_key(field))
    };
    let mut ignored: Vec<String> = Vec::new();
    let rows: Vec<Map<String, Json>> = match input.format {
        Format::Csv => {
            let records = parse_csv(&input.data).map_err(ApiError::BadRequest)?;
            let Some((header, records)) = records.split_first() else {
                return Err(ApiError::BadRequest("the file is empty".into()));
            };
            let fields: Vec<Option<String>> =
                header.iter().map(|column| target(column.trim())).collect();
            for (column, field) in header.iter().zip(&fields) {
                if field.is_none() {
                    ignored.push(column.trim().to_owned());
                }
            }
            check_rows(records.len())?;
            records
                .iter()
                .map(|record| {
                    let mut row = Map::new();
                    for (cell, field) in record.iter().zip(&fields) {
                        let Some(field) = field else { continue };
                        let shape = columns.get(field).copied().unwrap_or(Shape::Text);
                        row.insert(field.clone(), from_cell(cell, shape));
                    }
                    row
                })
                .collect()
        }
        Format::Json => {
            let items: Vec<Map<String, Json>> =
                serde_json::from_str(&input.data).map_err(|error| {
                    ApiError::BadRequest(format!("the file is not a JSON list of objects: {error}"))
                })?;
            check_rows(items.len())?;
            let mut seen = HashSet::new();
            items
                .into_iter()
                .map(|item| {
                    let mut row = Map::new();
                    for (key, value) in item {
                        match target(&key) {
                            Some(field) => {
                                row.insert(field, value);
                            }
                            None => {
                                if seen.insert(key.clone()) {
                                    ignored.push(key);
                                }
                            }
                        }
                    }
                    row
                })
                .collect()
        }
    };

    let service = if input.dry_run { state.service.dry_run() } else { state.service.clone() };
    let options = WriteOptions { publish: input.publish, actor: Some(principal.user.id) };
    let (mut created, mut updated, mut failed) = (0, 0, 0);
    let mut errors = Vec::new();
    for (index, mut row) in rows.into_iter().enumerate() {
        let document_id = match row.remove("documentId") {
            Some(Json::String(id)) if !id.trim().is_empty() => Some(id.trim().to_owned()),
            _ => None,
        };
        let data = Json::Object(row);
        let outcome = async {
            if let Some(id) = &document_id
                && let Some((_, grant)) = &update
            {
                ensure_owner(&state, &uid, id, &principal, *grant).await?;
                writable_fields(&principal, actions::CONTENT_UPDATE, &uid, &data)?;
                match service.update(&uid, id, &data, options).await {
                    Ok(()) => return Ok(false),
                    Err(ContentError::NotFound) => {}
                    Err(error) => return Err(ApiError::from(error)),
                }
            }
            if create.is_none() {
                return Err(ApiError::Forbidden);
            }
            writable_fields(&principal, actions::CONTENT_CREATE, &uid, &data)?;
            service.create(&uid, &data, options).await?;
            Ok::<bool, ApiError>(true)
        }
        .await;
        match outcome {
            Ok(true) => created += 1,
            Ok(false) => updated += 1,
            Err(error) => {
                failed += 1;
                if errors.len() < MAX_ERRORS {
                    errors.push(json!({
                        "row": index + 1,
                        "documentId": document_id,
                        "errors": row_errors(error),
                    }));
                }
            }
        }
    }
    Ok(AxumJson(json!({ "data": {
        "dryRun": input.dry_run,
        "created": created,
        "updated": updated,
        "failed": failed,
        "ignoredColumns": ignored,
        "errors": errors,
    }}))
    .into_response())
}

fn check_rows(count: usize) -> Result<(), ApiError> {
    if count > MAX_ROWS {
        return Err(ApiError::BadRequest(format!("at most {MAX_ROWS} rows per import")));
    }
    Ok(())
}

/// A row's problems, in the `ValidationError` detail format.
fn row_errors(error: ApiError) -> Json {
    match error {
        ApiError::Content(ContentError::Validation(issues)) => json!(issues),
        ApiError::Forbidden => json!([{ "path": [], "message": "Forbidden" }]),
        ApiError::BadRequest(message) | ApiError::Conflict(message) => {
            json!([{ "path": [], "message": message }])
        }
        ApiError::Content(error) => json!([{ "path": [], "message": error.to_string() }]),
        _ => json!([{ "path": [], "message": "the row could not be written" }]),
    }
}

/// A CSV cell in the write format of its attribute. Values that do not parse are passed
/// on as text, so that validation reports them.
fn from_cell(cell: &str, shape: Shape) -> Json {
    if cell.is_empty() {
        return match shape {
            Shape::Relation { many: true }
            | Shape::Media { many: true }
            | Shape::Morph { many: true } => Json::Array(Vec::new()),
            _ => Json::Null,
        };
    }
    let text = || Json::String(cell.to_owned());
    let list = || cell.split('|').map(str::trim).filter(|item| !item.is_empty());
    match shape {
        Shape::Text => Json::String(unguard_formula(cell).to_owned()),
        Shape::Integer => cell.trim().parse::<i64>().map_or_else(|_| text(), Json::from),
        Shape::Number => cell
            .trim()
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map_or_else(text, Json::Number),
        Shape::Decimal => Json::String(cell.trim().to_owned()),
        Shape::Boolean => match cell.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Json::Bool(true),
            "false" | "0" | "no" => Json::Bool(false),
            _ => text(),
        },
        Shape::Plain => Json::String(cell.trim().to_owned()),
        Shape::Structured => serde_json::from_str(cell).unwrap_or_else(|_| text()),
        Shape::Relation { many } => {
            let ids: Vec<Json> = list().map(|id| Json::String(id.to_owned())).collect();
            if many { Json::Array(ids) } else { ids.into_iter().next().unwrap_or(Json::Null) }
        }
        Shape::Media { many } => {
            let ids: Vec<Json> = list()
                .map(|id| {
                    id.parse::<i64>().map_or_else(|_| Json::String(id.to_owned()), Json::from)
                })
                .collect();
            if many { Json::Array(ids) } else { ids.into_iter().next().unwrap_or(Json::Null) }
        }
        Shape::Morph { many } => {
            let items: Vec<Json> = list()
                .map(|item| match item.rsplit_once(':') {
                    Some((uid, id)) => json!({ "__type": uid, "documentId": id }),
                    None => Json::String(item.to_owned()),
                })
                .collect();
            if many { Json::Array(items) } else { items.into_iter().next().unwrap_or(Json::Null) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_round_trips() {
        let mut out = String::new();
        write_record(&mut out, ["a", "b,c", "say \"hi\"", "two\nlines", ""].into_iter());
        let parsed = parse_csv(&format!("\u{feff}{out}\n")).unwrap();
        assert_eq!(parsed, [vec!["a", "b,c", "say \"hi\"", "two\nlines", ""]]);
        assert!(parse_csv("\"open").is_err());
        assert_eq!(parse_csv("x,y\n1,2").unwrap(), [vec!["x", "y"], vec!["1", "2"]]);
    }

    #[test]
    fn cells_follow_their_attribute() {
        assert_eq!(from_cell("42", Shape::Integer), json!(42));
        assert_eq!(from_cell("4x", Shape::Integer), json!("4x"), "validation reports it");
        assert_eq!(from_cell("yes", Shape::Boolean), json!(true));
        assert_eq!(from_cell("a|b", Shape::Relation { many: true }), json!(["a", "b"]));
        assert_eq!(from_cell("7", Shape::Media { many: false }), json!(7));
        assert_eq!(
            from_cell("api::page:x1", Shape::Morph { many: false }),
            json!({ "__type": "api::page", "documentId": "x1" })
        );
        assert_eq!(from_cell("{\"a\":1}", Shape::Structured), json!({ "a": 1 }));
        assert_eq!(from_cell("", Shape::Text), Json::Null);
        assert_eq!(to_cell(&json!("=SUM(A1)"), Shape::Text), "'=SUM(A1)");
        assert_eq!(from_cell("'=SUM(A1)", Shape::Text), json!("=SUM(A1)"));
        assert_eq!(from_cell("'quoted", Shape::Text), json!("'quoted"));
        assert_eq!(to_cell(&json!(["a", "b"]), Shape::Relation { many: true }), "a|b");
        assert_eq!(to_cell(&json!(-3), Shape::Integer), "-3", "numbers are not guarded");
    }
}
