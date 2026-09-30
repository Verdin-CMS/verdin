//! Redirects, menus, forms and the sitemap.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "page",
        json!({ "kind": "collectionType", "singularName": "page", "pluralName": "pages",
                "displayName": "Page", "pluginOptions": { "i18n": { "localized": true } },
                "attributes": { "title": { "type": "string" }, "slug": { "type": "uid", "targetField": "title" } } })
        .to_string(),
    )])
    .unwrap()
}

async fn setup() -> (App, String) {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    (app, admin)
}

#[tokio::test]
async fn redirects_and_menus() {
    let (app, admin) = setup().await;
    let call = |method: Method, uri: String, body: Option<Value>| {
        let (app, admin) = (&app, admin.clone());
        async move { app.call_as(method, &uri, body, As::Bearer(&admin)).await }
    };
    let (code, first) = call(
        Method::POST,
        "/admin/api/site/redirects".into(),
        Some(json!({ "source": "/old", "destination": "/new" })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{first}");
    assert_eq!(first["data"]["status"], 301);
    let (code, _) = call(
        Method::POST,
        "/admin/api/site/redirects".into(),
        Some(json!({ "source": "/new", "destination": "/old" })),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "loops are refused");
    let (code, _) = call(
        Method::POST,
        "/admin/api/site/redirects".into(),
        Some(json!({ "source": "/old", "destination": "/x" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT);
    let (code, _) = call(
        Method::POST,
        "/admin/api/site/redirects".into(),
        Some(json!({ "source": "/a", "destination": "https://b.example", "status": 302 })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED);
    let (_, found) =
        call(Method::GET, "/admin/api/site/redirects?search=B.EXAMPLE".into(), None).await;
    assert_eq!(found["data"].as_array().unwrap().len(), 1, "{found}");
    assert_eq!(found["data"][0]["source"], "/a");
    assert_eq!(found["meta"]["pagination"]["total"], 1);
    let (_, second) =
        call(Method::GET, "/admin/api/site/redirects?page=2&pageSize=1".into(), None).await;
    assert_eq!(second["data"][0]["source"], "/old", "by source");
    assert_eq!(
        second["meta"]["pagination"],
        json!({ "page": 2, "pageSize": 1, "total": 2, "pageCount": 2 })
    );
    let (code, public) = app.call_as(Method::GET, "/api/_redirects", None, As::Anonymous).await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(
        public["data"],
        json!([
            { "source": "/a", "destination": "https://b.example", "status": 302 },
            { "source": "/old", "destination": "/new", "status": 301 }
        ])
    );

    let (_, home) = app.post("/api/pages", json!({ "title": "Home", "slug": "home" })).await;
    let home = home["data"]["documentId"].as_str().unwrap().to_owned();
    let items = json!([
        { "label": "Home", "entry": { "uid": "api::page", "documentId": home } },
        { "label": "Gone", "entry": { "uid": "api::page", "documentId": "missing" } },
        { "label": "Docs", "url": "https://docs.example", "target": "_blank",
          "children": [{ "label": "Guide", "url": "/guide" }] }
    ]);
    let (code, menu) = call(
        Method::POST,
        "/admin/api/site/menus".into(),
        Some(json!({ "slug": "main", "name": "Main", "items": items })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{menu}");
    let (code, _) = call(Method::POST, "/admin/api/site/menus".into(), Some(json!({ "slug": "bad", "name": "Bad", "items": [{ "label": "x", "url": "javascript:alert(1)" }] }))).await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "only real links");
    let (_, menus) = call(Method::GET, "/admin/api/site/menus".into(), None).await;
    assert_eq!(menus["data"][0]["slug"], "main");
    assert_eq!(
        menus["meta"]["pagination"],
        json!({ "page": 1, "pageSize": 25, "total": 1, "pageCount": 1 })
    );
    let (code, public) = app.call_as(Method::GET, "/api/_menus/main", None, As::Anonymous).await;
    assert_eq!(code, StatusCode::OK, "{public}");
    let items = public["data"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "links to missing entries are left out: {public}");
    assert_eq!(items[0]["url"], "/en/home", "the sitemap pattern gives the path");
    assert_eq!(items[1]["children"][0]["label"], "Guide");
    let (code, _) = app.call_as(Method::GET, "/api/_menus/nope", None, As::Anonymous).await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    app.done().await;
}

#[tokio::test]
async fn forms_and_submissions() {
    let (app, admin) = setup().await;
    let form = json!({
        "slug": "contact", "name": "Contact",
        "fields": [
            { "name": "email", "label": "Email", "type": "email", "required": true },
            { "name": "message", "label": "Message", "type": "textarea", "required": true, "maxLength": 500 },
            { "name": "topic", "label": "Topic", "type": "select", "options": ["sales", "help"] }
        ],
        "settings": { "notifyEmails": ["team@example.com"], "successMessage": "Thanks!" }
    });
    let (code, created) =
        app.call_as(Method::POST, "/admin/api/site/forms", Some(form), As::Bearer(&admin)).await;
    assert_eq!(code, StatusCode::CREATED, "{created}");
    let id = created["data"]["id"].as_i64().unwrap();
    let (_, forms) =
        app.call_as(Method::GET, "/admin/api/site/forms?page=2", None, As::Bearer(&admin)).await;
    assert_eq!(forms["data"], json!([]));
    assert_eq!(forms["meta"]["pagination"]["total"], 1);
    let (_, definition) =
        app.call_as(Method::GET, "/api/_forms/contact", None, As::Anonymous).await;
    assert_eq!(definition["data"]["fields"][2]["options"], json!(["sales", "help"]));
    assert_eq!(definition["data"]["honeypot"], "_gotcha");

    let sent = app.emails.lock().unwrap().len();
    let (code, ok) = app
        .call_as(
            Method::POST,
            "/api/_forms/contact",
            Some(json!({ "email": "a@b.co", "message": "Hi", "topic": "help" })),
            As::Anonymous,
        )
        .await;
    assert_eq!(code, StatusCode::CREATED, "{ok}");
    assert_eq!(ok["data"]["message"], "Thanks!");
    let emails = app.emails.lock().unwrap().clone();
    assert_eq!(emails.len(), sent + 1);
    assert_eq!(emails.last().unwrap().to, "team@example.com");
    assert!(emails.last().unwrap().text.contains("message: Hi"));

    let (code, invalid) = app
        .call_as(
            Method::POST,
            "/api/_forms/contact",
            Some(json!({ "email": "nope", "topic": "other" })),
            As::Anonymous,
        )
        .await;
    assert_eq!(code, StatusCode::BAD_REQUEST);
    assert_eq!(invalid["error"]["details"]["errors"].as_array().unwrap().len(), 3, "{invalid}");
    let (code, _) = app
        .call_as(
            Method::POST,
            "/api/_forms/contact",
            Some(json!({ "email": "bot@b.co", "message": "spam", "_gotcha": "x" })),
            As::Anonymous,
        )
        .await;
    assert_eq!(code, StatusCode::CREATED, "bots are told it worked");
    let posted = app
        .request(
            Method::POST,
            "/api/_forms/contact",
            None,
            As::Anonymous,
            &[("content-type", "application/x-www-form-urlencoded")],
        )
        .await;
    assert_eq!(posted.status, StatusCode::BAD_REQUEST, "an empty form post is not valid");

    let (_, list) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/site/forms/{id}/submissions"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(list["meta"]["pagination"]["total"], 1, "only the valid one is stored: {list}");
    assert_eq!(list["data"][0]["data"]["topic"], "help");
    let (_, csv) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/site/forms/{id}/submissions/export"),
            None,
            As::Bearer(&admin),
        )
        .await;
    let csv = csv.as_str().unwrap();
    assert!(csv.starts_with("id,createdAt,email,message,topic\r\n"), "{csv}");
    assert!(csv.contains(",a@b.co,Hi,help"));

    for _ in 0..10 {
        app.call_as(Method::POST, "/api/_forms/contact", Some(json!({})), As::Anonymous).await;
    }
    let (code, _) =
        app.call_as(Method::POST, "/api/_forms/contact", Some(json!({})), As::Anonymous).await;
    assert_eq!(code, StatusCode::TOO_MANY_REQUESTS);
    app.done().await;
}

#[tokio::test]
async fn sitemap() {
    let (app, admin) = setup().await;
    app.call_as(
        Method::POST,
        "/admin/api/i18n/locales",
        Some(json!({ "code": "es", "name": "Español" })),
        As::Bearer(&admin),
    )
    .await;
    let (_, about) = app.post("/api/pages", json!({ "title": "About", "slug": "about" })).await;
    let id = about["data"]["documentId"].as_str().unwrap().to_owned();
    app.put(&format!("/api/pages/{id}?locale=es"), json!({ "title": "Acerca", "slug": "acerca" }))
        .await;
    app.post("/api/pages", json!({ "title": "Solo" })).await;

    let locales = verdin_content::locales::Locales::new(
        verdin_api::i18n::load_locales(&app.test.db).await.unwrap(),
    );
    let service = verdin_content::DocumentService::new(
        app.test.db.clone(),
        verdin_content::Registry::new(schema()),
        Default::default(),
    )
    .with_locales(locales);
    let seo = verdin_api::site::SeoSettings {
        base_url: "https://www.example.com/".into(),
        types: serde_json::from_value(json!({ "api::page": { "pattern": "/{locale}/{slug}", "changefreq": "weekly", "priority": 0.8 } })).unwrap(),
    };
    let response = verdin_api::sitemap_router(service, seo)
        .oneshot(axum::http::Request::get("/sitemap.xml").body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let xml = String::from_utf8(
        axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap().to_vec(),
    )
    .unwrap();
    assert!(xml.contains("<loc>https://www.example.com/en/about</loc>"), "{xml}");
    assert!(xml.contains("<loc>https://www.example.com/es/acerca</loc>"));
    assert!(xml.contains("hreflang=\"es\" href=\"https://www.example.com/es/acerca\""));
    assert!(xml.contains("<changefreq>weekly</changefreq>"));
    assert!(xml.contains("<priority>0.8</priority>"));
    assert_eq!(xml.matches("<url>").count(), 2, "entries without a slug are left out");
    app.done().await;
}
