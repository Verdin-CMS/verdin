//! Releases: entries published or unpublished together, now or when their date comes.

use crate::common::{App, As};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                    "displayName": "Article", "options": { "draftAndPublish": true },
                    "attributes": { "title": { "type": "string" } } })
            .to_string(),
        ),
        Source::content_type(
            "tag",
            json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags",
                    "displayName": "Tag", "options": { "draftAndPublish": false },
                    "attributes": { "label": { "type": "string" } } })
            .to_string(),
        ),
    ])
    .unwrap()
}

async fn admin(app: &App) -> String {
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    registered["data"]["accessToken"].as_str().unwrap().to_owned()
}

async fn draft(app: &App, admin: &str, title: &str) -> String {
    let (status, created) = app
        .call_as(
            Method::POST,
            "/admin/api/content/api::article",
            Some(json!({ "data": { "title": title } })),
            As::Bearer(admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    created["data"]["documentId"].as_str().unwrap().to_owned()
}

async fn published_titles(app: &App) -> Vec<String> {
    let (_, list) = app.get("/api/articles?sort=title").await;
    list["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["title"].as_str().unwrap().to_owned())
        .collect()
}

fn action(uid: &str, document_id: &str, action: &str) -> Value {
    json!({ "uid": uid, "documentId": document_id, "action": action })
}

#[tokio::test]
async fn publishes_together_and_on_schedule() {
    let app = App::new(schema()).await;
    let admin = admin(&app).await;
    let first = draft(&app, &admin, "First").await;
    let second = draft(&app, &admin, "Second").await;

    let (status, release) = app
        .call_as(
            Method::POST,
            "/admin/api/releases",
            Some(json!({ "name": "Launch" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{release}");
    assert_eq!(release["data"]["status"], "pending");
    let id = release["data"]["id"].as_i64().unwrap();
    let actions = format!("/admin/api/releases/{id}/actions");

    for document_id in [&first, &second] {
        let (status, body) = app
            .call_as(
                Method::POST,
                &actions,
                Some(action("api::article", document_id, "publish")),
                As::Bearer(&admin),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    // Adding the same entry again replaces its action.
    let (_, release) = app
        .call_as(
            Method::POST,
            &actions,
            Some(action("api::article", &second, "publish")),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(release["data"]["actions"].as_array().unwrap().len(), 2);

    // Refused: no draft and publish, unknown entry, unknown action.
    let (_, tag) = app.post("/api/tags", json!({ "label": "rust" })).await;
    let tag_id = tag["data"]["documentId"].as_str().unwrap();
    let refused = [
        (action("api::tag", tag_id, "publish"), StatusCode::BAD_REQUEST),
        (action("api::article", "missing", "publish"), StatusCode::NOT_FOUND),
        (action("api::article", &first, "archive"), StatusCode::BAD_REQUEST),
    ];
    for (body, expected) in refused {
        assert_eq!(
            app.call_as(Method::POST, &actions, Some(body), As::Bearer(&admin)).await.0,
            expected
        );
    }

    let (_, of_entry) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/content/api::article/{first}/releases"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(of_entry["data"][0]["name"], "Launch");

    assert!(published_titles(&app).await.is_empty());
    let (status, done) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/releases/{id}/publish"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["data"]["status"], "done");
    assert!(
        done["data"]["actions"].as_array().unwrap().iter().all(|action| action["status"] == "done")
    );
    assert_eq!(published_titles(&app).await, ["First", "Second"]);

    // A release runs once and can no longer change.
    let (status, _) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/releases/{id}/publish"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/releases/{id}"),
            Some(json!({ "name": "Renamed" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Scheduled: runs when due, not before.
    let (_, later) = app
        .call_as(
            Method::POST,
            "/admin/api/releases",
            Some(json!({ "name": "Later", "scheduledAt": "2999-01-01T00:00:00Z" })),
            As::Bearer(&admin),
        )
        .await;
    let later = later["data"]["id"].as_i64().unwrap();
    app.call_as(
        Method::POST,
        &format!("/admin/api/releases/{later}/actions"),
        Some(action("api::article", &first, "unpublish")),
        As::Bearer(&admin),
    )
    .await;
    assert_eq!(app.releases.run_due().await.unwrap(), 0);
    let (status, _) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/releases/{later}"),
            Some(json!({ "name": "Later", "scheduledAt": "2001-01-01T00:00:00Z" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(app.releases.run_due().await.unwrap(), 1);
    assert_eq!(published_titles(&app).await, ["Second"]);

    let (_, pending) = app
        .call_as(Method::GET, "/admin/api/releases?status=pending", None, As::Bearer(&admin))
        .await;
    assert_eq!(pending["data"], json!([]));
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/releases", None, As::Anonymous).await.0,
        StatusCode::UNAUTHORIZED
    );
    app.done().await;
}

#[tokio::test]
async fn records_failed_actions() {
    let app = App::new(schema()).await;
    let admin = admin(&app).await;
    let kept = draft(&app, &admin, "Kept").await;
    let gone = draft(&app, &admin, "Gone").await;
    let (_, release) = app
        .call_as(
            Method::POST,
            "/admin/api/releases",
            Some(json!({ "name": "Mixed" })),
            As::Bearer(&admin),
        )
        .await;
    let id = release["data"]["id"].as_i64().unwrap();
    for document_id in [&kept, &gone] {
        app.call_as(
            Method::POST,
            &format!("/admin/api/releases/{id}/actions"),
            Some(action("api::article", document_id, "publish")),
            As::Bearer(&admin),
        )
        .await;
    }
    app.call_as(
        Method::DELETE,
        &format!("/admin/api/content/api::article/{gone}"),
        None,
        As::Bearer(&admin),
    )
    .await;

    let (_, done) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/releases/{id}/publish"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(done["data"]["status"], "failed", "{done}");
    let statuses: Vec<&str> = done["data"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|action| action["status"].as_str().unwrap())
        .collect();
    assert_eq!(statuses, ["done", "failed"]);
    assert_eq!(published_titles(&app).await, ["Kept"]);

    let (status, _) = app
        .call_as(Method::DELETE, &format!("/admin/api/releases/{id}"), None, As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    app.done().await;
}
