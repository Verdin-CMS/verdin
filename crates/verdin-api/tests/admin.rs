//! Admin API over HTTP: sessions, RBAC on content, users, roles, tokens, public grants.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, attributes: Value| {
        Source::content_type(
            name,
            json!({
                "kind": "collectionType", "singularName": name, "pluralName": plural, "displayName": name,
                "options": { "draftAndPublish": true }, "attributes": attributes
            })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct("article", "articles", json!({ "title": { "type": "string", "required": true }, "slug": { "type": "uid", "targetField": "title" }, "secret": { "type": "string", "private": true } })),
        ct("page", "pages", json!({ "title": { "type": "string" } })),
    ])
    .unwrap()
}

const PASSWORD: &str = "correct horse 1";

async fn register(app: &App) -> String {
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let response = app
        .request(
            Method::POST,
            "/admin/api/auth/register-first-admin",
            Some(body),
            As::Anonymous,
            &[],
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body["data"]["accessToken"].as_str().unwrap().to_owned()
}

async fn login(app: &App, email: &str) -> String {
    let body = json!({ "email": email, "password": PASSWORD });
    let (status, body) =
        app.call_as(Method::POST, "/admin/api/auth/login", Some(body), As::Anonymous).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

fn refresh_cookie(response: &common::Response) -> String {
    let cookie = response.headers["set-cookie"].to_str().unwrap().to_owned();
    cookie.split(';').next().unwrap().to_owned()
}

#[tokio::test]
async fn session_lifecycle() {
    let app = App::new(schema()).await;
    let (_, body) = app.call_as(Method::GET, "/admin/api/auth/status", None, As::Anonymous).await;
    assert_eq!(body["data"]["hasAdmin"], false);

    let body = json!({ "email": "ada@example.com", "password": PASSWORD });
    let first = app
        .request(
            Method::POST,
            "/admin/api/auth/register-first-admin",
            Some(body.clone()),
            As::Anonymous,
            &[],
        )
        .await;
    assert_eq!(first.status, StatusCode::CREATED);
    let set_cookie = first.headers["set-cookie"].to_str().unwrap();
    for part in ["verdin_refresh=", "HttpOnly", "SameSite=Strict", "Path=/admin/api/auth"] {
        assert!(set_cookie.contains(part), "{set_cookie}");
    }
    assert_eq!(first.body["data"]["user"]["roles"][0]["code"], "super-admin");
    assert!(
        first.body["data"].get("refreshToken").is_none(),
        "the refresh token only travels in the cookie"
    );
    let again = app
        .request(
            Method::POST,
            "/admin/api/auth/register-first-admin",
            Some(body),
            As::Anonymous,
            &[],
        )
        .await;
    assert_eq!(again.status, StatusCode::FORBIDDEN);

    let access = first.body["data"]["accessToken"].as_str().unwrap();
    let (status, me) =
        app.call_as(Method::GET, "/admin/api/auth/me", None, As::Bearer(access)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["data"]["permissions"]["superAdmin"], true);
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/auth/me", None, As::Anonymous).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/auth/me", None, As::Bearer(&app.token)).await.0,
        StatusCode::UNAUTHORIZED,
        "API tokens are not admin sessions"
    );

    // Refresh needs the cookie and the CSRF header; the old cookie dies on rotation.
    let cookie = refresh_cookie(&first);
    let no_csrf = app
        .request(
            Method::POST,
            "/admin/api/auth/refresh",
            None,
            As::Anonymous,
            &[("cookie", &cookie)],
        )
        .await;
    assert_eq!(no_csrf.status, StatusCode::FORBIDDEN);
    let csrf = ("x-verdin-csrf", "1");
    let rotated = app
        .request(
            Method::POST,
            "/admin/api/auth/refresh",
            None,
            As::Anonymous,
            &[("cookie", &cookie), csrf],
        )
        .await;
    assert_eq!(rotated.status, StatusCode::OK, "{}", rotated.body);
    let new_cookie = refresh_cookie(&rotated);
    assert_ne!(new_cookie, cookie);
    let reused = app
        .request(
            Method::POST,
            "/admin/api/auth/refresh",
            None,
            As::Anonymous,
            &[("cookie", &cookie), csrf],
        )
        .await;
    assert_eq!(reused.status, StatusCode::UNAUTHORIZED);
    let revoked = app
        .request(
            Method::POST,
            "/admin/api/auth/refresh",
            None,
            As::Anonymous,
            &[("cookie", &new_cookie), csrf],
        )
        .await;
    assert_eq!(revoked.status, StatusCode::UNAUTHORIZED, "reuse revoked the family");

    let (status, body) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/login",
            Some(json!({ "email": "ada@example.com", "password": "nope" })),
            As::Anonymous,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], "Invalid credentials");

    let login = app
        .request(
            Method::POST,
            "/admin/api/auth/login",
            Some(json!({ "email": "ada@example.com", "password": PASSWORD })),
            As::Anonymous,
            &[],
        )
        .await;
    let cookie = refresh_cookie(&login);
    let logout = app
        .request(
            Method::POST,
            "/admin/api/auth/logout",
            None,
            As::Anonymous,
            &[("cookie", &cookie), csrf],
        )
        .await;
    assert_eq!(logout.status, StatusCode::NO_CONTENT);
    assert!(logout.headers["set-cookie"].to_str().unwrap().contains("Max-Age=0"));
    let after = app
        .request(
            Method::POST,
            "/admin/api/auth/refresh",
            None,
            As::Anonymous,
            &[("cookie", &cookie), csrf],
        )
        .await;
    assert_eq!(after.status, StatusCode::UNAUTHORIZED);

    app.done().await;
}

