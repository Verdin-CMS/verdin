//! Settings → Plugins: installed plugins, their switches, settings and logs
//! (`plugins.manage`), and the admin extensions of enabled plugins (any admin).

use axum::Router;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::get;
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::actions;
use verdin_plugins::{Plugin, Plugins};

use super::{AdminState, ApiResult, body, data, principal, require};
use crate::error::ApiError;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/plugins", get(list))
        .route("/plugins/extensions", get(extensions))
        .route("/plugins/{name}", axum::routing::put(update))
        .route("/plugins/{name}/logs", get(logs))
}

fn service(state: &AdminState) -> Result<&Plugins, ApiError> {
    state.config.plugins.as_ref().ok_or(ApiError::NotFound)
}

/// URL of a file under a plugin's `admin/` directory.
fn asset_url(state: &AdminState, plugin: &Plugin, file: &str) -> String {
    format!("{}/plugins/{}/{file}", state.config.path, plugin.manifest.name)
}

fn plugin_json(state: &AdminState, plugin: &Plugin) -> Value {
    let manifest = &plugin.manifest;
    json!({
        "name": manifest.name,
        "version": manifest.version,
        "description": manifest.description,
        "enabled": plugin.enabled(),
        "settings": plugin.settings(),
        "settingsForm": manifest.settings,
        "capabilities": manifest.capabilities,
        "limits": manifest.limits,
        "hooks": manifest.hooks,
        "routes": manifest.routes.as_ref().map(|_| format!("/plugins/{}", manifest.name)),
        "jobs": manifest.jobs,
        "startup": manifest.startup,
        "admin": {
            "script": manifest.admin.script.as_deref().map(|file| asset_url(state, plugin, file)),
            "widgets": manifest.admin.widgets,
            "fields": manifest.admin.fields,
        },
    })
}

async fn list(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::PLUGINS_MANAGE).await?;
    let plugins = service(&state)?;
    Ok(data(json!({
        "plugins": plugins.list().iter().map(|plugin| plugin_json(&state, plugin)).collect::<Vec<_>>(),
        "errors": plugins
            .errors()
            .iter()
            .map(|(dir, error)| json!({ "dir": dir.display().to_string(), "error": error }))
            .collect::<Vec<_>>(),
    })))
}

/// Widgets and custom fields of enabled plugins, for the panel to load.
async fn extensions(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    principal(&state, &headers).await?;
    let Some(plugins) = state.config.plugins.as_ref() else { return Ok(data(json!([]))) };
    let list: Vec<Value> = plugins
        .list()
        .iter()
        .filter(|plugin| plugin.enabled())
        .filter(|plugin| plugin.manifest.admin.script.is_some())
        .map(|plugin| {
            let admin = &plugin.manifest.admin;
            json!({
                "plugin": plugin.manifest.name,
                "script": admin.script.as_deref().map(|file| asset_url(&state, plugin, file)),
                "widgets": admin.widgets,
                "fields": admin.fields,
            })
        })
        .collect();
    Ok(data(list))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    enabled: bool,
    settings: Option<Value>,
}

async fn update(
    State(state): State<AdminState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::PLUGINS_MANAGE).await?;
    let plugins = service(&state)?;
    let plugin = plugins.get(&name).ok_or(ApiError::NotFound)?.clone();
    let change: Change = body(&bytes)?;
    if let Some(settings) = &change.settings {
        plugin.manifest.check_settings(settings).map_err(ApiError::BadRequest)?;
    }
    let db = state.service.db();
    let internal = |error: verdin_db::DbError| ApiError::Internal(error.to_string());
    let mut states = crate::plugins::load_states(db).await.map_err(internal)?;
    states[&name] = json!({
        "enabled": change.enabled,
        "settings": change.settings.unwrap_or_else(|| plugin.settings()),
    });
    crate::plugins::save_states(db, &states).await.map_err(internal)?;
    // Switched on or new settings: its startup function runs in the background.
    plugins.spawn_startup(plugins.apply(&states));
    tracing::info!(plugin = %name, enabled = change.enabled, "plugin switched");
    Ok(data(plugin_json(&state, &plugin)))
}

async fn logs(
    State(state): State<AdminState>,
    Path(name): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::PLUGINS_MANAGE).await?;
    let plugin = service(&state)?.get(&name).ok_or(ApiError::NotFound)?;
    Ok(data(plugin.logs()))
}
