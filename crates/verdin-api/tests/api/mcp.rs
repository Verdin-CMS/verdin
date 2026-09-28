//! The MCP server: JSON-RPC over Streamable HTTP, with content API permissions.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use verdin_auth::ContentAction;
use verdin_content::{DocumentService, OutputOptions, Registry};
use verdin_schema::{Schema, Source};

use crate::common::App;

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "options": { "draftAndPublish": true },
                "attributes": { "title": { "type": "string" }, "secret": { "type": "string", "private": true } } })
        .to_string(),
    )])
    .unwrap()
}

async fn rpc(
    router: &axum::Router,
    token: Option<&str>,
    body: Value,
    origin: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::post("/mcp")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(origin) = origin {
        request = request.header("origin", origin);
    }
    let response =
        router.clone().oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn call(id: i64, name: &str, arguments: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": arguments } })
}

#[tokio::test]
async fn tools_over_json_rpc() {
    let app = App::new(schema()).await;
    let service = DocumentService::new(
        app.test.db.clone(),
        Registry::new(schema()),
        OutputOptions::default(),
    );
    let router = verdin_api::mcp::router(
        service,
        app.auth.clone(),
        Default::default(),
        "/mcp",
        vec!["https://ok.example".into()],
    );
    let token = app.token.clone();
    let token = Some(token.as_str());

    let (status, init) = rpc(
        &router,
        token,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } } }),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{init}");
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(init["result"]["serverInfo"]["name"], "verdin");
    let (status, _) = rpc(
        &router,
        token,
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let (_, listed) =
        rpc(&router, token, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }), None)
            .await;
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"find_entries") && names.contains(&"create_entry"), "{names:?}");

    let (_, created) = rpc(
        &router,
        token,
        call(
            3,
            "create_entry",
            json!({ "uid": "api::article", "data": { "title": "Hello", "secret": "x" } }),
        ),
        None,
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created}");
    let id = created["result"]["structuredContent"]["documentId"].as_str().unwrap().to_owned();
    let (_, found) = rpc(
        &router,
        token,
        call(4, "find_entries", json!({ "uid": "api::article", "query": { "filters": { "title": { "$eq": "Hello" } }, "fields": ["title"] } })),
        None,
    )
    .await;
    let entries = &found["result"]["structuredContent"]["data"];
    assert_eq!(entries[0]["documentId"], id.as_str(), "{found}");
    assert!(entries[0].get("secret").is_none());
    let (_, types) = rpc(&router, token, call(5, "list_content_types", json!({})), None).await;
    let article = &types["result"]["structuredContent"]["contentTypes"][0];
    assert_eq!(article["uid"], "api::article");
    assert!(article["attributes"].get("secret").is_none(), "private attributes stay hidden");

    // Errors: tool failures are results, unknown tools and methods are JSON-RPC errors.
    let (_, failed) = rpc(
        &router,
        token,
        call(6, "get_entry", json!({ "uid": "api::article", "documentId": "nope" })),
        None,
    )
    .await;
    assert_eq!(failed["result"]["isError"], true);
    let (_, unknown) = rpc(&router, token, call(7, "drop_database", json!({})), None).await;
    assert_eq!(unknown["error"]["code"], -32602);
    let (_, missing) =
        rpc(&router, token, json!({ "jsonrpc": "2.0", "id": 8, "method": "resources/list" }), None)
            .await;
    assert_eq!(missing["error"]["code"], -32601);

    // Public access: only what the public role grants; unknown browser origins refused.
    app.auth.set_public_grants(&[("api::article".into(), ContentAction::Find)]).await.unwrap();
    let (_, public) =
        rpc(&router, None, call(9, "find_entries", json!({ "uid": "api::article" })), None).await;
    assert_eq!(public["result"]["isError"], false, "{public}");
    let (_, refused) = rpc(
        &router,
        None,
        call(10, "delete_entry", json!({ "uid": "api::article", "documentId": id })),
        None,
    )
    .await;
    assert_eq!(refused["result"]["isError"], true);
    assert!(refused["result"]["content"][0]["text"].as_str().unwrap().contains("Forbidden"));
    let (status, _) = rpc(
        &router,
        token,
        json!({ "jsonrpc": "2.0", "id": 11, "method": "ping" }),
        Some("https://evil.example"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = rpc(
        &router,
        token,
        json!({ "jsonrpc": "2.0", "id": 12, "method": "ping" }),
        Some("https://ok.example"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    app.done().await;
}
