//! Admin SSO against a local OpenID Connect provider.


use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{Method, StatusCode};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use crate::common::{App, As};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
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

/// What the provider saw at `/authorize` and will put in the ID token.
#[derive(Default)]
struct Provider {
    issuer: String,
    nonce: String,
    challenge: String,
    email: String,
    groups: Vec<String>,
    secret: Option<String>,
}

type Shared = Arc<Mutex<Provider>>;

async fn discovery(State(provider): State<Shared>) -> Json<Value> {
    let issuer = provider.lock().unwrap().issuer.clone();
    Json(json!({
        "issuer": issuer,
        "authorization_endpoint": format!("{issuer}/authorize"),
        "token_endpoint": format!("{issuer}/token"),
    }))
}

async fn token(
    State(provider): State<Shared>,
    Form(form): Form<std::collections::HashMap<String, String>>,
) -> Json<Value> {
    let provider = provider.lock().unwrap();
    let verifier = form.get("code_verifier").cloned().unwrap_or_default();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    if form.get("code").map(String::as_str) != Some("good-code")
        || challenge != provider.challenge
        || form.get("client_secret") != provider.secret.as_ref()
    {
        return Json(json!({ "error": "invalid_grant" }));
    }
    let claims = json!({
        "iss": provider.issuer, "aud": "verdin", "sub": "42",
        "exp": time::OffsetDateTime::now_utc().unix_timestamp() + 300,
        "nonce": provider.nonce, "email": provider.email, "email_verified": true,
        "given_name": "Grace", "family_name": "Hopper", "groups": provider.groups,
    });
    let id_token = format!("e30.{}.unsigned", URL_SAFE_NO_PAD.encode(claims.to_string()));
    Json(json!({ "access_token": "at", "token_type": "Bearer", "id_token": id_token }))
}

async fn provider() -> Shared {
    let shared: Shared = Arc::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    shared.lock().unwrap().issuer = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route("/token", post(token))
        .with_state(shared.clone());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    shared
}

fn query_param(url: &str, name: &str) -> String {
    url::Url::parse(url).unwrap().query_pairs().find(|(key, _)| key == name).unwrap().1.into_owned()
}

fn set_cookie(response: &crate::common::Response) -> String {
    response.headers["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned()
}

/// Starts a sign-in and follows the provider back; returns the callback answer.
async fn sign_in(app: &App, provider: &Shared, id: &str, code: &str) -> crate::common::Response {
    let start = app
        .request(Method::GET, &format!("/admin/api/auth/sso/{id}"), None, As::Anonymous, &[])
        .await;
    assert!(start.status.is_redirection(), "{}", start.body);
    let location = start.headers["location"].to_str().unwrap().to_owned();
    {
        let mut provider = provider.lock().unwrap();
        assert!(location.starts_with(&format!("{}/authorize?", provider.issuer)));
        assert_eq!(query_param(&location, "code_challenge_method"), "S256");
        assert_eq!(
            query_param(&location, "redirect_uri"),
            format!("http://localhost:1337/admin/api/auth/sso/{id}/callback")
        );
        provider.nonce = query_param(&location, "nonce");
        provider.challenge = query_param(&location, "code_challenge");
    }
    let state = query_param(&location, "state");
    let cookie = set_cookie(&start);
    let uri = format!(
        "/admin/api/auth/sso/{id}/callback?code={code}&state={}",
        url::form_urlencoded::byte_serialize(state.as_bytes()).collect::<String>()
    );
    app.request(Method::GET, &uri, None, As::Anonymous, &[("cookie", &cookie)]).await
}

#[tokio::test]
async fn signs_in_and_creates_accounts() {
    let app = App::new(schema()).await;
    let idp = provider().await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();

    let (_, none) = app.call_as(Method::GET, "/admin/api/auth/sso", None, As::Anonymous).await;
    assert_eq!(none["data"], json!([]), "off by default");
    let issuer = idp.lock().unwrap().issuer.clone();
    let settings = json!({ "providers": [
        { "id": "corp", "name": "Corp ID", "issuer": issuer, "clientId": "verdin", "autoCreate": true,
          "roleClaim": "groups", "roleMap": { "writers": "editor" }, "defaultRoles": ["author"],
          "allowedDomains": ["corp.test"] },
        { "id": "strict", "name": "Strict", "issuer": issuer, "clientId": "verdin" },
    ] });
    let (status, body) = app
        .call_as(
            Method::PUT,
            "/admin/api/features/sso",
            Some(json!({ "enabled": true, "settings": settings })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, listed) = app.call_as(Method::GET, "/admin/api/auth/sso", None, As::Anonymous).await;
    assert_eq!(
        listed["data"],
        json!([{ "id": "corp", "name": "Corp ID" }, { "id": "strict", "name": "Strict" }])
    );

    // A new account, with the role its groups map to.
    {
        let mut provider = idp.lock().unwrap();
        provider.email = "grace@corp.test".into();
        provider.groups = vec!["writers".into()];
    }
    let callback = sign_in(&app, &idp, "corp", "good-code").await;
    assert_eq!(callback.headers["location"], "/admin/");
    let refresh = callback
        .headers
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap().to_owned())
        .find(|value| value.starts_with("verdin_refresh="))
        .expect("a session");
    let cookie = refresh.split(';').next().unwrap().to_owned();
    let session = app
        .request(
            Method::POST,
            "/admin/api/auth/refresh",
            None,
            As::Anonymous,
            &[("cookie", &cookie), ("x-verdin-csrf", "1")],
        )
        .await;
    assert_eq!(session.status, StatusCode::OK, "{}", session.body);
    let user = &session.body["data"]["user"];
    assert_eq!(user["email"], "grace@corp.test");
    assert_eq!(user["firstname"], "Grace");
    assert_eq!(user["roles"][0]["code"], "editor");

    // Refusals land on the login page with a reason.
    let failures = [
        ("corp", "bad-code", "grace@corp.test"),
        ("corp", "good-code", "eve@elsewhere.test"),
        ("strict", "good-code", "nobody@corp.test"),
    ];
    for (id, code, email) in failures {
        idp.lock().unwrap().email = email.into();
        let refused = sign_in(&app, &idp, id, code).await;
        let location = refused.headers["location"].to_str().unwrap();
        assert!(location.starts_with("/admin/login?ssoError="), "{id} {code} {email}: {location}");
    }
    // Existing admins sign in through a provider that does not create accounts.
    idp.lock().unwrap().email = "ada@example.com".into();
    assert_eq!(sign_in(&app, &idp, "strict", "good-code").await.headers["location"], "/admin/");

    // The state must come with the cookie set when the sign-in started.
    let start =
        app.request(Method::GET, "/admin/api/auth/sso/corp", None, As::Anonymous, &[]).await;
    let state = query_param(start.headers["location"].to_str().unwrap(), "state");
    let forged = app
        .request(
            Method::GET,
            &format!("/admin/api/auth/sso/corp/callback?code=good-code&state={state}"),
            None,
            As::Anonymous,
            &[],
        )
        .await;
    assert!(forged.headers["location"].to_str().unwrap().contains("ssoError="));
    app.done().await;
}
