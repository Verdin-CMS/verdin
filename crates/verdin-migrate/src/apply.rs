//! Plan execution (docs/architecture.md §10.4).
//!
//! - PostgreSQL / SQLite: the whole plan and the new snapshot commit in one transaction.
//! - MySQL / MariaDB: DDL commits implicitly, so progress is journaled step by step and an
//!   interrupted run resumes from the failed step when the recomputed plan is unchanged.
//!
//! Every run holds a per-database migration lock on one dedicated connection.

use std::time::{SystemTime, UNIX_EPOCH};

use verdin_db::{ColumnKind, Conn, Database, DbError, Flavor, SqlValue};

use crate::MigrateError;
use crate::diff::{Renames, Risk};
use crate::model::{Column, ColumnType, DbModel, Table};
use crate::plan::{Plan, build_plan};
use crate::sql::Dialect;

pub const SNAPSHOTS_TABLE: &str = "vd_schema_snapshots";
pub const JOURNAL_TABLE: &str = "vd_migrations_journal";

/// PostgreSQL advisory lock key ("verdin" in ASCII).
const PG_LOCK_KEY: i64 = 0x7665_7264_696e;
const MYSQL_LOCK_TIMEOUT_SECS: i64 = 60;

#[derive(Debug)]
pub enum Status {
    UpToDate,
    Pending(Plan),
    /// A MySQL/MariaDB run stopped part-way; `done` steps of `plan` are applied.
    Interrupted {
        plan: Plan,
        done: usize,
        error: Option<String>,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct ApplyOptions {
    /// Highest risk level allowed to run.
    pub allow: Risk,
}

impl Default for ApplyOptions {
    fn default() -> Self {
        Self { allow: Risk::Safe }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ApplyReport {
    pub applied_steps: usize,
    /// Step index an interrupted run resumed from.
    pub resumed_from: Option<usize>,
}

struct JournalEntry {
    id: i64,
    plan_hash: String,
    done: usize,
    error: Option<String>,
}

/// Compares the desired model with the database without changing anything
/// (other than creating the system tables on first use).
pub async fn status(
    db: &Database,
    desired: &DbModel,
    renames: &Renames,
) -> Result<Status, MigrateError> {
    let mut conn = db.acquire().await?;
    ensure_system_tables(&mut conn).await?;
    let current = load_snapshot(&mut conn).await?;
    let plan = build_plan(&current, desired, renames, db.flavor())?;
    Ok(match running_journal(&mut conn).await? {
        Some(entry) => Status::Interrupted { plan, done: entry.done, error: entry.error },
        None if plan.is_empty() => Status::UpToDate,
        None => Status::Pending(plan),
    })
}

pub async fn apply(
    db: &Database,
    desired: &DbModel,
    renames: &Renames,
    options: ApplyOptions,
) -> Result<ApplyReport, MigrateError> {
    let mut conn = db.acquire().await?;
    ensure_system_tables(&mut conn).await?;
    lock(&mut conn).await?;
    let result = apply_locked(&mut conn, desired, renames, options).await;
    if let Err(error) = unlock(&mut conn).await {
        tracing::warn!(%error, "failed to release the migration lock");
    }
    result
}

async fn apply_locked(
    conn: &mut Conn,
    desired: &DbModel,
    renames: &Renames,
    options: ApplyOptions,
) -> Result<ApplyReport, MigrateError> {
    let current = load_snapshot(conn).await?;
    let plan = build_plan(&current, desired, renames, conn.flavor())?;
    let journal = running_journal(conn).await?;

    let start = match &journal {
        Some(entry) if entry.plan_hash == plan.hash() => entry.done,
        Some(entry) => {
            return Err(MigrateError::InterruptedPlanMismatch { done: entry.done });
        }
        None => 0,
    };
    if plan.is_empty() && journal.is_none() {
        return Ok(ApplyReport { applied_steps: 0, resumed_from: None });
    }

    let remaining = &plan.steps[start..];
    let blocked: Vec<String> = remaining
        .iter()
        .filter(|step| step.risk > options.allow)
        .map(|step| format!("{} ({})", step.description, step.risk.as_str()))
        .collect();
    if !blocked.is_empty() {
        return Err(MigrateError::NeedsApproval { steps: blocked });
    }

    // On resume, earlier steps already changed the database, so pre-plan pre-checks no
    // longer describe it; the failed step simply runs again.
    if start == 0 {
        for step in remaining {
            if let Some(precheck) = &step.precheck
                && conn.has_rows(&precheck.sql, &[]).await?
            {
                return Err(MigrateError::PrecheckFailed {
                    step: step.description.clone(),
                    reason: precheck.failure.clone(),
                });
            }
        }
    }

    let steps_json = serde_json::to_string(&plan.steps).expect("steps serialize");
    let model_json = serde_json::to_string(desired).expect("model serializes");

    if conn.flavor().transactional_ddl() {
        let begin = if conn.flavor() == Flavor::Sqlite { "BEGIN IMMEDIATE" } else { "BEGIN" };
        conn.execute(begin, &[]).await?;
        let result = async {
            for (index, step) in plan.steps.iter().enumerate() {
                for statement in &step.statements {
                    conn.execute(statement, &[]).await.map_err(|source| {
                        MigrateError::StepFailed {
                            index,
                            total: plan.steps.len(),
                            step: step.description.clone(),
                            source,
                        }
                    })?;
                }
            }
            insert_snapshot(conn, desired, &model_json).await?;
            insert_journal(conn, &plan, &steps_json, "completed", plan.steps.len()).await?;
            Ok::<_, MigrateError>(())
        }
        .await;
        match result {
            Ok(()) => conn.execute("COMMIT", &[]).await?,
            Err(error) => {
                if let Err(rollback) = conn.execute("ROLLBACK", &[]).await {
                    tracing::error!(%rollback, "rollback failed");
                }
                return Err(error);
            }
        };
        return Ok(ApplyReport { applied_steps: plan.steps.len(), resumed_from: None });
    }

    let journal_id = match &journal {
        Some(entry) => entry.id,
        None => insert_journal(conn, &plan, &steps_json, "running", 0).await?,
    };
    for (index, step) in plan.steps.iter().enumerate().skip(start) {
        debug_assert_eq!(step.statements.len(), 1, "MySQL steps are single statements");
        for statement in &step.statements {
            if let Err(source) = conn.execute(statement, &[]).await {
                let message = source.to_string();
                let _ = conn
                    .execute(
                        &format!("UPDATE {JOURNAL_TABLE} SET error = ? WHERE id = ?"),
                        &[SqlValue::Text(message), SqlValue::BigInt(journal_id)],
                    )
                    .await;
                return Err(MigrateError::StepFailed {
                    index,
                    total: plan.steps.len(),
                    step: step.description.clone(),
                    source,
                });
            }
        }
        conn.execute(
            &format!("UPDATE {JOURNAL_TABLE} SET done_steps = ?, error = NULL WHERE id = ?"),
            &[SqlValue::BigInt(index as i64 + 1), SqlValue::BigInt(journal_id)],
        )
        .await?;
    }

    conn.execute("BEGIN", &[]).await?;
    let finish = async {
        insert_snapshot(conn, desired, &model_json).await?;
        conn.execute(
            &format!(
                "UPDATE {JOURNAL_TABLE} SET status = 'completed', finished_at = ? WHERE id = ?"
            ),
            &[SqlValue::BigInt(now_millis()), SqlValue::BigInt(journal_id)],
        )
        .await?;
        Ok::<_, DbError>(())
    }
    .await;
    match finish {
        Ok(()) => conn.execute("COMMIT", &[]).await?,
        Err(error) => {
            let _ = conn.execute("ROLLBACK", &[]).await;
            return Err(error.into());
        }
    };

    Ok(ApplyReport {
        applied_steps: plan.steps.len() - start,
        resumed_from: journal.map(|entry| entry.done),
    })
}

fn system_tables() -> [Table; 2] {
    let text = |name: &str| Column::new(name, ColumnType::Text).not_null();
    let bigint = |name: &str| Column::new(name, ColumnType::BigInt).not_null();
    let hash = |name: &str| Column::new(name, ColumnType::Varchar { length: 64 }).not_null();
    [
        Table {
            name: SNAPSHOTS_TABLE.into(),
            columns: vec![
                Column::new("id", ColumnType::Id).not_null(),
                hash("model_hash"),
                text("model"),
                bigint("created_at"),
            ],
            indexes: Vec::new(),
        },
        Table {
            name: JOURNAL_TABLE.into(),
            columns: vec![
                Column::new("id", ColumnType::Id).not_null(),
                hash("plan_hash"),
                Column::new("status", ColumnType::Varchar { length: 16 }).not_null(),
                text("steps"),
                bigint("total_steps"),
                bigint("done_steps"),
                bigint("started_at"),
                Column::new("finished_at", ColumnType::BigInt),
                Column::new("error", ColumnType::Text),
            ],
            indexes: Vec::new(),
        },
    ]
}

async fn ensure_system_tables(conn: &mut Conn) -> Result<(), MigrateError> {
    let dialect = Dialect::new(conn.flavor());
    for table in system_tables() {
        conn.execute(&dialect.create_table(&table, true), &[]).await?;
    }
    Ok(())
}

async fn lock(conn: &mut Conn) -> Result<(), MigrateError> {
    match conn.flavor() {
        Flavor::Postgres => {
            conn.execute("SELECT pg_advisory_lock(?)", &[SqlValue::BigInt(PG_LOCK_KEY)]).await?;
        }
        Flavor::MySql | Flavor::MariaDb => {
            // Lock names are server-wide; scope them to the current database.
            let rows = conn
                .fetch_all(
                    "SELECT GET_LOCK(CONCAT('verdin_migrate:', DATABASE()), ?)",
                    &[SqlValue::BigInt(MYSQL_LOCK_TIMEOUT_SECS)],
                    &[ColumnKind::BigInt],
                )
                .await?;
            if rows.first().and_then(|row| row[0].as_i64()) != Some(1) {
                return Err(MigrateError::LockTimeout);
            }
        }
        // SQLite serializes writers with `BEGIN IMMEDIATE`.
        Flavor::Sqlite => {}
    }
    Ok(())
}

async fn unlock(conn: &mut Conn) -> Result<(), DbError> {
    match conn.flavor() {
        Flavor::Postgres => {
            conn.execute("SELECT pg_advisory_unlock(?)", &[SqlValue::BigInt(PG_LOCK_KEY)]).await?;
        }
        Flavor::MySql | Flavor::MariaDb => {
            conn.fetch_all(
                "SELECT RELEASE_LOCK(CONCAT('verdin_migrate:', DATABASE()))",
                &[],
                &[ColumnKind::BigInt],
            )
            .await?;
        }
        Flavor::Sqlite => {}
    }
    Ok(())
}

async fn load_snapshot(conn: &mut Conn) -> Result<DbModel, MigrateError> {
    let rows = conn
        .fetch_all(
            &format!("SELECT model FROM {SNAPSHOTS_TABLE} ORDER BY id DESC LIMIT 1"),
            &[],
            &[ColumnKind::Text],
        )
        .await?;
    match rows
        .into_iter()
        .next()
        .and_then(|row| row.into_iter().next())
        .and_then(SqlValue::into_text)
    {
        Some(json) => serde_json::from_str(&json)
            .map_err(|error| MigrateError::CorruptSnapshot(error.to_string())),
        None => Ok(DbModel::default()),
    }
}

async fn insert_snapshot(conn: &mut Conn, model: &DbModel, json: &str) -> Result<(), DbError> {
    conn.execute(
        &format!("INSERT INTO {SNAPSHOTS_TABLE} (model_hash, model, created_at) VALUES (?, ?, ?)"),
        &[
            SqlValue::Text(model.hash()),
            SqlValue::Text(json.to_owned()),
            SqlValue::BigInt(now_millis()),
        ],
    )
    .await
    .map(drop)
}

async fn insert_journal(
    conn: &mut Conn,
    plan: &Plan,
    steps_json: &str,
    status: &str,
    done: usize,
) -> Result<i64, DbError> {
    let now = now_millis();
    let finished = if status == "completed" { now.to_string() } else { "NULL".into() };
    conn.insert_returning_id(
        &format!(
            "INSERT INTO {JOURNAL_TABLE} (plan_hash, status, steps, total_steps, done_steps, started_at, finished_at) \
             VALUES (?, ?, ?, ?, ?, ?, {finished})"
        ),
        &[
            SqlValue::Text(plan.hash()),
            SqlValue::Text(status.into()),
            SqlValue::Text(steps_json.to_owned()),
            SqlValue::BigInt(plan.steps.len() as i64),
            SqlValue::BigInt(done as i64),
            SqlValue::BigInt(now),
        ],
    )
    .await
}

async fn running_journal(conn: &mut Conn) -> Result<Option<JournalEntry>, DbError> {
    let rows = conn
        .fetch_all(
            &format!(
                "SELECT id, plan_hash, done_steps, error FROM {JOURNAL_TABLE} \
                 WHERE status = 'running' ORDER BY id DESC LIMIT 1"
            ),
            &[],
            &[ColumnKind::BigInt, ColumnKind::Text, ColumnKind::BigInt, ColumnKind::Text],
        )
        .await?;
    Ok(rows.into_iter().next().map(|row| {
        let mut row = row.into_iter();
        let id = row.next().and_then(|value| value.as_i64()).unwrap_or_default();
        let plan_hash = row.next().and_then(SqlValue::into_text).unwrap_or_default();
        let done = row.next().and_then(|value| value.as_i64()).unwrap_or_default();
        let error = row.next().and_then(SqlValue::into_text);
        JournalEntry { id, plan_hash, done: usize::try_from(done).unwrap_or(0), error }
    }))
}

fn now_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as i64)
}
