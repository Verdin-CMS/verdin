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

/// Feature switches kept in memory (the real host also rebuilds the app).
#[derive(Default)]
pub struct MemoryFeatures(std::sync::Mutex<verdin_api::features::FeatureStates>);

impl verdin_api::features::FeatureHost for MemoryFeatures {
    fn states(&self) -> verdin_api::features::FeatureStates {
        self.0.lock().unwrap().clone()
    }

    fn update(
        &self,
        id: String,
        state: verdin_api::features::FeatureState,
    ) -> verdin_api::BoxFuture<'_, Result<(), verdin_api::ApiError>> {
        self.0.lock().unwrap().0.insert(id, state);
        Box::pin(async { Ok(()) })
    }
}

pub const SECRET: &str = "test-secret-test-secret-test-secret!";
pub const PEPPER: &str = "test-pepper-test-pepper-test-pepper!";

pub struct App {
    pub router: Router,
    pub test: TestDb,
    pub auth: AuthService,
    /// The media library, backed by an in-memory store.
    pub upload: verdin_upload::UploadService,
    /// A full-access API token, sent by default.
    pub token: String,
}

/// Who a request authenticates as.
#[derive(Clone, Copy)]
pub enum As<'a> {
    Anonymous,
    Bearer(&'a str),
}

/// One part of a multipart body: a file (with `file_name`) or a text field.
pub struct Part<'a> {
    pub name: &'a str,
    pub file_name: Option<&'a str>,
    pub bytes: Vec<u8>,
}

impl<'a> Part<'a> {
    pub fn file(name: &'a str, file_name: &'a str, bytes: Vec<u8>) -> Self {
        Self { name, file_name: Some(file_name), bytes }
    }

    pub fn text(name: &'a str, text: &str) -> Self {
        Self { name, file_name: None, bytes: text.as_bytes().to_vec() }
    }
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
        let store = std::sync::Arc::new(object_store::memory::InMemory::new());
        let upload = verdin_upload::UploadService::new(
            test.db.clone(),
            verdin_upload::Storage::with_store(store, "local", "/uploads"),
            verdin_upload::UploadConfig { max_file_size: 2 * 1024 * 1024, ..Default::default() },
        );
        let admin = AdminConfig {
            secure_cookies: false,
            auth_rate_limit: 1000,
            upload: Some(upload.clone()),
            features: Some(std::sync::Arc::new(MemoryFeatures::default())),
            ..AdminConfig::default()
        };
        let router = Router::new()
            .nest(
                "/api",
                verdin_api::router(
                    test.db.clone(),
                    registry.clone(),
                    auth.clone(),
                    ApiConfig::default(),
                    "/api",
                    Some(upload.clone()),
                ),
            )
            .nest(
                "/admin/api",
                verdin_api::admin_router(test.db.clone(), registry, auth.clone(), admin),
            );
        Self { router, test, auth, upload, token }
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

    /// A `multipart/form-data` request.
    pub async fn multipart(
        &self,
        method: Method,
        uri: &str,
        parts: &[Part<'_>],
        who: As<'_>,
    ) -> Response {
        let boundary = "verdin-test-boundary";
        let mut body = Vec::new();
        for part in parts {
            body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
            match part.file_name {
                Some(file_name) => body.extend_from_slice(
                    format!(
                        "Content-Disposition: form-data; name=\"{}\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n",
                        part.name
                    )
                    .as_bytes(),
                ),
                None => body.extend_from_slice(
                    format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", part.name).as_bytes(),
                ),
            }
            body.extend_from_slice(&part.bytes);
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", format!("multipart/form-data; boundary={boundary}"));
        if let As::Bearer(token) = who {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let response =
            self.router.clone().oneshot(request.body(Body::from(body)).unwrap()).await.unwrap();
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
