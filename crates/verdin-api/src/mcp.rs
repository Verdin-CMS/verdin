//! MCP server (the `mcp` feature): content and schema tools for AI agents over the
//! Model Context Protocol's Streamable HTTP transport, at `/mcp`. Requests are JSON-RPC
//! 2.0 `POST`s answered with JSON (no server-initiated streams, no sessions). Callers
//! authenticate like the content API (an API token, an end user's JWT, or public access)
//! and each tool checks the same permissions as the matching REST route.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use serde_json::{Map, Value, json};
use verdin_auth::{AuthError, AuthService, ContentAction, ContentActor};
use verdin_content::{DocumentService, WriteOptions};
use verdin_query::{Limits, Node, Status};
use verdin_schema::ContentTypeKind;

use crate::error::ApiError;

/// Protocol versions this server speaks, newest first.
const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

#[derive(Clone)]
struct McpState {
    service: DocumentService,
    auth: AuthService,
    limits: Limits,
    /// Browser `Origin`s allowed to call (DNS rebinding protection); empty: none.
    origins: Arc<Vec<String>>,
}

/// `POST {path}`; `GET` answers 405 (this server opens no streams).
pub fn router(
    service: DocumentService,
    auth: AuthService,
    limits: Limits,
    path: &str,
    origins: Vec<String>,
) -> Router {
    let state = McpState { service, auth, limits, origins: Arc::new(origins) };
    Router::new()
        .route(
            path,
            post(handle)
                .get(|| async { StatusCode::METHOD_NOT_ALLOWED })
                .delete(|| async { StatusCode::METHOD_NOT_ALLOWED }),
        )
        .with_state(state)
}

fn rpc_error(id: &Value, code: i64, message: impl Into<String>) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message.into() } })
}

fn rpc_result(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

async fn handle(State(state): State<McpState>, headers: HeaderMap, body: Bytes) -> Response {
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok())
        && !state.origins.iter().any(|allowed| allowed == origin)
    {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    let actor = match crate::handlers::bearer(&headers) {
        Ok(token) => match state.auth.content_actor(token).await {
            Ok(actor) => actor,
            Err(AuthError::Unauthorized) => return unauthorized(),
            Err(error) => return ApiError::from(error).into_response(),
        },
        Err(_) => return unauthorized(),
    };
    let message: Value = match serde_json::from_slice(&body) {
        Ok(message) => message,
        Err(error) => {
            let reply = rpc_error(&Value::Null, -32700, format!("parse error: {error}"));
            return (StatusCode::BAD_REQUEST, axum::Json(reply)).into_response();
        }
    };
    let reply = match message {
        Value::Array(batch) => {
            let mut replies = Vec::new();
            for item in batch {
                if let Some(reply) = one(&state, &actor, item).await {
                    replies.push(reply);
                }
            }
            if replies.is_empty() { None } else { Some(Value::Array(replies)) }
        }
        item => one(&state, &actor, item).await,
    };
    match reply {
        Some(reply) => axum::Json(reply).into_response(),
        // Notifications and responses from the client.
        None => StatusCode::ACCEPTED.into_response(),
    }
}

fn unauthorized() -> Response {
    let mut response = (StatusCode::UNAUTHORIZED, "an API token is required").into_response();
    response
        .headers_mut()
        .insert(header::WWW_AUTHENTICATE, header::HeaderValue::from_static("Bearer"));
    response
}

async fn one(state: &McpState, actor: &ContentActor, message: Value) -> Option<Value> {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str);
    let (Some(id), Some(method)) = (id, method) else {
        return None;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let asked = params["protocolVersion"].as_str().unwrap_or_default();
            let version = PROTOCOL_VERSIONS
                .iter()
                .find(|version| **version == asked)
                .unwrap_or(&PROTOCOL_VERSIONS[0]);
            rpc_result(
                &id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "verdin", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Content of a Verdin CMS. Start with list_content_types, \
                                     then find_entries. Queries use the REST API's syntax \
                                     (filters, sort, fields, populate, pagination).",
                }),
            )
        }
        "ping" => rpc_result(&id, json!({})),
        "tools/list" => rpc_result(&id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default();
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match call(state, actor, name, &arguments).await {
                Ok(value) => rpc_result(
                    &id,
                    json!({
                        "content": [{ "type": "text", "text": value.to_string() }],
                        "structuredContent": value,
                        "isError": false,
                    }),
                ),
                Err(ToolError::Unknown) => rpc_error(&id, -32602, format!("unknown tool `{name}`")),
                Err(ToolError::Failed(message)) => rpc_result(
                    &id,
                    json!({ "content": [{ "type": "text", "text": message }], "isError": true }),
                ),
            }
        }
        other => rpc_error(&id, -32601, format!("method `{other}` not found")),
    })
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": properties, "required": required },
    })
}

