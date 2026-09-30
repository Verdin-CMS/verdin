//! Plugins on the content API: their routes (`/plugins/{name}/…`), the content host their
//! `verdin_content` calls go through, and their stored switches and settings.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};
use verdin_auth::{AuthService, ContentActor};
use verdin_content::events::BoxFuture;
use verdin_content::{DocumentService, WriteOptions};
use verdin_db::{ColumnKind as K, Database, SqlValue as V};
use verdin_migrate::system::SETTINGS;
use verdin_plugins::{PluginError, PluginHost, Plugins};
use verdin_query::{Limits, Node};

use crate::error::ApiError;

const STATES_KEY: &str = "plugins";
/// Response headers a plugin may set.
const ALLOWED_HEADERS: &[&str] =
    &["content-type", "cache-control", "location", "etag", "last-modified", "content-disposition"];

/// Content operations for plugins: writes go through the Document Service without the
/// plugins' before-write hooks (a plugin must not trigger itself) but with the listeners
/// and the platform's hooks (review stages). Also the public role's permissions.
pub struct ContentHost {
    service: DocumentService,
    auth: AuthService,
    limits: Limits,
}

impl ContentHost {
    pub fn new(service: &DocumentService, auth: &AuthService, limits: Limits) -> Self {
        Self { service: service.without_plugin_hooks(), auth: auth.clone(), limits }
    }

    /// `{ op: get }` or `{ op: set, permissions: [{ subject, action }] }` (replaces them
    /// all) → `{ permissions: [...] }`, sorted.
    async fn public_permissions(&self, request: &Value) -> Result<Value, ApiError> {
        match request["op"].as_str().unwrap_or_default() {
            "get" => {}
            "set" => {
                let list = request["permissions"]
                    .as_array()
                    .ok_or_else(|| ApiError::BadRequest("permissions must be an array".into()))?;
                let pairs = list
                    .iter()
                    .map(|grant| match (grant["subject"].as_str(), grant["action"].as_str()) {
                        (Some(subject), Some(action)) => {
                            Ok((subject.to_owned(), action.to_owned()))
                        }
                        _ => Err(ApiError::BadRequest(
                            "each permission needs a subject and an action".into(),
                        )),
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let grants = crate::admin::parse_grants(self.service.registry(), pairs)?;
                self.auth.set_public_grants(&grants).await?;
            }
            op => return Err(ApiError::BadRequest(format!("unknown operation `{op}`"))),
        }
        let mut list: Vec<Value> = self
            .auth
            .public_grants()
            .await?
            .into_iter()
            .map(|(subject, action)| json!({ "subject": subject, "action": action.as_str() }))
            .collect();
        list.sort_by_key(|grant| grant.to_string());
        Ok(json!({ "permissions": list }))
    }
}

fn host_error(error: ApiError) -> String {
    match error {
        ApiError::Content(error) => error.to_string(),
        ApiError::BadRequest(message) | ApiError::Conflict(message) => message,
        other => format!("{other:?}"),
    }
}

/// A JSON query object (`{ filters: { title: { $eq: "x" } }, sort: ["title"] }`) as the
/// REST parameter tree.
fn to_node(value: &Value) -> Node {
    match value {
        Value::Object(map) => {
            Node::Map(map.iter().map(|(key, value)| (key.clone(), to_node(value))).collect())
        }
        Value::Array(items) => Node::Map(
            items
                .iter()
                .enumerate()
                .map(|(index, value)| (index.to_string(), to_node(value)))
                .collect(),
        ),
        Value::String(text) => Node::Leaf(text.clone()),
        other => Node::Leaf(other.to_string()),
    }
}

impl ContentHost {
    async fn run(&self, request: &Value) -> Result<Value, ApiError> {
        let uid = request["uid"].as_str().unwrap_or_default();
        let locale = request["locale"].as_str().map(str::to_owned);
        if let Some(code) = &locale
            && !verdin_content::locales::valid_code(code)
        {
            return Err(ApiError::BadRequest(format!("invalid locale `{code}`")));
        }
        let service = self.service.in_locale(locale);
        let model = service.registry().get(uid)?;
        let query = || -> Result<verdin_query::Query, ApiError> {
            let root = match to_node(&request["query"]) {
                Node::Map(map) => map,
                Node::Leaf(_) => Default::default(),
            };
            Ok(verdin_query::parse(
                &root,
                &model.fields,
                service.registry().catalog(),
                &self.limits,
            )?)
        };
        let document_id = || {
            request["documentId"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| ApiError::BadRequest("documentId is required".into()))
        };
        let options =
            WriteOptions { publish: request["status"].as_str() != Some("draft"), actor: None };
        let data = &request["data"];
        Ok(match request["op"].as_str().unwrap_or_default() {
            "findMany" => {
                let page = service.find_many(uid, &query()?).await?;
                json!({ "documents": page.documents, "meta": { "pagination": page.meta } })
            }
            "findOne" => {
                json!({ "document": service.find_one(uid, &document_id()?, &query()?).await? })
            }
            "create" => {
                let id = service.create(uid, data, options).await?;
                json!({ "documentId": id })
            }
            "update" => {
                let id = document_id()?;
                service.update(uid, &id, data, options).await?;
                json!({ "documentId": id })
            }
            "delete" => {
                service.delete(uid, &document_id()?).await?;
                json!({ "deleted": true })
            }
            "publish" => {
                service.publish(uid, &document_id()?, None).await?;
                json!({ "published": true })
            }
            "unpublish" => {
                service.unpublish(uid, &document_id()?).await?;
                json!({ "unpublished": true })
            }
            op => return Err(ApiError::BadRequest(format!("unknown operation `{op}`"))),
        })
    }
}

impl PluginHost for ContentHost {
    fn content<'a>(&'a self, request: &'a Value) -> BoxFuture<'a, Result<Value, String>> {
        Box::pin(async move { self.run(request).await.map_err(host_error) })
    }

    fn public_permissions<'a>(
        &'a self,
        request: &'a Value,
    ) -> BoxFuture<'a, Result<Value, String>> {
        Box::pin(async move {
            let result = self.public_permissions(request).await.map_err(host_error);
            if result.is_ok() && request["op"] == "set" {
                tracing::info!("public permissions replaced by a plugin");
            }
            result
        })
    }
}

