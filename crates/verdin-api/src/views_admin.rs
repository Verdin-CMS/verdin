//! The entry editor's layout per content type, shared by every admin (Strapi's "configure
//! the view"): field order and width, and per-field label, description, placeholder,
//! whether it can be edited, and the field that names related entries. Stored in
//! `vd_settings` under `edit-views`; `views.manage` changes it.

use std::collections::{BTreeMap, HashSet};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use verdin_auth::{Grant, actions};
use verdin_db::{ColumnKind as K, Database, SqlValue as V};
use verdin_migrate::system::SETTINGS;
use verdin_schema::AttributeKind;

use super::{AdminState, ApiResult, body, data, principal, require};
use crate::error::ApiError;

const KEY: &str = "edit-views";
/// A row is 12 columns wide.
const ROW: u8 = 12;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditView {
    /// Rows of fields; a field's `size` is its width out of 12.
    #[serde(default)]
    pub layout: Vec<Vec<LayoutItem>>,
    #[serde(default)]
    pub fields: BTreeMap<String, FieldSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutItem {
    pub name: String,
    pub size: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// `false` shows the field read-only in the editor (the API still accepts it).
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub editable: bool,
    /// Relations: the target's field shown for related entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_field: Option<String>,
}

fn yes() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

pub(super) fn routes() -> Router<AdminState> {
    Router::new().route("/content-types/{uid}/edit-view", get(read).put(update).delete(reset))
}

fn key_column(db: &Database) -> &'static str {
    if db.flavor().is_mysql_family() { "`key`" } else { "\"key\"" }
}

async fn load(db: &Database) -> Result<BTreeMap<String, EditView>, ApiError> {
    let rows = db
        .queries()
        .fetch_all(
            &format!("SELECT value FROM {SETTINGS} WHERE {} = ?", key_column(db)),
            &[V::from(KEY)],
            &[K::Json],
        )
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    Ok(match rows.into_iter().next().and_then(|row| row.into_iter().next()) {
        Some(V::Json(value)) => serde_json::from_value(value).unwrap_or_default(),
        _ => BTreeMap::new(),
    })
}

async fn save(db: &Database, views: &BTreeMap<String, EditView>) -> Result<(), ApiError> {
    let internal = |error: verdin_db::DbError| ApiError::Internal(error.to_string());
    let key = key_column(db);
    let mut tx = db.begin().await.map_err(internal)?;
    tx.execute(&format!("DELETE FROM {SETTINGS} WHERE {key} = ?"), &[V::from(KEY)])
        .await
        .map_err(internal)?;
    tx.execute(
        &format!("INSERT INTO {SETTINGS} ({key}, value, updated_at) VALUES (?, ?, ?)"),
        &[
            V::from(KEY),
            V::Json(serde_json::to_value(views).expect("views serialize")),
            V::DateTime(verdin_db::value::truncate_millis(time::OffsetDateTime::now_utc())),
        ],
    )
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)
}

/// Fields that go into the layout (every attribute; relations and media included).
fn validate(state: &AdminState, uid: &str, view: &EditView) -> Result<(), ApiError> {
    let model = state.service.registry().get(uid)?;
    let attributes = &model.content_type.attributes;
    let bad = |message: String| Err(ApiError::BadRequest(message));
    let mut seen = HashSet::new();
    for row in &view.layout {
        let width: u32 = row.iter().map(|item| u32::from(item.size)).sum();
        if row.is_empty() || width > u32::from(ROW) {
            return bad(format!("each row holds 1 to {ROW} columns of fields"));
        }
        for item in row {
            if !attributes.contains_key(&item.name) {
                return bad(format!("unknown field `{}`", item.name));
            }
            if item.size == 0 || item.size > ROW {
                return bad(format!("`{}`: sizes are 1 to {ROW}", item.name));
            }
            if !seen.insert(item.name.as_str()) {
                return bad(format!("`{}` is placed twice", item.name));
            }
        }
    }
    for (name, settings) in &view.fields {
        let Some(attribute) = attributes.get(name) else {
            return bad(format!("unknown field `{name}`"));
        };
        for text in
            [&settings.label, &settings.description, &settings.placeholder].into_iter().flatten()
        {
            if text.chars().count() > 500 {
                return bad(format!("`{name}`: texts have at most 500 characters"));
            }
        }
        if let Some(main) = &settings.main_field {
            let AttributeKind::Relation { target, .. } = &attribute.kind else {
                return bad(format!("`{name}` is not a relation"));
            };
            let target = state.service.registry().get(target)?;
            let scalar = target.content_type.attributes.get(main).is_some_and(|attribute| {
                !attribute.private
                    && matches!(
                        attribute.kind,
                        AttributeKind::String { .. }
                            | AttributeKind::Email { .. }
                            | AttributeKind::Uid { .. }
                            | AttributeKind::Text { .. }
                            | AttributeKind::Enumeration { .. }
                            | AttributeKind::Integer { .. }
                            | AttributeKind::BigInteger { .. }
                            | AttributeKind::Float { .. }
                            | AttributeKind::Decimal { .. }
                            | AttributeKind::Date { .. }
                            | AttributeKind::DateTime { .. }
                    )
            });
            if !scalar && main != "id" && main != "documentId" {
                return bad(format!("`{name}`: `{main}` cannot name related entries"));
            }
        }
    }
    Ok(())
}

/// `GET /content-types/{uid}/edit-view`: `null` until someone configures it.
async fn read(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    state.service.registry().get(&uid)?;
    let principal = principal(&state, &headers).await?;
    let readable = [actions::CONTENT_READ, actions::CONTENT_CREATE, actions::CONTENT_UPDATE]
        .iter()
        .any(|action| principal.permissions.content(action, &uid) != Grant::None);
    if !readable && !principal.permissions.allows(actions::VIEWS_MANAGE) {
        return Err(ApiError::Forbidden);
    }
    Ok(data(load(state.service.db()).await?.remove(&uid).map_or(Value::Null, |view| json!(view))))
}

async fn update(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::VIEWS_MANAGE).await?;
    let view: EditView = body(&bytes)?;
    validate(&state, &uid, &view)?;
    let mut views = load(state.service.db()).await?;
    views.insert(uid, view.clone());
    save(state.service.db(), &views).await?;
    Ok(data(view))
}

async fn reset(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::VIEWS_MANAGE).await?;
    let mut views = load(state.service.db()).await?;
    views.remove(&uid);
    save(state.service.db(), &views).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
