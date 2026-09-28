//! Polymorphic relations: `morphToOne` / `morphToMany` owners and their inverse sides.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, attributes: Value| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural,
                    "displayName": name, "options": { "draftAndPublish": true }, "attributes": attributes })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct("note", "notes", json!({
            "text": { "type": "string" },
            "about": { "type": "relation", "relation": "morphToOne" },
            "refs": { "type": "relation", "relation": "morphToMany" }
        })),
        ct("article", "articles", json!({
            "title": { "type": "string" },
            "notes": { "type": "relation", "relation": "morphMany", "target": "api::note.note", "morphBy": "refs" }
        })),
        ct("page", "pages", json!({
            "title": { "type": "string" },
            "note": { "type": "relation", "relation": "morphOne", "target": "api::note.note", "morphBy": "about" }
        })),
    ])
    .unwrap()
}

fn item(uid: &str, id: &str) -> Value {
    json!({ "__type": uid, "documentId": id })
}

#[tokio::test]
async fn owners_and_inverse_sides() {
    let app = App::new(schema()).await;
    let id = |body: &Value| body["data"]["documentId"].as_str().unwrap().to_owned();
    let (status, article) = app.post("/api/articles", json!({ "title": "Rust" })).await;
    assert_eq!(status, StatusCode::CREATED, "{article}");
    let (_, page) = app.post("/api/pages", json!({ "title": "Home" })).await;
    let (article, page) = (id(&article), id(&page));

    let (status, note) = app
        .post(
            "/api/notes",
            json!({ "text": "hi", "about": item("api::page.page", &page),
                    "refs": [item("api::article", &article), item("api::page", &page)] }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    let note = id(&note);

    let (status, read) =
        app.get(&format!("/api/notes/{note}?populate[0]=about&populate[1]=refs")).await;
    assert_eq!(status, StatusCode::OK, "{read}");
    assert_eq!(read["data"]["about"]["__type"], "api::page");
    assert_eq!(read["data"]["about"]["title"], "Home");
    let refs: Vec<(&str, &str)> = read["data"]["refs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| (item["__type"].as_str().unwrap(), item["title"].as_str().unwrap()))
        .collect();
    assert_eq!(refs, [("api::article", "Rust"), ("api::page", "Home")], "in order");
    let (_, plain) = app.get(&format!("/api/notes/{note}")).await;
    assert!(plain["data"].get("refs").is_none(), "populated only on request");

    // Inverse sides.
    let (_, article_read) = app.get(&format!("/api/articles/{article}?populate=notes")).await;
    assert_eq!(article_read["data"]["notes"][0]["text"], "hi", "{article_read}");
    let (_, page_read) = app.get(&format!("/api/pages/{page}?populate=*")).await;
    assert_eq!(page_read["data"]["note"]["documentId"], note.as_str());
    let (_, counted) = app.get(&format!("/api/notes/{note}?populate[refs][count]=true")).await;
    assert_eq!(counted["data"]["refs"], json!({ "count": 2 }));

    // Validation.
    for (data, why) in [
        (json!({ "about": item("api::article", "missing") }), "unknown document"),
        (json!({ "about": item("api::nope", &article) }), "unknown type"),
        (json!({ "about": [item("api::article", &article), item("api::page", &page)] }), "to-one"),
        (json!({ "refs": [{ "documentId": article }] }), "no __type"),
    ] {
        let (status, _) = app.put(&format!("/api/notes/{note}"), data).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{why}");
    }
    let (status, _) = app.put(&format!("/api/articles/{article}"), json!({ "notes": [] })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "inverse sides are read-only");
    let (status, _) = app.get("/api/notes?filters[refs][title][$eq]=x").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "no filters on morph relations");

    // Drafts keep their own links; publishing copies them.
    let (status, _) = app
        .call(
            Method::PUT,
            &format!("/api/notes/{note}?status=draft"),
            Some(json!({ "data": { "refs": { "set": [item("api::page", &page)] } } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, published) = app.get(&format!("/api/notes/{note}?populate=refs")).await;
    assert_eq!(
        published["data"]["refs"].as_array().unwrap().len(),
        2,
        "published version unchanged"
    );
    app.call(Method::POST, &format!("/api/notes/{note}/actions/publish"), None).await;
    let (_, published) = app.get(&format!("/api/notes/{note}?populate=refs")).await;
    assert_eq!(published["data"]["refs"].as_array().unwrap().len(), 1);

    // Deleting a target removes the links to it.
    let (_, other) = app.post("/api/articles", json!({ "title": "Gone soon" })).await;
    let other = id(&other);
    app.put(
        &format!("/api/notes/{note}"),
        json!({ "refs": [item("api::article", &other), item("api::page", &page)] }),
    )
    .await;
    app.call(Method::DELETE, &format!("/api/articles/{other}"), None).await;
    let (_, after) = app.get(&format!("/api/notes/{note}?populate=refs")).await;
    let left: Vec<&str> = after["data"]["refs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["__type"].as_str().unwrap())
        .collect();
    assert_eq!(left, ["api::page"], "{after}");

    // Duplicating keeps the links.
    let body = json!({ "email": "ada@example.com", "password": "correct horse 1" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();
    let (status, copy) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/content/api::note/{note}/clone"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{copy}");
    let copy = copy["data"]["documentId"].as_str().unwrap().to_owned();
    let (_, copied) = app.get(&format!("/api/notes/{copy}?status=draft&populate=about")).await;
    assert_eq!(copied["data"]["about"]["documentId"], page.as_str());
    app.done().await;
}

#[test]
fn inverse_sides_need_a_morph_owner() {
    let errors = Schema::parse(&[
        Source::content_type(
            "note",
            json!({ "kind": "collectionType", "singularName": "note", "pluralName": "notes", "displayName": "Note",
                    "attributes": { "text": { "type": "string" } } })
            .to_string(),
        ),
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles", "displayName": "Article",
                    "attributes": { "notes": { "type": "relation", "relation": "morphMany", "target": "note", "morphBy": "text" } } })
            .to_string(),
        ),
    ])
    .unwrap_err();
    assert!(
        errors.to_string().contains("must be a morphToOne or morphToMany attribute"),
        "{errors}"
    );
}