fn tools() -> Vec<Value> {
    let uid = json!({ "type": "string", "description": "Content type uid, e.g. api::article" });
    let document_id = json!({ "type": "string" });
    let locale = json!({ "type": "string", "description": "Locale code (localized types)" });
    let status = json!({ "type": "string", "enum": ["published", "draft"] });
    let query = json!({
        "type": "object",
        "description": "REST query as JSON: { filters, sort, fields, populate, pagination: { page, pageSize } }",
    });
    let data =
        json!({ "type": "object", "description": "Attribute values, as in the REST API's `data`" });
    vec![
        tool(
            "list_content_types",
            "Content types you can read, with their kind and attribute names.",
            json!({}),
            &[],
        ),
        tool(
            "get_content_type",
            "A content type's attributes (types, options, relations).",
            json!({ "uid": uid }),
            &["uid"],
        ),
        tool(
            "find_entries",
            "Entries of a content type, with REST filters, sorting, fields, populate and pagination.",
            json!({ "uid": uid, "query": query, "status": status, "locale": locale }),
            &["uid"],
        ),
        tool(
            "get_entry",
            "One entry by documentId (single types: omit documentId).",
            json!({ "uid": uid, "documentId": document_id, "query": query, "status": status, "locale": locale }),
            &["uid"],
        ),
        tool(
            "create_entry",
            "Creates an entry. `status: draft` saves a draft of draft-and-publish types.",
            json!({ "uid": uid, "data": data, "status": status, "locale": locale }),
            &["uid", "data"],
        ),
        tool(
            "update_entry",
            "Updates an entry (single types: omit documentId).",
            json!({ "uid": uid, "documentId": document_id, "data": data, "status": status, "locale": locale }),
            &["uid", "data"],
        ),
        tool(
            "delete_entry",
            "Deletes an entry.",
            json!({ "uid": uid, "documentId": document_id, "locale": locale }),
            &["uid", "documentId"],
        ),
        tool(
            "publish_entry",
            "Publishes an entry's draft.",
            json!({ "uid": uid, "documentId": document_id, "locale": locale }),
            &["uid", "documentId"],
        ),
        tool(
            "unpublish_entry",
            "Unpublishes an entry.",
            json!({ "uid": uid, "documentId": document_id, "locale": locale }),
            &["uid", "documentId"],
        ),
    ]
}

enum ToolError {
    Unknown,
    Failed(String),
}

impl From<ApiError> for ToolError {
    fn from(error: ApiError) -> Self {
        ToolError::Failed(match error {
            ApiError::Content(error) => error.to_string(),
            ApiError::BadRequest(message) | ApiError::Conflict(message) => message,
            ApiError::Forbidden => "Forbidden: the token does not grant this action".into(),
            ApiError::NotFound => "Not found".into(),
            other => format!("{other:?}"),
        })
    }
}

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

