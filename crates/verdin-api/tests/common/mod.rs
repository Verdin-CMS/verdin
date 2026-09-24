//! HTTP harness: a router over a fresh, migrated database per test.
#![allow(dead_code)]

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use verdin_api::ApiConfig;
use verdin_content::Registry;
use verdin_migrate::{ApplyOptions, Renames, Risk};
use verdin_schema::Schema;
use verdin_testkit::TestDb;

pub struct App {
    pub router: Router,
    pub test: TestDb,
}

impl App {
    pub async fn new(schema: Schema) -> Self {
        Self::with_config(schema, ApiConfig { open_access: true, ..ApiConfig::default() }).await
    }

    pub async fn with_config(schema: Schema, config: ApiConfig) -> Self {
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
        let router = Router::new().nest(
            "/api",
            verdin_api::router(test.db.clone(), Registry::new(schema), config, "/api"),
        );
        Self { router, test }
    }

    pub async fn call(
        &self,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value =
            if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() };
        (status, value)
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