async fn create_user(app: &App, admin: &str, email: &str, role: &str) {
    let (_, roles) = app.call_as(Method::GET, "/admin/api/roles", None, As::Bearer(admin)).await;
    let role_id =
        roles["data"].as_array().unwrap().iter().find(|r| r["code"] == role).unwrap()["id"].clone();
    let body = json!({ "email": email, "password": PASSWORD, "roles": [role_id] });
    let (status, body) =
        app.call_as(Method::POST, "/admin/api/users", Some(body), As::Bearer(admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn content_rbac() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    create_user(&app, &admin, "author@example.com", "author").await;
    create_user(&app, &admin, "editor@example.com", "editor").await;
    let author = login(&app, "author@example.com").await;
    let editor = login(&app, "editor@example.com").await;
    let content = "/admin/api/content/api::article";

    // Admin writes save drafts.
    let (status, body) = app
        .call_as(
            Method::POST,
            content,
            Some(json!({ "data": { "title": "By editor" } })),
            As::Bearer(&editor),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(body["data"]["publishedAt"].is_null());
    let editors = body["data"]["documentId"].as_str().unwrap().to_owned();
    let (_, body) = app
        .call_as(
            Method::POST,
            content,
            Some(json!({ "data": { "title": "By author", "secret": "s" } })),
            As::Bearer(&author),
        )
        .await;
    let authors = body["data"]["documentId"].as_str().unwrap().to_owned();

    // Authors see and edit only their own documents.
    let titles = |body: Value| -> Vec<String> {
        body["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|doc| doc["title"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        titles(app.call_as(Method::GET, content, None, As::Bearer(&author)).await.1),
        ["By author"]
    );
    assert_eq!(
        titles(
            app.call_as(Method::GET, &format!("{content}?sort=title"), None, As::Bearer(&editor))
                .await
                .1
        ),
        ["By author", "By editor"]
    );
    assert_eq!(
        app.call_as(Method::GET, &format!("{content}/{editors}"), None, As::Bearer(&author))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let edit = Some(json!({ "data": { "title": "Changed" } }));
    assert_eq!(
        app.call_as(
            Method::PUT,
            &format!("{content}/{editors}"),
            edit.clone(),
            As::Bearer(&author)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(
            Method::PUT,
            &format!("{content}/{authors}"),
            edit.clone(),
            As::Bearer(&author)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        app.call_as(Method::DELETE, &format!("{content}/{editors}"), None, As::Bearer(&author))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // Authors cannot publish; editors can, and publishing makes it public-API visible.
    let publish = format!("{content}/{authors}/actions/publish");
    assert_eq!(
        app.call_as(Method::POST, &publish, None, As::Bearer(&author)).await.0,
        StatusCode::FORBIDDEN
    );
    let (status, body) = app.call_as(Method::POST, &publish, None, As::Bearer(&editor)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"]["publishedAt"].is_string());
    assert_eq!(titles(app.get("/api/articles").await.1), ["Changed"]);
    assert_eq!(
        app.call_as(Method::PUT, &format!("{content}/{authors}"), edit, As::Bearer(&author))
            .await
            .0,
        StatusCode::OK,
        "still theirs"
    );

    // Settings are super-admin only for these roles.
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/users", None, As::Bearer(&editor)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/api-tokens", None, As::Bearer(&author)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/content/api::nope", None, As::Bearer(&admin)).await.0,
        StatusCode::NOT_FOUND
    );

    // Schema metadata for forms.
    let (_, types) =
        app.call_as(Method::GET, "/admin/api/content-types", None, As::Bearer(&author)).await;
    let article = types["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["uid"] == "api::article")
        .unwrap()
        .clone();
    assert_eq!(article["attributes"]["title"], json!({ "type": "string", "required": true }));
    assert_eq!(article["draftAndPublish"], true);

    app.done().await;
}

#[tokio::test]
async fn tokens_roles_and_public_permissions() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;

    let body = json!({ "name": "frontend", "kind": "custom", "permissions": [{ "subject": "api::page", "action": "find" }] });
    let (status, created) =
        app.call_as(Method::POST, "/admin/api/api-tokens", Some(body), As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let key = created["data"]["accessKey"].as_str().unwrap().to_owned();
    let (_, list) =
        app.call_as(Method::GET, "/admin/api/api-tokens", None, As::Bearer(&admin)).await;
    assert!(
        list["data"].as_array().unwrap().iter().all(|token| token.get("accessKey").is_none()),
        "shown once"
    );
    assert_eq!(
        app.call_as(Method::GET, "/api/pages", None, As::Bearer(&key)).await.0,
        StatusCode::OK
    );
    assert_eq!(
        app.call_as(Method::GET, "/api/articles", None, As::Bearer(&key)).await.0,
        StatusCode::FORBIDDEN
    );

    let bad = json!({ "name": "x", "kind": "custom", "permissions": [{ "subject": "api::nope", "action": "find" }] });
    assert_eq!(
        app.call_as(Method::POST, "/admin/api/api-tokens", Some(bad), As::Bearer(&admin)).await.0,
        StatusCode::BAD_REQUEST
    );
    let bad = json!({ "name": "x", "kind": "custom", "permissions": [{ "subject": "api::page", "action": "fly" }] });
    assert_eq!(
        app.call_as(Method::POST, "/admin/api/api-tokens", Some(bad), As::Bearer(&admin)).await.0,
        StatusCode::BAD_REQUEST
    );

    let id = created["data"]["id"].as_i64().unwrap();
    assert_eq!(
        app.call_as(
            Method::DELETE,
            &format!("/admin/api/api-tokens/{id}"),
            None,
            As::Bearer(&admin)
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call_as(Method::GET, "/api/pages", None, As::Bearer(&key)).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Public permissions.
    let grants = json!({ "permissions": [{ "subject": "api::page", "action": "find" }] });
    let (status, body) = app
        .call_as(Method::PUT, "/admin/api/public-permissions", Some(grants), As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"], json!([{ "subject": "api::page", "action": "find" }]));
    assert_eq!(app.call_as(Method::GET, "/api/pages", None, As::Anonymous).await.0, StatusCode::OK);

    // Custom roles.
    let role = json!({
        "code": "publisher", "name": "Publisher",
        "permissions": [
            { "action": "content.read", "subject": "api::page" },
            { "action": "content.publish", "subject": "api::page" }
        ]
    });
    let (status, body) =
        app.call_as(Method::POST, "/admin/api/roles", Some(role), As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let bad = json!({ "code": "x", "name": "X", "permissions": [{ "action": "content.read", "subject": "api::nope" }] });
    assert_eq!(
        app.call_as(Method::POST, "/admin/api/roles", Some(bad), As::Bearer(&admin)).await.0,
        StatusCode::BAD_REQUEST
    );
    let duplicate = json!({ "code": "publisher", "name": "Again" });
    assert_eq!(
        app.call_as(Method::POST, "/admin/api/roles", Some(duplicate), As::Bearer(&admin)).await.0,
        StatusCode::CONFLICT
    );

    let (status, info) =
        app.call_as(Method::GET, "/admin/api/system/info", None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(info["data"]["database"], app.test.flavor().as_str());

    app.done().await;
}

#[tokio::test]
async fn uid_availability() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let content = "/admin/api/content/api::article";
    let (_, body) = app
        .call_as(
            Method::POST,
            content,
            Some(json!({ "data": { "title": "Hello", "slug": "hello" } })),
            As::Bearer(&admin),
        )
        .await;
    let id = body["data"]["documentId"].as_str().unwrap().to_owned();

    let (status, body) = app
        .call_as(
            Method::GET,
            &format!("{content}/uid-available?field=slug&value=Hello%20World"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"], json!({ "available": true, "suggestion": "hello-world" }));
    let (_, body) = app
        .call_as(
            Method::GET,
            &format!("{content}/uid-available?field=slug&value=hello"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(body["data"], json!({ "available": false, "suggestion": "hello-1" }));
    let (_, body) = app
        .call_as(
            Method::GET,
            &format!("{content}/uid-available?field=slug&value=hello&documentId={id}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(body["data"]["available"], true, "a document does not collide with itself");
    let (status, _) = app
        .call_as(
            Method::GET,
            &format!("{content}/uid-available?field=title&value=x"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "only uid attributes");
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/schema", None, As::Bearer(&admin)).await.0,
        StatusCode::NOT_FOUND,
        "no builder outside dev mode"
    );
    app.done().await;
}
