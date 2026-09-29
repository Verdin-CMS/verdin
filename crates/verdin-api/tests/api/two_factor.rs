//! Two-factor authentication for admins: TOTP, recovery codes, roles that require it.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::Schema;

use crate::common::{App, As};

const PASSWORD: &str = "correct horse 1";

async fn call(
    app: &App,
    method: Method,
    uri: &str,
    body: Option<Value>,
    who: Option<&str>,
) -> (StatusCode, Value) {
    let who = who.map_or(As::Anonymous, As::Bearer);
    app.call_as(method, uri, body, who).await
}

async fn login(app: &App, email: &str) -> Value {
    let (status, body) = call(
        app,
        Method::POST,
        "/admin/api/auth/login",
        Some(json!({ "email": email, "password": PASSWORD })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"].clone()
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
}

/// Sets up TOTP for the admin behind `token`; returns the secret, recovery codes and the
/// time of the enabling code.
async fn enable_totp(app: &App, token: &str) -> (String, Vec<String>, i64) {
    let (status, setup) = call(
        app,
        Method::POST,
        "/admin/api/auth/two-factor/totp/setup",
        Some(json!({ "password": PASSWORD })),
        Some(token),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{setup}");
    let secret = setup["data"]["secret"].as_str().unwrap().to_owned();
    assert!(setup["data"]["otpauthUrl"].as_str().unwrap().starts_with("otpauth://totp/Verdin:"));
    let at = now();
    let code = verdin_auth::totp_code(&secret, at).unwrap();
    let (status, enabled) = call(
        app,
        Method::POST,
        "/admin/api/auth/two-factor/totp/enable",
        Some(json!({ "code": code })),
        Some(token),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{enabled}");
    let codes: Vec<String> =
        serde_json::from_value(enabled["data"]["recoveryCodes"].clone()).unwrap();
    (secret, codes, at)
}

#[tokio::test]
async fn totp_and_recovery_codes() {
    let app = App::new(Schema::default()).await;
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, body) =
        call(&app, Method::POST, "/admin/api/auth/register-first-admin", Some(body), None).await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();

    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/auth/two-factor/totp/setup",
        Some(json!({ "password": "wrong" })),
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "the password is confirmed");
    let (_, pending) = call(
        &app,
        Method::POST,
        "/admin/api/auth/two-factor/totp/setup",
        Some(json!({ "password": PASSWORD })),
        Some(&admin),
    )
    .await;
    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/auth/two-factor/totp/enable",
        Some(json!({ "code": "000000" })),
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{pending}");
    let (secret, codes, at) = enable_totp(&app, &admin).await;
    assert_eq!(codes.len(), 10);
    let (_, status) =
        call(&app, Method::GET, "/admin/api/auth/two-factor", None, Some(&admin)).await;
    assert_eq!(status["data"]["totp"], true);
    assert_eq!(status["data"]["recoveryCodesLeft"], 10);

    // Signing in now takes two steps.
    let first = login(&app, "ada@example.com").await;
    assert_eq!(first["twoFactorRequired"], true, "{first}");
    assert!(first.get("accessToken").is_none());
    let token = first["twoFactorToken"].as_str().unwrap().to_owned();
    let second = |code: String| {
        let token = token.clone();
        let app = &app;
        async move {
            call(
                app,
                Method::POST,
                "/admin/api/auth/login/two-factor",
                Some(json!({ "twoFactorToken": token, "code": code })),
                None,
            )
            .await
        }
    };
    let (status, _) = second(verdin_auth::totp_code(&secret, at).unwrap()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "the enabling code cannot be replayed");
    let (status, session) = second(verdin_auth::totp_code(&secret, at + 30).unwrap()).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert!(session["data"]["accessToken"].is_string());
    assert_eq!(session["data"]["user"]["twoFactor"], true);
    let (status, session) = second(codes[0].to_uppercase()).await;
    assert_eq!(status, StatusCode::OK, "recovery codes work once, in any case: {session}");
    let (status, _) = second(codes[0].clone()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/auth/login/two-factor",
        Some(json!({ "twoFactorToken": "forged", "code": codes[1] })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (_, regenerated) = call(
        &app,
        Method::POST,
        "/admin/api/auth/two-factor/recovery-codes",
        Some(json!({ "password": PASSWORD })),
        Some(&admin),
    )
    .await;
    assert_eq!(regenerated["data"]["recoveryCodes"].as_array().unwrap().len(), 10);
    let (status, _) = second(codes[1].clone()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "old codes are gone");

    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/auth/two-factor/totp/disable",
        Some(json!({ "password": PASSWORD })),
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(login(&app, "ada@example.com").await["accessToken"].is_string());
    app.done().await;
}

#[tokio::test]
async fn roles_can_require_it() {
    let app = App::new(Schema::default()).await;
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, body) =
        call(&app, Method::POST, "/admin/api/auth/register-first-admin", Some(body), None).await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let (status, role) = call(
        &app,
        Method::POST,
        "/admin/api/roles",
        Some(json!({ "code": "secure", "name": "Secure", "requireTwoFactor": true })),
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{role}");
    assert_eq!(role["data"]["requireTwoFactor"], true);
    let (status, user) = call(
        &app,
        Method::POST,
        "/admin/api/users",
        Some(json!({ "email": "bob@example.com", "password": PASSWORD, "roles": [role["data"]["id"]] })),
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{user}");
    let bob_id = user["data"]["id"].clone();

    let session = login(&app, "bob@example.com").await;
    let bob = session["accessToken"].as_str().unwrap().to_owned();
    assert_eq!(session["user"]["twoFactorRequired"], true);
    let (status, refused) =
        call(&app, Method::GET, "/admin/api/content-types", None, Some(&bob)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(refused["error"]["name"], "TwoFactorRequiredError");
    let (status, _) = call(&app, Method::GET, "/admin/api/auth/me", None, Some(&bob)).await;
    assert_eq!(status, StatusCode::OK, "the profile stays reachable");
    enable_totp(&app, &bob).await;
    let (status, _) = call(&app, Method::GET, "/admin/api/content-types", None, Some(&bob)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/auth/two-factor/totp/disable",
        Some(json!({ "password": PASSWORD })),
        Some(&bob),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "the only factor of a required role stays");

    // An admin who lost their factor gets a reset.
    let (status, _) = call(
        &app,
        Method::DELETE,
        &format!("/admin/api/users/{bob_id}/two-factor"),
        None,
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(login(&app, "bob@example.com").await["accessToken"].is_string());
    let (status, _) =
        call(&app, Method::DELETE, "/admin/api/users/1/two-factor", None, Some(&bob)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.done().await;
}

#[tokio::test]
async fn wrong_codes_lock_the_account_across_sign_ins() {
    let app = App::new(Schema::default()).await;
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, body) =
        call(&app, Method::POST, "/admin/api/auth/register-first-admin", Some(body), None).await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let (secret, _, _) = enable_totp(&app, &admin).await;
    let wrong = |token: String| {
        let app = &app;
        async move {
            call(
                app,
                Method::POST,
                "/admin/api/auth/login/two-factor",
                Some(json!({ "twoFactorToken": token, "code": "000000" })),
                None,
            )
            .await
            .0
        }
    };
    // A correct password between tries does not reset the count.
    for _ in 0..2 {
        let token =
            login(&app, "ada@example.com").await["twoFactorToken"].as_str().unwrap().to_owned();
        assert_eq!(wrong(token.clone()).await, StatusCode::BAD_REQUEST);
        assert_eq!(wrong(token).await, StatusCode::BAD_REQUEST);
    }
    let token = login(&app, "ada@example.com").await["twoFactorToken"].as_str().unwrap().to_owned();
    assert_eq!(wrong(token.clone()).await, StatusCode::BAD_REQUEST, "the fifth failure locks");
    let code = verdin_auth::totp_code(&secret, now() + 30).unwrap();
    let (status, _) = call(
        &app,
        Method::POST,
        "/admin/api/auth/login/two-factor",
        Some(json!({ "twoFactorToken": token, "code": code })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "locked: even the right code is refused");
    app.done().await;
}
