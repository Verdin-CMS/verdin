//! The entry editor's layout per content type.

use axum::http::{Method, StatusCode};
use serde_json::json;
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

#[tokio::test]
async fn edit_views_are_shared_and_validated() {
    let schema = Schema::parse(&[
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                    "displayName": "Article",
                    "attributes": {
                        "title": { "type": "string" }, "body": { "type": "text" },
                        "author": { "type": "relation", "relation": "manyToOne", "target": "api::person.person" }
                    } })
            .to_string(),
        ),
        Source::content_type(
            "person",
            json!({ "kind": "collectionType", "singularName": "person", "pluralName": "people",
                    "displayName": "Person", "attributes": { "name": { "type": "string" } } })
            .to_string(),
        ),
    ])
    .unwrap();
    let app = App::new(schema).await;
    let body = json!({ "email": "ada@example.com", "password": "correct horse 1" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();
    let url = "/admin/api/content-types/api::article/edit-view";
    let (status, empty) = app.call_as(Method::GET, url, None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(empty["data"].is_null());

    let view = json!({
        "layout": [[{ "name": "title", "size": 8 }, { "name": "author", "size": 4 }], [{ "name": "body", "size": 12 }]],
        "fields": {
            "title": { "label": "Headline", "placeholder": "Say it short" },
            "author": { "mainField": "name", "editable": false }
        }
    });
    let (status, saved) =
        app.call_as(Method::PUT, url, Some(view.clone()), As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (_, read) = app.call_as(Method::GET, url, None, As::Bearer(&admin)).await;
    assert_eq!(read["data"]["fields"]["title"]["label"], "Headline");
    assert_eq!(read["data"]["fields"]["author"]["editable"], false);

    for (bad, why) in [
        (
            json!({ "layout": [[{ "name": "title", "size": 8 }, { "name": "body", "size": 8 }]] }),
            "row too wide",
        ),
        (
            json!({ "layout": [[{ "name": "title", "size": 6 }], [{ "name": "title", "size": 6 }]] }),
            "placed twice",
        ),
        (json!({ "layout": [[{ "name": "nope", "size": 6 }]] }), "unknown field"),
        (json!({ "fields": { "title": { "mainField": "x" } } }), "main field on a scalar"),
        (json!({ "fields": { "author": { "mainField": "missing" } } }), "unknown main field"),
    ] {
        let (status, _) = app.call_as(Method::PUT, url, Some(bad), As::Bearer(&admin)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{why}");
    }
    let (status, _) = app.call_as(Method::DELETE, url, None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, read) = app.call_as(Method::GET, url, None, As::Bearer(&admin)).await;
    assert!(read["data"].is_null());
    app.done().await;
}
