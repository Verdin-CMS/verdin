//! Changes → executable, per-dialect steps with risk levels and pre-checks.

use std::collections::BTreeSet;

use serde::Serialize;
use sha2::{Digest, Sha256};
use verdin_db::Flavor;

use crate::MigrateError;
use crate::diff::{Change, Diff, Renames, Risk, diff};
use crate::model::{DbModel, hex};
use crate::sql::Dialect;

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    #[serde(skip)]
    pub flavor: Flavor,
    pub steps: Vec<Step>,
    /// Likely renames the user may want to declare (CLI arguments).
    #[serde(skip)]
    pub hints: Vec<String>,
}

/// One unit of work. On MySQL/MariaDB (no transactional DDL) it is also the unit of
/// progress recorded in the journal, so every step there is a single statement.
#[derive(Debug, Clone, Serialize)]
pub struct Step {
    pub description: String,
    pub risk: Risk,
    pub statements: Vec<String>,
    #[serde(skip)]
    pub precheck: Option<Precheck>,
}

/// A query run before any DDL; the step cannot succeed if it returns a row.
#[derive(Debug, Clone)]
pub struct Precheck {
    pub sql: String,
    pub failure: String,
}

impl Plan {
    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn max_risk(&self) -> Option<Risk> {
        self.steps.iter().map(|step| step.risk).max()
    }

    /// Identifies the plan; an interrupted run resumes only if the recomputed plan matches.
    pub fn hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.flavor.as_str());
        for statement in self.steps.iter().flat_map(|step| &step.statements) {
            hasher.update(b"\n");
            hasher.update(statement);
        }
        hex(&hasher.finalize())
    }
}

pub fn build_plan(
    old: &DbModel,
    new: &DbModel,
    renames: &Renames,
    flavor: Flavor,
) -> Result<Plan, MigrateError> {
    let dialect = Dialect::new(flavor);
    let Diff { changes, renamed, hints } = diff(old, new, renames)?;

    // Logical changes that render identically (e.g. varchar → text on SQLite) need no DDL.
    let mut changes: Vec<Change> = changes
        .into_iter()
        .filter(|change| match change {
            Change::AlterColumn { from, to, .. } => {
                dialect.column_definition(from) != dialect.column_definition(to)
            }
            _ => true,
        })
        .collect();
    if flavor == Flavor::Sqlite {
        changes = collapse_into_rebuilds(changes, &renamed, new);
    }

    let steps = changes
        .iter()
        .map(|change| Step {
            description: change.describe(),
            risk: change.risk(),
            statements: dialect.statements(change),
            precheck: precheck(change, old, renames, &dialect),
        })
        .collect();
    Ok(Plan { flavor, steps, hints })
}

/// SQLite cannot alter columns: every table with a column alteration gets one rebuild
/// that replaces all of its column and index changes.
fn collapse_into_rebuilds(changes: Vec<Change>, renamed: &DbModel, new: &DbModel) -> Vec<Change> {
    let rebuilt: BTreeSet<String> = changes
        .iter()
        .filter_map(|change| match change {
            Change::AlterColumn { table, .. } => Some(table.clone()),
            _ => None,
        })
        .collect();
    if rebuilt.is_empty() {
        return changes;
    }

    let mut placed = BTreeSet::new();
    let mut out = Vec::with_capacity(changes.len());
    for change in changes {
        let table = match &change {
            Change::AddColumn { table, .. }
            | Change::AlterColumn { table, .. }
            | Change::DropColumn { table, .. }
            | Change::DropIndex { table, .. }
            | Change::CreateIndex { table, .. } => Some(table),
            _ => None,
        };
        match table {
            Some(table) if rebuilt.contains(table) => {
                if matches!(change, Change::AlterColumn { .. }) && placed.insert(table.clone()) {
                    out.push(Change::RebuildTable {
                        from: renamed.tables[table].clone(),
                        to: new.tables[table].clone(),
                    });
                }
            }
            _ => out.push(change),
        }
    }
    out
}

/// Pre-checks run before the first statement, so they use pre-plan (un-renamed) names.
fn precheck(
    change: &Change,
    old: &DbModel,
    renames: &Renames,
    dialect: &Dialect,
) -> Option<Precheck> {
    let q = |identifier: &str| dialect.quote(identifier);
    let old_table = |table: &str| -> String {
        renames
            .tables
            .iter()
            .find(|(_, to)| to.as_str() == table)
            .map_or_else(|| table.to_owned(), |(from, _)| from.clone())
    };
    let old_column = |table: &str, column: &str| -> String {
        renames
            .columns
            .iter()
            .find(|((renamed_table, _), to)| renamed_table == table && to.as_str() == column)
            .map_or_else(|| column.to_owned(), |((_, from), _)| from.clone())
    };

    match change {
        Change::CreateIndex { table, index, new_table: false } if index.unique => {
            let source = old_table(table);
            let existing = old.tables.get(&source)?;
            let columns: Vec<String> =
                index.columns.iter().map(|column| old_column(table, column)).collect();
            // Columns added by this plan are all NULL, and NULLs never collide.
            if columns.iter().any(|column| existing.column(column).is_none()) {
                return None;
            }
            let not_null = columns
                .iter()
                .map(|column| format!("{} IS NOT NULL", q(column)))
                .collect::<Vec<_>>();
            let group = columns.iter().map(|column| q(column)).collect::<Vec<_>>().join(", ");
            Some(Precheck {
                sql: format!(
                    "SELECT 1 FROM {} WHERE {} GROUP BY {group} HAVING COUNT(*) > 1 LIMIT 1",
                    q(&source),
                    not_null.join(" AND ")
                ),
                failure: format!("{source} has duplicate values in ({})", columns.join(", ")),
            })
        }
        Change::AddColumn { table, column } if !column.nullable && column.default.is_none() => {
            let source = old_table(table);
            old.tables.get(&source)?;
            Some(Precheck {
                sql: format!("SELECT 1 FROM {} LIMIT 1", q(&source)),
                failure: format!(
                    "cannot add NOT NULL column {} without a default: {source} has rows",
                    column.name
                ),
            })
        }
        Change::AlterColumn { table, from, to } if from.nullable && !to.nullable => {
            let source = old_table(table);
            let column = old_column(table, &from.name);
            Some(Precheck {
                sql: format!("SELECT 1 FROM {} WHERE {} IS NULL LIMIT 1", q(&source), q(&column)),
                failure: format!("{source}.{column} has NULL values"),
            })
        }
        _ => None,
    }
}
