//! Schema migrations: derive the physical model from the schema, diff it against the last
//! applied snapshot, plan per-dialect DDL, and apply it safely.

mod apply;
mod derive;
mod diff;
mod model;
mod plan;
mod sql;

pub use apply::{ApplyOptions, ApplyReport, JOURNAL_TABLE, SNAPSHOTS_TABLE, Status, apply, status};
pub use derive::{MAX_IDENTIFIER, bounded, derive_model, index_name, system_columns};
pub use diff::{Change, Diff, Renames, Risk, diff};
pub use model::{Column, ColumnDefault, ColumnType, DbModel, Index, Table};
pub use plan::{Plan, Precheck, Step, build_plan};
pub use sql::Dialect;

#[derive(Debug, thiserror::Error)]
pub enum MigrateError {
    #[error(transparent)]
    Db(#[from] verdin_db::DbError),
    #[error("invalid rename: {0}")]
    InvalidRename(String),
    #[error("these steps need explicit approval:\n  {}", steps.join("\n  "))]
    NeedsApproval { steps: Vec<String> },
    #[error("pre-check failed for `{step}`: {reason}")]
    PrecheckFailed { step: String, reason: String },
    #[error("step {} of {total} (`{step}`) failed: {source}", index + 1)]
    StepFailed {
        index: usize,
        total: usize,
        step: String,
        #[source]
        source: verdin_db::DbError,
    },
    #[error(
        "an interrupted migration ({done} steps applied) no longer matches the schema; \
         restore the schema it was planned from and apply again to finish it"
    )]
    InterruptedPlanMismatch { done: usize },
    #[error("stored schema snapshot is unreadable: {0}")]
    CorruptSnapshot(String),
    #[error("timed out waiting for the migration lock (another instance is migrating)")]
    LockTimeout,
}
