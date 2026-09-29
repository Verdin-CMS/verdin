//! End users on the content API: accounts, JWTs, roles, confirmation, password reset and
//! OAuth (against a local fake provider).

use crate::common::{App, As};
use axum::Router;
use axum::http::{Method, StatusCode};
use axum::routing::{get, post};
use serde_json::{Value, json};
use verdin_auth::ContentAction;
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "attributes": { "title": { "type": "string" } } })
        .to_string(),
    )])
    .unwrap()
}

async fn post_json(app: &App, uri: &str, body: Value) -> (StatusCode, Value) {
    app.call_as(Method::POST, uri, Some(body), As::Anonymous).await
}

fn last_email(app: &App) -> verdin_email::Message {
    app.emails.lock().unwrap().last().cloned().expect("an email was sent")
}

fn link_param(text: &str, name: &str) -> String {
    let start = text.find(&format!("{name}=")).expect("link in the email") + name.len() + 1;
    text[start..].split(|c: char| c.is_whitespace() || c == '&').next().unwrap().to_owned()
}

#[tokio::test]
async fn register_login_and_role_grants() {
    let app = App::new(schema()).await;
    app.post("/api/articles", json!({ "title": "Members only" })).await;

    let (status, body) = post_json(
        &app,
        "/api/auth/local/register",
        json!({ "username": "ada", "email": "Ada@Example.com", "password": "correct horse 1" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user"]["email"], "ada@example.com");
    assert_eq!(body["user"]["confirmed"], true);
    assert!(body["user"].get("password").is_none() && body["user"].get("passwordHash").is_none());
    let jwt = body["jwt"].as_str().unwrap().to_owned();

    let (status, body) = post_json(
        &app,
        "/api/auth/local/register",
        json!({ "username": "ada", "email": "other@example.com", "password": "correct horse 1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], "Email or Username are already taken");
    let (status, _) = post_json(
        &app,
        "/api/auth/local/register",
        json!({ "username": "bob", "email": "bob@example.com", "password": "short" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Login by email or username.
    for identifier in ["ada@example.com", "ada"] {
        let (status, body) = post_json(
            &app,
            "/api/auth/local",
            json!({ "identifier": identifier, "password": "correct horse 1" }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (status, body) = post_json(
        &app,
        "/api/auth/local",
        json!({ "identifier": "ada", "password": "wrong password" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], "Invalid identifier or password");

    let (status, me) = app.call_as(Method::GET, "/api/users/me", None, As::Bearer(&jwt)).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["username"], "ada");
    assert_eq!(
        app.call_as(Method::GET, "/api/users/me", None, As::Anonymous).await.0,
        StatusCode::UNAUTHORIZED
    );

    // The authenticated role reads what it is granted, and nothing else.
    assert_eq!(
        app.call_as(Method::GET, "/api/articles", None, As::Bearer(&jwt)).await.0,
        StatusCode::FORBIDDEN
    );
    let roles = app.auth.end_user_roles().await.unwrap();
    let (authenticated, _, _) =
        roles.iter().find(|(role, _, _)| role.kind == "authenticated").unwrap();
    app.auth
        .save_end_user_role(
            Some(authenticated.id),
            "Authenticated",
            None,
            &[("api::article".into(), ContentAction::Find)],
        )
        .await
        .unwrap();
    let (status, body) = app.call_as(Method::GET, "/api/articles", None, As::Bearer(&jwt)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"][0]["title"], "Members only");
    assert_eq!(
        app.call_as(Method::GET, "/api/articles", None, As::Anonymous).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(
            Method::POST,
            "/api/articles",
            Some(json!({ "data": { "title": "x" } })),
            As::Bearer(&jwt)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(Method::GET, "/api/articles", None, As::Bearer("not-a-jwt")).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Changing the password revokes earlier tokens.
    let (status, body) = app
        .call_as(
            Method::POST,
            "/api/auth/change-password",
            Some(json!({ "currentPassword": "correct horse 1", "password": "battery staple 2", "passwordConfirmation": "battery staple 2" })),
            As::Bearer(&jwt),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let fresh = body["jwt"].as_str().unwrap().to_owned();
    assert_eq!(
        app.call_as(Method::GET, "/api/users/me", None, As::Bearer(&jwt)).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call_as(Method::GET, "/api/users/me", None, As::Bearer(&fresh)).await.0,
        StatusCode::OK
    );

    // Blocking does too.
    let id = me["id"].as_i64().unwrap();
    app.auth
        .update_end_user(
            id,
            verdin_auth::users::EndUserUpdate { blocked: Some(true), ..Default::default() },
        )
        .await
        .unwrap();
    assert_eq!(
        app.call_as(Method::GET, "/api/users/me", None, As::Bearer(&fresh)).await.0,
        StatusCode::UNAUTHORIZED
    );
    let (status, body) = post_json(
        &app,
        "/api/auth/local",
        json!({ "identifier": "ada", "password": "battery staple 2" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]["message"].as_str().unwrap().contains("blocked"));
    app.done().await;
}

#[tokio::test]
async fn confirmation_and_password_reset() {
    let app = App::with_users(
        schema(),
        json!({ "emailConfirmation": true, "resetPasswordUrl": "https://app.test/reset",
                "emailConfirmationRedirection": "https://app.test/welcome" }),
    )
    .await;
    let (status, body) = post_json(
        &app,
        "/api/auth/local/register",
        json!({ "username": "grace", "email": "grace@example.com", "password": "correct horse 1" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.get("jwt").is_none(), "no session before confirming");
    let email = last_email(&app);
    assert_eq!(email.to, "grace@example.com");
    assert_eq!(email.subject, "Confirm your account");
    assert!(email.text.contains("https://cms.test/api/auth/email-confirmation?confirmation="));

    let (status, body) = post_json(
        &app,
        "/api/auth/local",
        json!({ "identifier": "grace", "password": "correct horse 1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], "Your account email is not confirmed");

    // A new link invalidates the first one.
    post_json(&app, "/api/auth/send-email-confirmation", json!({ "email": "grace@example.com" }))
        .await;
    let first = link_param(&email.text, "confirmation");
    let token = link_param(&last_email(&app).text, "confirmation");
    assert_ne!(first, token);
    let response = app
        .request(
            Method::GET,
            &format!("/api/auth/email-confirmation?confirmation={first}"),
            None,
            As::Anonymous,
            &[],
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    let response = app
        .request(
            Method::GET,
            &format!("/api/auth/email-confirmation?confirmation={token}"),
            None,
            As::Anonymous,
            &[],
        )
        .await;
    assert_eq!(response.status, StatusCode::SEE_OTHER, "{}", response.body);
    assert_eq!(response.headers["location"], "https://app.test/welcome");
    let (status, _) = post_json(
        &app,
        "/api/auth/local",
        json!({ "identifier": "grace", "password": "correct horse 1" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Password reset: same answer for unknown emails, one-time codes.
    let sent = app.emails.lock().unwrap().len();
    let (status, body) =
        post_json(&app, "/api/auth/forgot-password", json!({ "email": "nobody@example.com" }))
            .await;
    assert_eq!((status, body), (StatusCode::OK, json!({ "ok": true })));
    assert_eq!(app.emails.lock().unwrap().len(), sent, "nothing sent");
    post_json(&app, "/api/auth/forgot-password", json!({ "email": "grace@example.com" })).await;
    let reset = last_email(&app);
    assert!(reset.text.contains("https://app.test/reset?code="));
    let code = link_param(&reset.text, "code");
    let (status, _) = post_json(
        &app,
        "/api/auth/reset-password",
        json!({ "code": code, "password": "new password 3", "passwordConfirmation": "different" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, body) = post_json(
        &app,
        "/api/auth/reset-password",
        json!({ "code": code, "password": "new password 3", "passwordConfirmation": "new password 3" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["jwt"].is_string());
    let (status, _) = post_json(
        &app,
        "/api/auth/reset-password",
        json!({ "code": code, "password": "again pass 4", "passwordConfirmation": "again pass 4" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "codes work once");
    let (status, _) = post_json(
        &app,
        "/api/auth/local",
        json!({ "identifier": "grace", "password": "new password 3" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    app.done().await;
}

#[tokio::test]
async fn registration_can_be_closed() {
    let app = App::with_users(schema(), json!({ "allowRegister": false })).await;
    let (status, body) = post_json(
        &app,
        "/api/auth/local/register",
        json!({ "username": "eve", "email": "eve@example.com", "password": "correct horse 1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], "Register action is currently disabled");
    app.done().await;
}

/// A fake OAuth 2 provider: `/token` returns a token, `/user` a profile.
async fn fake_provider() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route(
            "/token",
            post(|body: String| async move {
                assert!(body.contains("code=the-code") && body.contains("client_secret=s3cret"), "{body}");
                axum::Json(json!({ "access_token": "provider-token", "token_type": "bearer" }))
            }),
        )
        .route(
            "/user",
            get(|headers: axum::http::HeaderMap| async move {
                if headers["authorization"] != "Bearer provider-token" {
                    return (StatusCode::UNAUTHORIZED, axum::Json(json!({})));
                }
                (StatusCode::OK, axum::Json(json!({ "email": "linus@example.com", "login": "linus", "email_verified": true })))
            }),
        );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

#[tokio::test]
async fn oauth_sign_in() {
    let base = fake_provider().await;
    let app = App::build(
        schema(),
        json!({ "providers": { "acme": {
            "enabled": true, "clientId": "client-1", "redirectUri": "https://app.test/connect/acme",
            "authorizeUrl": format!("{base}/authorize"), "tokenUrl": format!("{base}/token"),
            "userInfoUrl": format!("{base}/user"), "scope": ["email"] } } }),
        &[("acme", "s3cret")],
    )
    .await;

    let start = app.request(Method::GET, "/api/connect/acme", None, As::Anonymous, &[]).await;
    assert_eq!(start.status, StatusCode::SEE_OTHER);
    let location = start.headers["location"].to_str().unwrap().to_owned();
    assert!(location.starts_with(&format!("{base}/authorize?client_id=client-1")), "{location}");
    assert!(
        location.contains("redirect_uri=https%3A%2F%2Fcms.test%2Fapi%2Fconnect%2Facme%2Fcallback")
    );
    let state = location.split("state=").nth(1).unwrap().to_owned();
    let cookie =
        start.headers["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned();

    // Without the browser's cookie the state is refused (CSRF).
    let forged = app
        .request(
            Method::GET,
            &format!("/api/connect/acme/callback?code=the-code&state={state}"),
            None,
            As::Anonymous,
            &[],
        )
        .await;
    assert_eq!(forged.status, StatusCode::FORBIDDEN);
    let callback = app
        .request(
            Method::GET,
            &format!("/api/connect/acme/callback?code=the-code&state={state}"),
            None,
            As::Anonymous,
            &[("cookie", &cookie)],
        )
        .await;
    assert_eq!(callback.status, StatusCode::SEE_OTHER, "{}", callback.body);
    assert_eq!(
        callback.headers["location"],
        "https://app.test/connect/acme?access_token=provider-token"
    );

    let (status, body) = app
        .call_as(
            Method::GET,
            "/api/auth/acme/callback?access_token=provider-token",
            None,
            As::Anonymous,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user"]["provider"], "acme");
    assert_eq!(body["user"]["username"], "linus");
    assert_eq!(body["user"]["confirmed"], true);
    // The same account on the next sign-in; no password login for it.
    let (_, again) = app
        .call_as(
            Method::GET,
            "/api/auth/acme/callback?access_token=provider-token",
            None,
            As::Anonymous,
        )
        .await;
    assert_eq!(again["user"]["id"], body["user"]["id"]);
    let (status, _) = app
        .call_as(Method::GET, "/api/auth/acme/callback?access_token=stolen", None, As::Anonymous)
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        app.request(Method::GET, "/api/connect/other", None, As::Anonymous, &[]).await.status,
        StatusCode::NOT_FOUND
    );
    app.done().await;
}

#[tokio::test]
async fn admin_manages_end_users_and_roles() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "admin@example.com", "password": "correct horse 1", "firstname": "Ad" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();
    let call = async |method: Method, uri: &str, body: Option<Value>| {
        app.call_as(method, uri, body, As::Bearer(&admin)).await
    };

    let (status, role) = call(
        Method::POST,
        "/admin/api/end-user-roles",
        Some(json!({ "name": "Editors Club", "permissions": [{ "subject": "api::article", "action": "find" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{role}");
    let club = role["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["type"] == "editors-club")
        .unwrap()
        .clone();
    assert_eq!(club["permissions"], json!([{ "subject": "api::article", "action": "find" }]));
    let (status, _) = call(
        Method::POST,
        "/admin/api/end-user-roles",
        Some(
            json!({ "name": "Bad", "permissions": [{ "subject": "api::nope", "action": "find" }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, created) = call(
        Method::POST,
        "/admin/api/end-users",
        Some(json!({ "username": "member", "email": "member@example.com", "password": "correct horse 1", "role": club["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["role"]["type"], "editors-club");
    let (status, list) = call(Method::GET, "/admin/api/end-users", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["meta"]["pagination"]["total"], 1);

    // The member reads articles through the custom role.
    let (_, login) = post_json(
        &app,
        "/api/auth/local",
        json!({ "identifier": "member", "password": "correct horse 1" }),
    )
    .await;
    let jwt = login["jwt"].as_str().unwrap().to_owned();
    assert_eq!(
        app.call_as(Method::GET, "/api/articles", None, As::Bearer(&jwt)).await.0,
        StatusCode::OK
    );

    // Deleting the role moves its users to Authenticated.
    let uri = format!("/admin/api/end-user-roles/{}", club["id"]);
    assert_eq!(call(Method::DELETE, &uri, None).await.0, StatusCode::OK);
    let (_, list) = call(Method::GET, "/admin/api/end-users", None).await;
    assert_eq!(list["data"][0]["role"]["type"], "authenticated");
    assert_eq!(
        app.call_as(Method::GET, "/api/articles", None, As::Bearer(&jwt)).await.0,
        StatusCode::FORBIDDEN
    );

    let (status, sent) =
        call(Method::POST, "/admin/api/email/test", Some(json!({ "to": "ops@example.com" }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(sent["data"]["sent"], true);
    assert_eq!(last_email(&app).to, "ops@example.com");
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/end-users", None, As::Anonymous).await.0,
        StatusCode::UNAUTHORIZED
    );
    app.done().await;
}

#[tokio::test]
async fn users_crud_over_the_content_api() {
    let app = App::with_users(schema(), json!({})).await;
    let (_, body) = post_json(
        &app,
        "/api/auth/local/register",
        json!({ "username": "ada", "email": "ada@example.com", "password": "correct horse 1" }),
    )
    .await;
    let jwt = body["jwt"].as_str().unwrap().to_owned();
    assert_eq!(
        app.call_as(Method::GET, "/api/users", None, As::Bearer(&jwt)).await.0,
        StatusCode::FORBIDDEN
    );

    let roles = app.auth.end_user_roles().await.unwrap();
    let (authenticated, _, _) =
        roles.iter().find(|(role, _, _)| role.kind == "authenticated").unwrap();
    let grants: Vec<(String, ContentAction)> = [ContentAction::Find, ContentAction::FindOne]
        .into_iter()
        .map(|action| (verdin_auth::USERS_SUBJECT.to_owned(), action))
        .collect();
    app.auth
        .save_end_user_role(Some(authenticated.id), "Authenticated", None, &grants)
        .await
        .unwrap();
    let (status, listed) =
        app.call_as(Method::GET, "/api/users?populate=role", None, As::Bearer(&jwt)).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    assert_eq!(listed[0]["username"], "ada", "a plain array, as in Strapi");
    assert_eq!(listed[0]["role"]["type"], "authenticated");
    assert!(listed[0].get("passwordHash").is_none());
    let id = listed[0]["id"].as_i64().unwrap();
    let (_, one) =
        app.call_as(Method::GET, &format!("/api/users/{id}"), None, As::Bearer(&jwt)).await;
    assert_eq!(one["email"], "ada@example.com");
    assert!(one.get("role").is_none(), "not populated");
    assert_eq!(
        app.call_as(Method::DELETE, &format!("/api/users/{id}"), None, As::Bearer(&jwt)).await.0,
        StatusCode::FORBIDDEN
    );

    // The full-access API token of the harness manages them.
    let (status, created) =
        app.call(Method::POST, "/api/users", Some(json!({ "username": "bob", "email": "bob@example.com", "password": "correct horse 2" }))).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["confirmed"], true);
    let bob = created["id"].as_i64().unwrap();
    let (_, count) = app.get("/api/users/count").await;
    assert_eq!(count, 2);
    let (status, updated) =
        app.call(Method::PUT, &format!("/api/users/{bob}"), Some(json!({ "blocked": true }))).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["blocked"], true);
    let (status, _) = app.call(Method::DELETE, &format!("/api/users/{bob}"), None).await;
    assert_eq!(status, StatusCode::OK);
    let (_, count) = app.get("/api/users/count").await;
    assert_eq!(count, 1);
    app.done().await;
}

#[tokio::test]
async fn refresh_tokens_rotate() {
    let app =
        App::with_users(schema(), json!({ "jwtManagement": "refresh", "accessTokenMinutes": 5 }))
            .await;
    let (status, body) = post_json(
        &app,
        "/api/auth/local/register",
        json!({ "username": "ada", "email": "ada@example.com", "password": "correct horse 1" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let first = body["refreshToken"].as_str().unwrap().to_owned();

    let (status, rotated) =
        post_json(&app, "/api/auth/refresh", json!({ "refreshToken": first })).await;
    assert_eq!(status, StatusCode::OK, "{rotated}");
    let second = rotated["refreshToken"].as_str().unwrap().to_owned();
    let jwt = rotated["jwt"].as_str().unwrap().to_owned();
    assert_eq!(
        app.call_as(Method::GET, "/api/users/me", None, As::Bearer(&jwt)).await.0,
        StatusCode::OK
    );

    // Replaying the first token ends the whole session.
    let (status, _) = post_json(&app, "/api/auth/refresh", json!({ "refreshToken": first })).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = post_json(&app, "/api/auth/refresh", json!({ "refreshToken": second })).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "the family is revoked");

    // Logout ends a session.
    let (_, login) = post_json(
        &app,
        "/api/auth/local",
        json!({ "identifier": "ada", "password": "correct horse 1" }),
    )
    .await;
    let token = login["refreshToken"].as_str().unwrap().to_owned();
    let (status, _) = post_json(&app, "/api/auth/logout", json!({ "refreshToken": token })).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = post_json(&app, "/api/auth/refresh", json!({ "refreshToken": token })).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.done().await;
}

#[tokio::test]
async fn wrong_passwords_lock_the_account() {
    let app = App::new(schema()).await;
    let account =
        json!({ "username": "eve", "email": "eve@example.com", "password": "correct horse 1" });
    assert_eq!(post_json(&app, "/api/auth/local/register", account).await.0, StatusCode::OK);
    let login = |password: &str| json!({ "identifier": "eve", "password": password });
    for _ in 0..5 {
        let (status, _) = post_json(&app, "/api/auth/local", login("wrong password")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, body) = post_json(&app, "/api/auth/local", login("correct horse 1")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "locked: {body}");
    assert_eq!(body["error"]["message"], "Invalid identifier or password");
}
