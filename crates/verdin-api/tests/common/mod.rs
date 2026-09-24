//! HTTP harness: content API at `/api` and admin API at `/admin/api` over a fresh,
//! migrated database per test. Requests carry a full-access API token unless another
//! (or no) token is given.
#![allow(dead_code)]

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use verdin_api::{AdminConfig, ApiConfig};
use verdin_auth::{AuthConfig, AuthService, NewApiToken, TokenKind};
use verdin_content::Registry;
use verdin_migrate::{ApplyOptions, Renames, Risk};
use verdin_schema::Schema;
use verdin_testkit::TestDb;

pub const SECRET: &str = "test-secret-test-secret-test-secret!";
pub const PEPPER: &str = "test-pepper-test-pepper-test-pepper!";

pub struct App {
    pub router: Router,
    pub test: TestDb,
    pub auth: AuthService,
    /// A full-access API token, sent by default.
    pub token: String,
}

/// Who a request authenticates as.
#[derive(Clone, Copy)]
pub enum As<'a> {
    Anonymous,
    Bearer(&'a str),
}

pub struct Response {
    pub status: StatusCode,
    pub body: Value,
    pub headers: axum::http::HeaderMap,
}

impl App {
    pub async fn new(schema: Schema) -> Self {
        let test = TestDb::new().await;
        let model = verdin_migrate::derive_model(&schema);
        verdin_migrate::apply(
            &test.db,
            &model,
            &Renames::default(),
            ApplyOptions { allow: Risk::Safe },
        )
        .await
        .unwrap();
        let auth = AuthService::new(test.db.clone(), AuthConfig::new(SECRET, PEPPER).unwrap());
        auth.bootstrap().await.unwrap();
        let (_, token) = auth
            .create_api_token(NewApiToken {
                name: "tests".into(),
                description: None,
                kind: TokenKind::FullAccess,
                expires_in_days: None,
                permissions: vec![],
            })
            .await
            .unwrap();
        let registry = Registry::new(schema);
        let admin =
            AdminConfig { secure_cookies: false, auth_rate_limit: 1000, ..AdminConfig::default() };
        let router = Router::new()
            .nest(
                "/api",
                verdin_api::router(
                    test.db.clone(),
                    registry.clone(),
                    auth.clone(),
                    ApiConfig::default(),
                    "/api",
                ),
            )
            .nest(
                "/admin/api",
                verdin_api::admin_router(test.db.clone(), registry, auth.clone(), admin),
            );
        Self { router, test, auth, token }
    }

    pub async fn request(
        &self,
        method: Method,
        uri: &str,
        body: Option<Value>,
        who: As<'_>,
        headers: &[(&str, &str)],
    ) -> Response {
        let mut request =
            Request::builder().method(method).uri(uri).header("content-type", "application/json");
        if let As::Bearer(token) = who {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let request = request
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body =
            if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() };
        Response { status, body, headers }
    }

    pub async fn call_as(
        &self,
        method: Method,
        uri: &str,
        body: Option<Value>,
        who: As<'_>,
    ) -> (StatusCode, Value) {
        let response = self.request(method, uri, body, who, &[]).await;
        (response.status, response.body)
    }

    pub async fn call(
        &self,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        self.call_as(method, uri, body, As::Bearer(&self.token)).await
    }

    pub async fn get(&self, uri: &str) -> (StatusCode, Value) {
        self.call(Method::GET, uri, None).await
    }

    pub async fn post(&self, uri: &str, data: Value) -> (StatusCode, Value) {
        self.call(Method::POST, uri, Some(json!({ "data": data }))).await
    }

    pub async fn put(&self, uri: &str, data: Value) -> (StatusCode, Value) {
        self.call(Method::PUT, uri, Some(json!({ "data": data }))).await
    }

    pub async fn done(self) {
        self.test.drop().await;
    }
}

pub fn error_paths(body: &Value) -> Vec<Value> {
    body["error"]["details"]["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|error| error["path"].clone())
        .collect()
}
