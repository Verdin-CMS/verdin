//! Connects to the database in `VERDIN_TEST_DATABASE_URL` (defaults to in-memory SQLite).
//! CI runs this once per engine and sets `VERDIN_TEST_EXPECT_FLAVOR` to assert detection.

use verdin_db::{ConnectOptions, Database, DbError, Flavor};

fn test_url() -> String {
    std::env::var("VERDIN_TEST_DATABASE_URL").unwrap_or_else(|_| "sqlite::memory:".into())
}

#[tokio::test]
async fn connects_detects_flavor_and_pings() {
    let db = Database::connect(&test_url(), &ConnectOptions::default()).await.expect("connect");

    if let Ok(expected) = std::env::var("VERDIN_TEST_EXPECT_FLAVOR") {
        assert_eq!(db.flavor().as_str(), expected);
    }
    assert!(db.version() >= db.flavor().minimum_version());

    db.ping().await.expect("ping");
    db.close().await;
}

#[tokio::test]
async fn sqlite_is_detected() {
    let db = Database::connect("sqlite::memory:", &ConnectOptions::default()).await.unwrap();
    assert_eq!(db.flavor(), Flavor::Sqlite);
}

#[tokio::test]
async fn rejects_unknown_scheme() {
    let error =
        Database::connect("mongodb://localhost", &ConnectOptions::default()).await.unwrap_err();
    assert!(matches!(error, DbError::UnsupportedScheme(scheme) if scheme == "mongodb"));
}
