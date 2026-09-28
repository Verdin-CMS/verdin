//! Review workflows: stages, stage permissions, assignees and the publish stage.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

const PASSWORD: &str = "correct horse 1";

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
                    "displayName": "Tag", "options": { "draftAndPublish": true },
                    "attributes": { "label": { "type": "string" } } })
            .to_string(),
        ),
    ])
    .unwrap()
}

async fn login(app: &App, email: &str) -> String {
    let body = json!({ "email": email, "password": PASSWORD });
    let (status, body) =
        app.call_as(Method::POST, "/admin/api/auth/login", Some(body), As::Anonymous).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

fn stage_id(workflow: &Value, name: &str) -> i64 {
    workflow["stages"].as_array().unwrap().iter().find(|stage| stage["name"] == name).unwrap()["id"]
        .as_i64()
        .unwrap()
}

#[tokio::test]
async fn stages_gate_publication() {
    let app = App::new(schema()).await;
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();
    let (_, roles) = app.call_as(Method::GET, "/admin/api/roles", None, As::Bearer(&admin)).await;
    let editor_role =
        roles["data"].as_array().unwrap().iter().find(|r| r["code"] == "editor").unwrap()["id"]
            .clone();
    let body = json!({ "email": "eve@example.com", "password": PASSWORD, "roles": [editor_role] });
    let (_, created) =
        app.call_as(Method::POST, "/admin/api/users", Some(body), As::Bearer(&admin)).await;
    let editor_id = created["data"]["id"].as_i64().unwrap();
    let editor = login(&app, "eve@example.com").await;

    let workflow = json!({
        "name": "Editorial",
        "contentTypes": ["api::article"],
        "stages": [
            { "name": "To do" },
            { "name": "In review", "color": "#ff8800" },
            { "name": "Ready", "roles": ["super-admin"] },
        ],
        "publishStage": "Ready",
    });
    let (status, created) = app
        .call_as(
            Method::POST,
            "/admin/api/review-workflows",
            Some(workflow.clone()),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let workflow_id = created["data"]["id"].as_i64().unwrap();
    let (todo, review, ready) = (
        stage_id(&created["data"], "To do"),
        stage_id(&created["data"], "In review"),
        stage_id(&created["data"], "Ready"),
    );
    assert_eq!(created["data"]["publishStageId"], ready);

    for (change, why) in [
        (
            json!({ "name": "Other", "contentTypes": ["api::article"], "stages": [{ "name": "A" }] }),
            "type already in a workflow",
        ),
        (
            json!({ "name": "Other", "contentTypes": ["api::nope"], "stages": [{ "name": "A" }] }),
            "unknown type",
        ),
        (
            json!({ "name": "Other", "stages": [{ "name": "A" }], "publishStage": "B" }),
            "unknown publish stage",
        ),
        (
            json!({ "name": "Other", "stages": [{ "name": "A" }, { "name": "a" }] }),
            "duplicate stage",
        ),
        (json!({ "name": "Other", "stages": [] }), "no stages"),
    ] {
        let (status, _) = app
            .call_as(Method::POST, "/admin/api/review-workflows", Some(change), As::Bearer(&admin))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{why}");
    }
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/review-workflows", None, As::Bearer(&editor)).await.0,
        StatusCode::FORBIDDEN
    );

    // New entries start at the first stage.
    let (_, entry) = app
        .call_as(
            Method::POST,
            "/admin/api/content/api::article",
            Some(json!({ "data": { "title": "Hi" } })),
            As::Bearer(&editor),
        )
        .await;
    let document_id = entry["data"]["documentId"].as_str().unwrap().to_owned();
    let stage_url = format!("/admin/api/content/api::article/{document_id}/review");
    let (_, current) = app.call_as(Method::GET, &stage_url, None, As::Bearer(&editor)).await;
    assert_eq!(current["data"]["stageId"], todo);
    assert_eq!(current["data"]["canMoveTo"], json!([todo, review]), "Ready is for super admins");

    let publish = format!("/admin/api/content/api::article/{document_id}/actions/publish");
    let (status, refused) = app.call_as(Method::POST, &publish, None, As::Bearer(&editor)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(refused["error"]["message"].as_str().unwrap().contains("Ready"), "{refused}");

    let (status, _) = app
        .call_as(Method::PUT, &stage_url, Some(json!({ "stageId": review })), As::Bearer(&editor))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .call_as(Method::PUT, &stage_url, Some(json!({ "stageId": ready })), As::Bearer(&editor))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, moved) = app
        .call_as(
            Method::PUT,
            &stage_url,
            Some(json!({ "stageId": ready, "assigneeId": editor_id })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{moved}");
    assert_eq!(moved["data"]["assigneeId"], editor_id);
    let (_, mine) =
        app.call_as(Method::GET, "/admin/api/review/assigned", None, As::Bearer(&editor)).await;
    assert_eq!(mine["data"][0]["documentId"], document_id.as_str());
    let (_, rows) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/content/api::article/review?documentIds={document_id},x"),
            None,
            As::Bearer(&editor),
        )
        .await;
    assert_eq!(rows["data"][0]["stageId"], ready);

    let (status, _) = app.call_as(Method::POST, &publish, None, As::Bearer(&editor)).await;
    assert_eq!(status, StatusCode::OK);

    // The content API is gated too; other types are not.
    let (_, from_api) = app
        .call(
            Method::POST,
            "/api/articles?status=draft",
            Some(json!({ "data": { "title": "API" } })),
        )
        .await;
    let api_id = from_api["data"]["documentId"].as_str().unwrap().to_owned();
    let (status, _) =
        app.call(Method::POST, &format!("/api/articles/{api_id}/actions/publish"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = app.post("/api/tags", json!({ "label": "free" })).await;
    assert_eq!(status, StatusCode::CREATED);

    // Removed stages send their entries back to the first stage.
    let api_url = format!("/admin/api/content/api::article/{api_id}/review");
    app.call_as(Method::PUT, &api_url, Some(json!({ "stageId": review })), As::Bearer(&admin))
        .await;
    let mut changed = workflow.clone();
    changed["stages"] = json!([{ "id": todo, "name": "To do" }, { "id": ready, "name": "Ready", "roles": ["super-admin"] }]);
    let (status, body) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/review-workflows/{workflow_id}"),
            Some(changed),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, current) = app.call_as(Method::GET, &api_url, None, As::Bearer(&admin)).await;
    assert_eq!(current["data"]["stageId"], todo);

    let (_, logs) = app
        .call_as(Method::GET, "/admin/api/audit-logs?action=entry.stage", None, As::Bearer(&admin))
        .await;
    assert_eq!(logs["meta"]["pagination"]["total"], 3);

    // Without the workflow, publishing is free again.
    let (status, _) = app
        .call_as(
            Method::DELETE,
            &format!("/admin/api/review-workflows/{workflow_id}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) =
        app.call(Method::POST, &format!("/api/articles/{api_id}/actions/publish"), None).await;
    assert_eq!(status, StatusCode::OK);
    app.done().await;
}