/// Switches and settings of every plugin (`vd_settings`, key `plugins`).
pub async fn load_states(db: &Database) -> Result<Value, verdin_db::DbError> {
    let key = key_column(db);
    let rows = db
        .queries()
        .fetch_all(
            &format!("SELECT value FROM {SETTINGS} WHERE {key} = ?"),
            &[V::from(STATES_KEY)],
            &[K::Json],
        )
        .await?;
    Ok(match rows.into_iter().next().and_then(|row| row.into_iter().next()) {
        Some(V::Json(value)) if value.is_object() => value,
        _ => json!({}),
    })
}

pub async fn save_states(db: &Database, states: &Value) -> Result<(), verdin_db::DbError> {
    let key = key_column(db);
    let mut tx = db.begin().await?;
    tx.execute(&format!("DELETE FROM {SETTINGS} WHERE {key} = ?"), &[V::from(STATES_KEY)]).await?;
    tx.execute(
        &format!("INSERT INTO {SETTINGS} ({key}, value, updated_at) VALUES (?, ?, ?)"),
        &[
            V::from(STATES_KEY),
            V::Json(states.clone()),
            V::DateTime(verdin_db::value::truncate_millis(time::OffsetDateTime::now_utc())),
        ],
    )
    .await?;
    tx.commit().await
}

fn key_column(db: &Database) -> &'static str {
    if db.flavor().is_mysql_family() { "`key`" } else { "\"key\"" }
}

#[derive(Clone)]
pub(crate) struct RouteState {
    pub plugins: Plugins,
    pub auth: AuthService,
}

pub(crate) fn routes(plugins: Plugins, auth: AuthService) -> axum::Router {
    let handler = axum::routing::any(handle);
    axum::Router::new()
        .route("/plugins/{name}", handler.clone())
        .route("/plugins/{name}/{*path}", handler)
        .with_state(RouteState { plugins, auth })
}

async fn handle(
    State(state): State<RouteState>,
    method: Method,
    Path(params): Path<Vec<(String, String)>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let name = params
        .iter()
        .find(|(key, _)| key == "name")
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    let path = params.iter().find(|(key, _)| key == "path").map_or("", |(_, value)| value.as_str());
    let actor = match state.auth.content_actor(crate::handlers::bearer(&headers)?).await {
        Ok(ContentActor::Public(_)) => json!({ "kind": "public" }),
        Ok(ContentActor::Token { id, .. }) => json!({ "kind": "token", "id": id }),
        Ok(ContentActor::User { id, .. }) => json!({ "kind": "user", "id": id }),
        Err(_) => return Err(ApiError::Unauthorized),
    };
    let mut forwarded = Map::new();
    for name in ["content-type", "accept", "user-agent", "accept-language"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            forwarded.insert(name.into(), json!(value));
        }
    }
    let request = json!({
        "method": method.as_str(),
        "path": format!("/{path}"),
        "query": raw.unwrap_or_default(),
        "headers": forwarded,
        "body": String::from_utf8_lossy(&body),
        "actor": actor,
    });
    let output = match state.plugins.handle(&name, &request).await {
        Ok(output) => output,
        Err(PluginError::NotFound | PluginError::Disabled) => return Err(ApiError::NotFound),
        Err(error) => {
            tracing::warn!(plugin = %name, %error, "plugin route failed");
            return Ok((StatusCode::BAD_GATEWAY, axum::Json(json!({ "data": null, "error": {
                "status": 502, "name": "PluginError", "message": "The plugin failed to answer", "details": {}
            } })))
                .into_response());
        }
    };
    let status = output["status"]
        .as_u64()
        .and_then(|status| StatusCode::from_u16(status as u16).ok())
        .unwrap_or(StatusCode::OK);
    let mut response = match &output["body"] {
        Value::String(text) => (status, text.clone()).into_response(),
        Value::Null => status.into_response(),
        body => (status, axum::Json(body.clone())).into_response(),
    };
    if let Some(extra) = output["headers"].as_object() {
        for (key, value) in extra {
            let key = key.to_ascii_lowercase();
            if !ALLOWED_HEADERS.contains(&key.as_str()) {
                continue;
            }
            if let (Ok(name), Some(Ok(value))) =
                (HeaderName::from_bytes(key.as_bytes()), value.as_str().map(HeaderValue::from_str))
            {
                response.headers_mut().insert(name, value);
            }
        }
    }
    Ok(response)
}

/// Content types of the host, for the plugin host (kept alive with the app).
pub fn content_host(
    service: &DocumentService,
    auth: &AuthService,
    limits: Limits,
) -> Arc<dyn PluginHost> {
    Arc::new(ContentHost::new(service, auth, limits))
}
