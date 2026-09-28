//! Comments and tasks on entries.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

const PASSWORD: &str = "correct horse 1";

fn schema() -> Schema {
    Schema::parse(&[
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                    "displayName": "Article", "attributes": { "title": { "type": "string" } } })
            .to_string(),
        ),
        Source::content_type(
            "secret",
            json!({ "kind": "collectionType", "singularName": "secret", "pluralName": "secrets",
                    "displayName": "Secret", "attributes": { "code": { "type": "string" } } })
            .to_string(),
        ),
    ])
    .unwrap()
}

async fn call(
    app: &App,
    method: Method,
    uri: &str,
    body: Option<Value>,
    who: &str,
) -> (StatusCode, Value) {
    app.call_as(method, uri, body, As::Bearer(who)).await
}

async fn admin_user(app: &App, admin: &str, email: &str, role: &str) -> (i64, String) {
    let (_, roles) = call(app, Method::GET, "/admin/api/roles", None, admin).await;
    let role_id =
        roles["data"].as_array().unwrap().iter().find(|r| r["code"] == role).unwrap()["id"].clone();
    let (status, user) = call(
        app,
        Method::POST,
        "/admin/api/users",
        Some(
            json!({ "email": email, "password": PASSWORD, "firstname": email, "roles": [role_id] }),
        ),
        admin,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{user}");
    let (_, login) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/login",
            Some(json!({ "email": email, "password": PASSWORD })),
            As::Anonymous,
        )
        .await;
    (
        user["data"]["id"].as_i64().unwrap(),
        login["data"]["accessToken"].as_str().unwrap().to_owned(),
    )
}

#[tokio::test]
async fn comments_and_tasks() {
    let app = App::new(schema()).await;
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    // Editors may read articles but not secrets (a role limited to one type).
    let (_, role) = call(
        &app,
        Method::POST,
        "/admin/api/roles",
        Some(json!({ "code": "writer", "name": "Writer",
                     "permissions": [{ "action": "content.read", "subject": "api::article" }] })),
        &admin,
    )
    .await;
    assert!(role["data"]["id"].is_number(), "{role}");
    let (bob_id, bob) = admin_user(&app, &admin, "bob@example.com", "writer").await;
    let (_, article) = app.post("/api/articles", json!({ "title": "Hello" })).await;
    let article = article["data"]["documentId"].as_str().unwrap().to_owned();
    let (_, secret) = app.post("/api/secrets", json!({ "code": "x" })).await;
    let secret = secret["data"]["documentId"].as_str().unwrap().to_owned();

    let sent = app.emails.lock().unwrap().len();
    let (status, root) = call(
        &app,
        Method::POST,
        "/admin/api/comments",
        Some(json!({ "uid": "api::article", "documentId": article, "field": "title",
                     "body": format!("Can you check this, @[Bob](user:{bob_id})?") })),
        &admin,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{root}");
    assert_eq!(root["data"]["mentions"], json!([bob_id]));
    let emails = app.emails.lock().unwrap().clone();
    assert_eq!(emails.len(), sent + 1, "the mentioned admin is emailed");
    assert_eq!(emails.last().unwrap().to, "bob@example.com");
    assert!(
        emails.last().unwrap().text.contains(&format!("/admin/content/api::article/{article}"))
    );
    let root_id = root["data"]["id"].as_i64().unwrap();

    let (status, reply) = call(
        &app,
        Method::POST,
        "/admin/api/comments",
        Some(json!({ "uid": "api::article", "documentId": article, "parentId": root_id, "body": "Done." })),
        &bob,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{reply}");
    assert_eq!(reply["data"]["field"], "title", "replies share the thread's field");
    let reply_id = reply["data"]["id"].as_i64().unwrap();
    let (_, threads) = call(
        &app,
        Method::GET,
        &format!("/admin/api/comments?uid=api::article&documentId={article}"),
        None,
        &bob,
    )
    .await;
    assert_eq!(threads["data"].as_array().unwrap().len(), 1);
    assert_eq!(threads["data"][0]["replies"][0]["body"], "Done.");

    let (status, _) = call(
        &app,
        Method::PUT,
        &format!("/admin/api/comments/{root_id}"),
        Some(json!({ "body": "x" })),
        &bob,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "only the author edits");
    let (status, _) =
        call(&app, Method::POST, &format!("/admin/api/comments/{reply_id}/resolve"), None, &bob)
            .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "threads resolve from their root");
    let (_, resolved) =
        call(&app, Method::POST, &format!("/admin/api/comments/{root_id}/resolve"), None, &bob)
            .await;
    assert_eq!(resolved["data"]["resolvedBy"], bob_id);

    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/comments",
        Some(json!({ "uid": "api::secret", "documentId": secret, "body": "peek" })),
        &bob,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "types they cannot read");
    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/comments",
        Some(json!({ "uid": "api::article", "documentId": "nope", "body": "hi" })),
        &admin,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Tasks.
    let (status, refused) = call(
        &app,
        Method::POST,
        "/admin/api/tasks",
        Some(json!({ "uid": "api::secret", "documentId": secret, "title": "Rotate", "assigneeId": bob_id })),
        &admin,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "the assignee must read the entry: {refused}");
    let (status, task) = call(
        &app,
        Method::POST,
        "/admin/api/tasks",
        Some(json!({ "uid": "api::article", "documentId": article, "title": "Proofread",
                     "assigneeId": bob_id, "dueDate": "2026-10-01" })),
        &admin,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    assert_eq!(task["data"]["status"], "open");
    assert_eq!(app.emails.lock().unwrap().last().unwrap().subject, "New task: Proofread");
    let task_id = task["data"]["id"].as_i64().unwrap();
    let (_, mine) =
        call(&app, Method::GET, "/admin/api/tasks?mine=true&status=open", None, &bob).await;
    assert_eq!(mine["data"][0]["title"], "Proofread", "{mine}");
    let (_, done) = call(
        &app,
        Method::PUT,
        &format!("/admin/api/tasks/{task_id}"),
        Some(json!({ "status": "done" })),
        &bob,
    )
    .await;
    assert_eq!(done["data"]["status"], "done");
    assert!(done["data"]["completedAt"].is_string());
    let (status, _) =
        call(&app, Method::DELETE, &format!("/admin/api/tasks/{task_id}"), None, &bob).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "the assignee cannot delete it");

    // Deleting the entry drops its comments and tasks.
    let (status, _) = app.call(Method::DELETE, &format!("/api/articles/{article}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, mine) = call(&app, Method::GET, "/admin/api/tasks?mine=true", None, &bob).await;
    assert_eq!(mine["data"], json!([]));
    app.done().await;
}