async fn call(
    state: &McpState,
    actor: &ContentActor,
    name: &str,
    args: &Value,
) -> Result<Value, ToolError> {
    let allow = |uid: &str, action: ContentAction| -> Result<(), ToolError> {
        if actor.allows(uid, action) { Ok(()) } else { Err(ApiError::Forbidden.into()) }
    };
    if !tools().iter().any(|tool| tool["name"] == name) {
        return Err(ToolError::Unknown);
    }
    let registry = state.service.registry();
    if name == "list_content_types" {
        let types: Vec<Value> = registry
            .types()
            .filter(|model| {
                let uid = &model.content_type.uid;
                actor.allows(uid, ContentAction::Find) || actor.allows(uid, ContentAction::FindOne)
            })
            .map(|model| {
                let content_type = &model.content_type;
                json!({
                    "uid": content_type.uid,
                    "displayName": content_type.display_name,
                    "kind": if content_type.kind == ContentTypeKind::SingleType { "singleType" } else { "collectionType" },
                    "draftAndPublish": content_type.draft_and_publish,
                    "localized": content_type.localized,
                    "attributes": content_type.attributes.iter()
                        .filter(|(_, attribute)| !attribute.private)
                        .map(|(name, attribute)| (name.clone(), json!(attribute.kind.type_name())))
                        .collect::<Map<String, Value>>(),
                })
            })
            .collect();
        return Ok(json!({ "contentTypes": types }));
    }
    let uid = args["uid"].as_str().ok_or_else(|| ToolError::Failed("`uid` is required".into()))?;
    let model = registry.get(uid).map_err(ApiError::from)?;
    if name == "get_content_type" {
        allow(uid, ContentAction::FindOne).or_else(|_| allow(uid, ContentAction::Find))?;
        let attributes: Map<String, Value> = model
            .content_type
            .attributes
            .iter()
            .filter(|(_, attribute)| !attribute.private)
            .map(|(name, attribute)| (name.clone(), crate::admin::attribute_json(attribute)))
            .collect();
        return Ok(json!({ "uid": uid, "attributes": attributes }));
    }
    let locale = args["locale"].as_str().map(str::to_owned);
    if let Some(code) = &locale
        && !verdin_content::locales::valid_code(code)
    {
        return Err(ToolError::Failed(format!("invalid locale `{code}`")));
    }
    let service = state.service.in_locale(locale);
    let mut root = match to_node(&args["query"]) {
        Node::Map(map) => map,
        Node::Leaf(_) => Default::default(),
    };
    if let Some(status) = args["status"].as_str() {
        root.insert("status".into(), Node::Leaf(status.to_owned()));
    }
    let query = verdin_query::parse(&root, &model.fields, registry.catalog(), &state.limits)
        .map_err(ApiError::from)?;
    let single = model.content_type.kind == ContentTypeKind::SingleType;
    let document_id = || -> Result<String, ToolError> {
        args["documentId"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| ToolError::Failed("`documentId` is required".into()))
    };
    let read_drafts = || {
        if query.status == Status::Draft { allow(uid, ContentAction::ReadDrafts) } else { Ok(()) }
    };
    let options = WriteOptions { publish: args["status"].as_str() != Some("draft"), actor: None };
    let data = || -> Result<&Value, ToolError> {
        args.get("data")
            .filter(|data| data.is_object())
            .ok_or_else(|| ToolError::Failed("`data` must be an object".into()))
    };
    match name {
        "find_entries" => {
            allow(uid, ContentAction::Find)?;
            read_drafts()?;
            let page = service.find_many(uid, &query).await.map_err(ApiError::from)?;
            Ok(json!({ "data": page.documents, "meta": { "pagination": page.meta } }))
        }
        "get_entry" => {
            allow(uid, ContentAction::FindOne)?;
            read_drafts()?;
            let id = if single {
                service
                    .single_document_id(uid)
                    .await
                    .map_err(ApiError::from)?
                    .ok_or(ApiError::NotFound)?
            } else {
                document_id()?
            };
            let document = service
                .find_one(uid, &id, &query)
                .await
                .map_err(ApiError::from)?
                .ok_or(ApiError::NotFound)?;
            Ok(json!({ "data": document }))
        }
        "create_entry" if !single => {
            allow(uid, ContentAction::Create)?;
            let id = service.create(uid, data()?, options).await.map_err(ApiError::from)?;
            Ok(json!({ "documentId": id }))
        }
        "update_entry" => {
            allow(uid, ContentAction::Update)?;
            if single {
                let id = match service.single_document_id(uid).await.map_err(ApiError::from)? {
                    Some(id) => {
                        service.update(uid, &id, data()?, options).await.map_err(ApiError::from)?;
                        id
                    }
                    None => service.create(uid, data()?, options).await.map_err(ApiError::from)?,
                };
                Ok(json!({ "documentId": id }))
            } else {
                let id = document_id()?;
                service.update(uid, &id, data()?, options).await.map_err(ApiError::from)?;
                Ok(json!({ "documentId": id }))
            }
        }
        "delete_entry" => {
            allow(uid, ContentAction::Delete)?;
            service.delete(uid, &document_id()?).await.map_err(ApiError::from)?;
            Ok(json!({ "deleted": true }))
        }
        "publish_entry" => {
            allow(uid, ContentAction::Publish)?;
            service.publish(uid, &document_id()?, None).await.map_err(ApiError::from)?;
            Ok(json!({ "published": true }))
        }
        "unpublish_entry" => {
            allow(uid, ContentAction::Publish)?;
            service.unpublish(uid, &document_id()?).await.map_err(ApiError::from)?;
            Ok(json!({ "unpublished": true }))
        }
        "create_entry" => {
            Err(ToolError::Failed("single types have no create; use update_entry".into()))
        }
        _ => Err(ToolError::Unknown),
    }
}
