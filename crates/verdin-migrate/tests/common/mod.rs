#![allow(dead_code)]

use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::Value;
use verdin_db::{ConnectOptions, Database, Flavor, Kind, Param};
use verdin_migrate::DbModel;
use verdin_schema::{Schema, Source};

pub fn base_url() -> String {
    std::env::var("VERDIN_TEST_DATABASE_URL").unwrap_or_else(|_| "sqlite::memory:".into())
}

/// A database of its own for one test: a temp file on SQLite, a fresh database elsewhere.
pub struct TestDb {
    pub db: Database,
    admin: Option<(Database, String)>,
    _dir: Option<tempfile::TempDir>,
}

impl TestDb {
    pub async fn new() -> Self {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let base = base_url();
        let options = ConnectOptions::default();

        if base.starts_with("sqlite") {
            let dir = tempfile::tempdir().unwrap();
            let url = format!("sqlite://{}", dir.path().join("test.db").display());
            let db = Database::connect(&url, &options).await.unwrap();
            return Self { db, admin: None, _dir: Some(dir) };
        }

        let admin = Database::connect(&base, &options).await.unwrap();
        let name = format!(
            "vd_test_{}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let mut conn = admin.acquire().await.unwrap();
        conn.execute(&format!("CREATE DATABASE {name}"), &[]).await.unwrap();
        drop(conn);

        let mut url = url::Url::parse(&base).unwrap();
        url.set_path(&format!("/{name}"));
        let db = Database::connect(url.as_str(), &options).await.unwrap();
        Self { db, admin: Some((admin, name)), _dir: None }
    }

    pub fn flavor(&self) -> Flavor {
        self.db.flavor()
    }

    pub async fn drop(self) {
        self.db.close().await;
        if let Some((admin, name)) = self.admin {
            let mut conn = admin.acquire().await.unwrap();
            conn.execute(&format!("DROP DATABASE {name}"), &[]).await.unwrap();
        }
    }

    pub async fn exec(&self, sql: &str, params: &[Param]) {
        let mut conn = self.db.acquire().await.unwrap();
        conn.execute(sql, params).await.unwrap_or_else(|error| panic!("{sql}: {error}"));
    }

    pub async fn table_exists(&self, table: &str) -> bool {
        let mut conn = self.db.acquire().await.unwrap();
        conn.has_rows(&format!("SELECT 1 FROM {table} WHERE 1 = 0"), &[]).await.is_ok()
    }

    pub async fn texts(&self, sql: &str) -> Vec<Option<String>> {
        let mut conn = self.db.acquire().await.unwrap();
        conn.fetch_all(sql, &[], &[Kind::Text])
            .await
            .unwrap_or_else(|error| panic!("{sql}: {error}"))
            .into_iter()
            .map(|row| row.into_iter().next().unwrap().into_text())
            .collect()
    }

    pub async fn count(&self, table: &str) -> i64 {
        let mut conn = self.db.acquire().await.unwrap();
        let rows = conn
            .fetch_all(&format!("SELECT COUNT(*) FROM {table}"), &[], &[Kind::Int])
            .await
            .unwrap();
        rows[0][0].as_int().unwrap()
    }

    /// Inserts a published row into a content type table with the given text columns.
    pub async fn insert(&self, table: &str, document_id: &str, columns: &[(&str, &str)]) {
        let names: String = columns.iter().map(|(name, _)| format!(", {name}")).collect();
        let marks: String = columns.iter().map(|_| ", ?").collect();
        let mut params = vec![Param::from(document_id)];
        params.extend(columns.iter().map(|(_, value)| Param::from(*value)));
        self.exec(
            &format!(
                "INSERT INTO {table} (document_id, locale, publication_state, created_at, updated_at{names}) \
                 VALUES (?, '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP{marks})"
            ),
            &params,
        )
        .await;
    }
}

pub fn content_type(name: &str, plural: &str, attributes: Value) -> Source {
    Source::content_type(
        name,
        serde_json::json!({
            "kind": "collectionType",
            "singularName": name,
            "pluralName": plural,
            "displayName": name,
            "options": { "draftAndPublish": true },
            "attributes": attributes,
        })
        .to_string(),
    )
}

pub fn model(sources: &[Source]) -> DbModel {
    verdin_migrate::derive_model(&Schema::parse(sources).unwrap())
}
