//! Preview: the admin builds a link to the site with a token that reads one draft.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As};
use serde_json::json;
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "options": { "draftAndPublish": true },
                "attributes": { "title": { "type": "string" }, "slug": { "type": "string" } } })
        .to_string(),
    )])
    .unwrap()
}

#[tokio::test]
async fn preview_links_read_one_draft() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();
    let mut ids = Vec::new();
    for (title, slug) in [("Hello", "hello world"), ("Other", "other")] {
        let (_, created) = app
            .call_as(
                Method::POST,
                "/admin/api/content/api::article",
                Some(json!({ "data": { "title": title, "slug": slug } })),
                As::Bearer(&admin),
            )
            .await;
        ids.push(created["data"]["documentId"].as_str().unwrap().to_owned());
    }
    let link = format!("/admin/api/content/api::article/{}/preview", ids[0]);

    // Off by default.
    assert_eq!(
        app.call_as(Method::GET, &link, None, As::Bearer(&admin)).await.0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = app
        .call_as(
            Method::PUT,
            "/admin/api/features/preview",
            Some(json!({ "enabled": true, "settings": { "urls": { "api::article": "ftp://site" } } })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let settings =
        json!({ "urls": { "api::article": "https://site.test/blog/{slug}" }, "ttlMinutes": 5 });
    let (status, body) = app
        .call_as(
            Method::PUT,
            "/admin/api/features/preview",
            Some(json!({ "enabled": true, "settings": settings })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, preview) = app.call_as(Method::GET, &link, None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let url = preview["data"]["url"].as_str().unwrap();
    let token = preview["data"]["token"].as_str().unwrap();
    assert_eq!(url, format!("https://site.test/blog/hello+world?preview={token}"));

    // The site reads the draft with the token, and nothing else.
    let draft = format!("/api/articles/{}?status=draft", ids[0]);
    let read = |uri: String, token: String| {
        let app = &app;
        async move {
            let headers = [("x-verdin-preview", token.as_str())];
            app.request(Method::GET, &uri, None, As::Anonymous, &headers).await
        }
    };
    let response = read(draft.clone(), token.to_owned()).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    assert_eq!(response.body["data"]["title"], "Hello");
    let other = read(format!("/api/articles/{}?status=draft", ids[1]), token.to_owned()).await;
    assert_eq!(other.status, StatusCode::FORBIDDEN);
    assert_eq!(read(draft.clone(), format!("{token}x")).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        read("/api/articles?status=draft".into(), token.to_owned()).await.status,
        StatusCode::FORBIDDEN
    );
    let anonymous = app.request(Method::GET, &draft, None, As::Anonymous, &[]).await;
    assert_eq!(anonymous.status, StatusCode::FORBIDDEN);

    // Types without a template have no preview.
    let (status, _) = app
        .call_as(
            Method::GET,
            "/admin/api/content/api::article/missing/preview",
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.done().await;
}
