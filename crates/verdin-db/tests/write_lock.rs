//! SQLite writers queue for the write lock in arrival order.

use std::sync::Arc;
use std::time::Duration;

use verdin_db::{ColumnKind, ConnectOptions, Database, DbError, SqlValue};

/// A SQLite file in the temp directory, removed (with its WAL files) on drop.
struct TempDb {
    db: Database,
    path: std::path::PathBuf,
}

impl TempDb {
    async fn new(name: &str) -> Self {
        let path = std::env::temp_dir()
            .join(format!("verdin-write-lock-{name}-{}.db", std::process::id()));
        remove(&path);
        let url = format!("sqlite://{}", path.display());
        let db = Database::connect(&url, &ConnectOptions::default()).await.unwrap();
        let mut conn = db.acquire().await.unwrap();
        conn.execute("CREATE TABLE writes (id INTEGER PRIMARY KEY, writer INTEGER NOT NULL)", &[])
            .await
            .unwrap();
        Self { db, path }
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        remove(&self.path);
    }
}

fn remove(path: &std::path::Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

async fn writers(db: &Database) -> Vec<i64> {
    db.queries()
        .fetch_all("SELECT writer FROM writes ORDER BY id", &[], &[ColumnKind::BigInt])
        .await
        .unwrap()
        .into_iter()
        .map(|row| row[0].as_i64().unwrap())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn writers_run_in_arrival_order() {
    let temp = TempDb::new("fifo").await;
    let db = &temp.db;

    // One writer holds the lock while the others arrive one by one; half of them use a
    // transaction and half a single statement on the pool.
    let first = db.begin().await.unwrap();
    let mut tasks = Vec::new();
    for writer in 0..20_i64 {
        let db = db.clone();
        tasks.push(tokio::spawn(async move {
            let insert = "INSERT INTO writes (writer) VALUES (?)";
            if writer % 2 == 0 {
                let mut tx = db.begin().await.unwrap();
                tx.execute(insert, &[SqlValue::BigInt(writer)]).await.unwrap();
                tx.commit().await.unwrap();
            } else {
                db.queries()
                    .insert_returning_id(insert, &[SqlValue::BigInt(writer)])
                    .await
                    .unwrap();
            }
        }));
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    first.commit().await.unwrap();
    for task in tasks {
        task.await.unwrap();
    }

    assert_eq!(writers(db).await, (0..20).collect::<Vec<_>>());
}

#[tokio::test]
async fn reads_do_not_wait_for_writers() {
    let temp = TempDb::new("reads").await;
    let mut tx = temp.db.begin().await.unwrap();
    tx.execute("INSERT INTO writes (writer) VALUES (1)", &[]).await.unwrap();
    // WAL readers see the last commit while the transaction is open.
    let read = tokio::time::timeout(Duration::from_secs(1), writers(&temp.db)).await;
    assert_eq!(read.unwrap(), Vec::<i64>::new());
    tx.commit().await.unwrap();
    assert_eq!(writers(&temp.db).await, vec![1]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn one_connection_pool_mixes_transactions_and_pool_writes() {
    // In-memory pools have a single connection. Writers take the lock before the
    // connection, so none holds the connection while waiting for the lock.
    let db = Database::connect("sqlite::memory:", &ConnectOptions::default()).await.unwrap();
    db.queries()
        .execute("CREATE TABLE writes (id INTEGER PRIMARY KEY, writer INTEGER NOT NULL)", &[])
        .await
        .unwrap();
    let db = Arc::new(db);
    let mut tasks = Vec::new();
    for writer in 0..50_i64 {
        let db = db.clone();
        tasks.push(tokio::spawn(async move {
            let insert = "INSERT INTO writes (writer) VALUES (?)";
            if writer % 3 == 0 {
                let mut tx = db.begin().await.unwrap();
                tx.execute(insert, &[SqlValue::BigInt(writer)]).await.unwrap();
                tx.commit().await.unwrap();
            } else {
                db.queries().execute(insert, &[SqlValue::BigInt(writer)]).await.unwrap();
            }
            writers(&db).await.len()
        }));
    }
    let all = tokio::time::timeout(Duration::from_secs(10), async {
        for task in tasks {
            task.await.unwrap();
        }
    })
    .await;
    assert!(all.is_ok(), "writers deadlocked");
    assert_eq!(writers(&db).await.len(), 50);
}

#[tokio::test]
async fn pool_write_inside_a_transaction_times_out() {
    // A caller holding a transaction must write through it: a pool write would wait for
    // the lock the caller itself holds. It fails after the busy timeout instead of hanging.
    let db = Database::connect("sqlite::memory:", &ConnectOptions::default()).await.unwrap();
    db.queries().execute("CREATE TABLE writes (writer INTEGER)", &[]).await.unwrap();
    let _tx = db.begin().await.unwrap();
    let error =
        db.queries().execute("INSERT INTO writes (writer) VALUES (1)", &[]).await.unwrap_err();
    assert!(matches!(error, DbError::WriteLockTimeout), "{error}");
}
