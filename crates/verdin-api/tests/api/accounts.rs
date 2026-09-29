//! Admin accounts: invitations, password resets, the profile, sessions and API token
//! regeneration.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::Schema;

use crate::common::{App, As};

const PASSWORD: &str = "correct horse 1";

async fn register(app: &App) -> String {
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

fn token_in(url: &str) -> String {
    url.split("token=").nth(1).unwrap().to_owned()
}

fn last_email(app: &App) -> verdin_email::Message {
    app.emails.lock().unwrap().last().cloned().expect("an email was sent")
}

async fn login(app: &App, email: &str, password: &str) -> StatusCode {
    let body = json!({ "email": email, "password": password });
    app.call_as(Method::POST, "/admin/api/auth/login", Some(body), As::Anonymous).await.0
}

#[tokio::test]
async fn invitations_and_password_resets() {
    let app = App::new(Schema::default()).await;
    let admin = register(&app).await;
    let (_, roles) = app.call_as(Method::GET, "/admin/api/roles", None, As::Bearer(&admin)).await;
    let editor = roles["data"].as_array().unwrap().iter().find(|r| r["code"] == "editor").unwrap()
        ["id"]
        .clone();

    // Invited without a password: a link, emailed.
    let (status, created) = app
        .call_as(
            Method::POST,
            "/admin/api/users",
            Some(json!({ "email": "Eve@Example.com", "roles": [editor] })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let url = created["meta"]["inviteUrl"].as_str().unwrap().to_owned();
    assert!(url.contains("/admin/auth/accept-invitation?token="), "{url}");
    assert_eq!(created["meta"]["emailed"], true);
    let email = last_email(&app);
    assert_eq!(email.to, "eve@example.com");
    assert!(email.text.contains(&url));
    let token = token_in(&url);

    let (status, who) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/auth/invitation?token={token}"),
            None,
            As::Anonymous,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(who["data"]["email"], "eve@example.com");
    let accept = |token: &str, password: &str| json!({ "token": token, "password": password, "firstname": "Eve" });
    let (status, _) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/accept-invitation",
            Some(accept(&token, "short")),
            As::Anonymous,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "password rules apply");
    let (status, session) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/accept-invitation",
            Some(accept(&token, PASSWORD)),
            As::Anonymous,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert_eq!(session["data"]["user"]["firstname"], "Eve");
    assert!(session["data"]["accessToken"].is_string());
    let (status, _) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/accept-invitation",
            Some(accept(&token, PASSWORD)),
            As::Anonymous,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "links work once");
    assert_eq!(login(&app, "eve@example.com", PASSWORD).await, StatusCode::OK);

    // Forgot password: the same answer for unknown emails; one email per account at a time.
    let sent = app.emails.lock().unwrap().len();
    for email in ["nobody@example.com", "eve@example.com", "eve@example.com"] {
        let (status, _) = app
            .call_as(
                Method::POST,
                "/admin/api/auth/forgot-password",
                Some(json!({ "email": email })),
                As::Anonymous,
            )
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    assert_eq!(app.emails.lock().unwrap().len(), sent + 1);
    let reset = last_email(&app);
    assert_eq!(reset.to, "eve@example.com");
    let link = reset.text.lines().find(|line| line.contains("token=")).unwrap();
    let token = token_in(link.trim());
    let new_password = "battery staple 2";
    let (status, _) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/reset-password",
            Some(json!({ "token": token, "password": new_password })),
            As::Anonymous,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_ne!(login(&app, "eve@example.com", PASSWORD).await, StatusCode::OK, "the old password");
    assert_eq!(login(&app, "eve@example.com", new_password).await, StatusCode::OK);
    app.done().await;
}

#[tokio::test]
async fn profile_sessions_and_token_regeneration() {
    let app = App::new(Schema::default()).await;
    let admin = register(&app).await;
    let (status, me) =
        app.call_as(Method::GET, "/admin/api/users/me", None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["data"]["email"], "ada@example.com");

    let (status, renamed) = app
        .call_as(
            Method::PUT,
            "/admin/api/users/me",
            Some(json!({ "lastname": "Lovelace" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(renamed["data"]["lastname"], "Lovelace");
    let (status, _) = app
        .call_as(
            Method::PUT,
            "/admin/api/users/me",
            Some(json!({ "password": "battery staple 2", "currentPassword": "wrong" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "the current password is needed");

    // A second device, then signed out from the first one.
    let body = json!({ "email": "ada@example.com", "password": PASSWORD });
    let second =
        app.request(Method::POST, "/admin/api/auth/login", Some(body), As::Anonymous, &[]).await;
    let cookie =
        second.headers["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned();
    let (_, listed) =
        app.call_as(Method::GET, "/admin/api/auth/sessions", None, As::Bearer(&admin)).await;
    let sessions = listed["data"].as_array().unwrap().clone();
    assert_eq!(sessions.len(), 2, "{listed}");
    let listed = app
        .request(
            Method::GET,
            "/admin/api/auth/sessions",
            None,
            As::Bearer(&admin),
            &[("cookie", &cookie)],
        )
        .await;
    let current: Vec<&Value> =
        listed.body["data"].as_array().unwrap().iter().filter(|s| s["current"] == true).collect();
    assert_eq!(current.len(), 1);
    let id = current[0]["id"].as_str().unwrap().to_owned();
    let (status, _) = app
        .call_as(
            Method::DELETE,
            &format!("/admin/api/auth/sessions/{id}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let refreshed = app
        .request(
            Method::POST,
            "/admin/api/auth/refresh",
            None,
            As::Anonymous,
            &[("cookie", &cookie), ("x-verdin-csrf", "1")],
        )
        .await;
    assert_eq!(refreshed.status, StatusCode::UNAUTHORIZED, "{:?}", refreshed.body);

    // API tokens: a new secret, the old one refused.
    let token = json!({ "name": "Build", "kind": "read-only" });
    let (_, created) =
        app.call_as(Method::POST, "/admin/api/api-tokens", Some(token), As::Bearer(&admin)).await;
    let old = created["data"]["accessKey"].as_str().unwrap().to_owned();
    let id = created["data"]["id"].clone();
    let (status, regenerated) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/api-tokens/{id}/regenerate"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{regenerated}");
    let new = regenerated["data"]["accessKey"].as_str().unwrap().to_owned();
    assert_ne!(old, new);
    assert_eq!(
        app.call_as(Method::GET, "/api/_openapi.json", None, As::Bearer(&old)).await.0,
        StatusCode::UNAUTHORIZED
    );
    app.done().await;
}

#[tokio::test]
async fn only_super_admins_manage_super_admins() {
    let app = App::new(Schema::default()).await;
    let admin = register(&app).await;
    let call = |method: Method, uri: String, body: Option<Value>, who: String| {
        let app = &app;
        async move { app.call_as(method, &uri, body, As::Bearer(&who)).await }
    };
    let (_, roles) = call(Method::GET, "/admin/api/roles".into(), None, admin.clone()).await;
    let super_admin = roles["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["code"] == "super-admin")
        .unwrap()["id"]
        .clone();
    let (_, role) = call(
        Method::POST,
        "/admin/api/roles".into(),
        Some(json!({ "code": "people", "name": "People",
                     "permissions": [{ "action": "users.manage" }] })),
        admin.clone(),
    )
    .await;
    let (_, bob) = call(
        Method::POST,
        "/admin/api/users".into(),
        Some(json!({ "email": "bob@example.com", "password": PASSWORD, "roles": [role["data"]["id"]] })),
        admin.clone(),
    )
    .await;
    let bob_id = bob["data"]["id"].as_i64().unwrap();
    let body = json!({ "email": "bob@example.com", "password": PASSWORD });
    let (_, session) =
        app.call_as(Method::POST, "/admin/api/auth/login", Some(body), As::Anonymous).await;
    let bob = session["data"]["accessToken"].as_str().unwrap().to_owned();
    let (_, me) = call(Method::GET, "/admin/api/auth/me".into(), None, admin.clone()).await;
    let ada_id = me["data"]["user"]["id"].as_i64().unwrap();

    // Bob manages users, but not the Super Admin, and cannot make anyone one.
    for (method, uri, body) in [
        (Method::POST, format!("/admin/api/users/{ada_id}/invite"), None),
        (
            Method::PUT,
            format!("/admin/api/users/{ada_id}"),
            Some(json!({ "password": "taken over 1" })),
        ),
        (Method::DELETE, format!("/admin/api/users/{ada_id}"), None),
        (Method::DELETE, format!("/admin/api/users/{ada_id}/two-factor"), None),
        (
            Method::PUT,
            format!("/admin/api/users/{bob_id}"),
            Some(json!({ "roles": [super_admin] })),
        ),
        (
            Method::POST,
            "/admin/api/users".into(),
            Some(
                json!({ "email": "mal@example.com", "password": PASSWORD, "roles": [super_admin] }),
            ),
        ),
    ] {
        let (status, body) = call(method.clone(), uri.clone(), body, bob.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}: {body}");
    }
    assert_eq!(login(&app, "ada@example.com", PASSWORD).await, StatusCode::OK);

    // Accounts in use are not invited again (they reset their password instead).
    let (status, _) =
        call(Method::POST, format!("/admin/api/users/{bob_id}/invite"), None, admin.clone()).await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Admins who never signed in are.
    let (_, carl) = call(
        Method::POST,
        "/admin/api/users".into(),
        Some(json!({ "email": "carl@example.com", "roles": [role["data"]["id"]] })),
        bob.clone(),
    )
    .await;
    let carl_id = carl["data"]["id"].as_i64().unwrap();
    let (status, _) =
        call(Method::POST, format!("/admin/api/users/{carl_id}/invite"), None, bob.clone()).await;
    assert_eq!(status, StatusCode::OK);
    app.done().await;
}
