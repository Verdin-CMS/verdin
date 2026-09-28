//! AI actions against an OpenAI-compatible server.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::{Method, StatusCode};
use axum::routing::post;
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::{App, As, Part};

/// Answers like a model would, by the task in the system prompt.
async fn model() -> (String, Arc<Mutex<Vec<Value>>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen: Arc<Mutex<Vec<Value>>> = Arc::default();
    let calls = seen.clone();
    let app = Router::new().route(
        "/v1/chat/completions",
        post(move |axum::Json(request): axum::Json<Value>| {
            let calls = calls.clone();
            async move {
                calls.lock().unwrap().push(request.clone());
                let system = request["messages"][0]["content"].as_str().unwrap_or_default().to_owned();
                let answer = if system.contains("translate") {
                    let input: Value = serde_json::from_str(
                        request["messages"][1]["content"][0]["text"].as_str().unwrap(),
                    )
                    .unwrap();
                    let mut out = serde_json::Map::new();
                    for (key, value) in input.as_object().unwrap() {
                        let value = match value {
                            Value::String(text) => json!(format!("[es] {text}")),
                            other => other.clone(),
                        };
                        out.insert(key.clone(), value);
                    }
                    format!("Here you go:\n```json\n{}\n```", Value::Object(out))
                } else if system.contains("alternative text") {
                    json!({ "alternativeText": "A small gradient", "caption": "Colors" }).to_string()
                } else if system.contains("SEO") {
                    json!({ "metaTitle": "Hello", "metaDescription": "About hello", "keywords": ["a", "b"] }).to_string()
                } else {
                    json!({ "summary": "Short." }).to_string()
                };
                axum::Json(json!({ "choices": [{ "message": { "role": "assistant", "content": answer } }] }))
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, seen)
}

fn png() -> Vec<u8> {
    let image = image::RgbImage::from_fn(8, 8, |x, y| image::Rgb([x as u8 * 30, y as u8 * 30, 90]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    bytes.into_inner()
}

#[tokio::test]
async fn ai_actions() {
    let schema = Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "pluginOptions": { "i18n": { "localized": true } },
                "attributes": { "title": { "type": "string" }, "slug": { "type": "uid" },
                                "body": { "type": "richtext" } } })
        .to_string(),
    )])
    .unwrap();
    let (base, calls) = model().await;
    let app = App::with_ai(schema, &base).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let call = |uri: &'static str, body: Value| {
        let (app, admin) = (&app, admin.clone());
        async move { app.call_as(Method::POST, uri, Some(body), As::Bearer(&admin)).await }
    };
    app.call_as(
        Method::POST,
        "/admin/api/i18n/locales",
        Some(json!({ "code": "es", "name": "Español" })),
        As::Bearer(&admin),
    )
    .await;
    let (_, created) = app
        .post(
            "/api/articles",
            json!({ "title": "Hello", "slug": "hello", "body": "**Bold** text" }),
        )
        .await;
    let id = created["data"]["documentId"].as_str().unwrap().to_owned();

    let (_, status) = app.call_as(Method::GET, "/admin/api/ai", None, As::Bearer(&admin)).await;
    assert_eq!(
        status["data"],
        json!({ "enabled": true, "provider": "openai-compatible", "model": "test-model" })
    );

    let (code, translated) = call(
        "/admin/api/ai/translate",
        json!({ "uid": "api::article", "documentId": id, "from": "en", "to": "es" }),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{translated}");
    assert_eq!(
        translated["data"]["fields"],
        json!({ "title": "[es] Hello", "body": "[es] **Bold** text" }),
        "uids are not translated"
    );
    let request = calls.lock().unwrap().last().cloned().unwrap();
    assert_eq!(request["model"], "test-model");
    assert!(request["messages"][0]["content"].as_str().unwrap().contains("Español (es)"));
    let (code, _) = call(
        "/admin/api/ai/translate",
        json!({ "uid": "api::article", "documentId": id, "from": "en", "to": "xx" }),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST);

    let (_, seo) =
        call("/admin/api/ai/seo", json!({ "uid": "api::article", "documentId": id })).await;
    assert_eq!(seo["data"]["keywords"], json!(["a", "b"]), "{seo}");
    let (_, summary) = call("/admin/api/ai/summarize", json!({ "text": "A long text." })).await;
    assert_eq!(summary["data"]["summary"], "Short.");

    let upload = app
        .multipart(
            Method::POST,
            "/admin/api/upload",
            &[Part::file("files", "a.png", png())],
            As::Bearer(&admin),
        )
        .await;
    let file_id = upload.body["data"][0]["id"].clone();
    let (code, alt) = call("/admin/api/ai/alt-text", json!({ "fileId": file_id })).await;
    assert_eq!(code, StatusCode::OK, "{alt}");
    assert_eq!(alt["data"]["alternativeText"], "A small gradient");
    let request = calls.lock().unwrap().last().cloned().unwrap();
    let image = request["messages"][1]["content"][0]["image_url"]["url"].as_str().unwrap();
    assert!(image.starts_with("data:image/png;base64,"), "the image is sent");
    app.done().await;
}

#[tokio::test]
async fn off_without_configuration() {
    let app = App::new(Schema::default()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let (_, status) = app.call_as(Method::GET, "/admin/api/ai", None, As::Bearer(&admin)).await;
    assert_eq!(status["data"], json!({ "enabled": false }));
    let (code, _) = app
        .call_as(
            Method::POST,
            "/admin/api/ai/summarize",
            Some(json!({ "text": "x" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    app.done().await;
}
