//! Model diff: what changed between the last applied snapshot and the desired model.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::MigrateError;
use crate::model::{Column, DbModel, Index, Table};

/// Explicit renames. Never inferred: a dropped + added column is a drop and an add
/// unless the user says otherwise (the plan prints hints for likely renames).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Renames {
    /// old table name → new table name
    pub tables: BTreeMap<String, String>,
    /// (new table name, old column name) → new column name
    pub columns: BTreeMap<(String, String), String>,
}

impl Renames {
    /// Parses `old=new`.
    pub fn add_table(&mut self, spec: &str) -> Result<(), MigrateError> {
        let (from, to) = spec
            .split_once('=')
            .filter(|(from, to)| !from.is_empty() && !to.is_empty() && !from.contains('.'))
            .ok_or_else(|| {
                MigrateError::InvalidRename(format!("`{spec}`: expected old_table=new_table"))
            })?;
        self.tables.insert(from.into(), to.into());
        Ok(())
    }

    /// Parses `table.old=new` (table as named in the desired model).
    pub fn add_column(&mut self, spec: &str) -> Result<(), MigrateError> {
        let parsed = spec.split_once('=').and_then(|(left, to)| {
            let (table, from) = left.split_once('.')?;
            (![table, from, to].iter().any(|part| part.is_empty())).then_some((table, from, to))
        });
        let (table, from, to) = parsed.ok_or_else(|| {
            MigrateError::InvalidRename(format!("`{spec}`: expected table.old_column=new_column"))
        })?;
        self.columns.insert((table.into(), from.into()), to.into());
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    /// Cannot lose data or fail on existing data.
    Safe,
    /// May fail on existing data or convert values.
    Risky,
    /// Drops data.
    Destructive,
}

impl Risk {
    pub fn as_str(self) -> &'static str {
        match self {
            Risk::Safe => "safe",
            Risk::Risky => "risky",
            Risk::Destructive => "destructive",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    RenameTable {
        from: String,
        to: String,
    },
    RenameColumn {
        table: String,
        from: String,
        to: String,
    },
    DropIndex {
        table: String,
        index: Index,
    },
    CreateTable {
        table: Table,
    },
    AddColumn {
        table: String,
        column: Column,
    },
    AlterColumn {
        table: String,
        from: Column,
        to: Column,
    },
    DropColumn {
        table: String,
        column: Column,
    },
    DropTable {
        table: Table,
    },
    CreateIndex {
        table: String,
        index: Index,
        new_table: bool,
    },
    /// SQLite only: recreate a table to apply column changes it cannot `ALTER`.
    RebuildTable {
        from: Table,
        to: Table,
    },
}

impl Change {
    pub fn risk(&self) -> Risk {
        match self {
            Change::RenameTable { .. }
            | Change::RenameColumn { .. }
            | Change::DropIndex { .. }
            | Change::CreateTable { .. } => Risk::Safe,
            Change::AddColumn { column, .. } => {
                if column.nullable || column.default.is_some() {
                    Risk::Safe
                } else {
                    Risk::Risky
                }
            }
            Change::AlterColumn { from, to, .. } => {
                let relaxes_only = from.ty == to.ty && to.nullable && from.default == to.default;
                if relaxes_only { Risk::Safe } else { Risk::Risky }
            }
            Change::CreateIndex { index, new_table, .. } => {
                if index.unique && !new_table {
                    Risk::Risky
                } else {
                    Risk::Safe
                }
            }
            Change::DropColumn { .. } | Change::DropTable { .. } => Risk::Destructive,
            Change::RebuildTable { from, to } => {
                let dropped = from.columns.iter().any(|column| to.column(&column.name).is_none());
                if dropped { Risk::Destructive } else { Risk::Risky }
            }
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Change::RenameTable { from, to } => format!("rename table {from} to {to}"),
            Change::RenameColumn { table, from, to } => {
                format!("rename column {table}.{from} to {to}")
            }
            Change::DropIndex { index, .. } => format!("drop index {}", index.name),
            Change::CreateTable { table } => format!("create table {}", table.name),
            Change::AddColumn { table, column } => format!("add column {table}.{}", column.name),
            Change::AlterColumn { table, to, .. } => format!("alter column {table}.{}", to.name),
            Change::DropColumn { table, column } => format!("drop column {table}.{}", column.name),
            Change::DropTable { table } => format!("drop table {}", table.name),
            Change::CreateIndex { index, .. } => {
                format!("create {}index {}", if index.unique { "unique " } else { "" }, index.name)
            }
            Change::RebuildTable { to, .. } => format!("rebuild table {}", to.name),
        }
    }
}

pub struct Diff {
    pub changes: Vec<Change>,
    /// The old model with renames applied: the state right before non-rename changes.
    pub renamed: DbModel,
    /// Likely renames, as CLI arguments (e.g. `--rename-column articles.title=headline`).
    pub hints: Vec<String>,
}

pub fn diff(old: &DbModel, new: &DbModel, renames: &Renames) -> Result<Diff, MigrateError> {
    let mut renamed = old.clone();
    let mut rename_changes = Vec::new();

    for (from, to) in &renames.tables {
        if !old.tables.contains_key(from) {
            return Err(MigrateError::InvalidRename(format!("table `{from}` does not exist")));
        }
        if !new.tables.contains_key(to) || old.tables.contains_key(to) {
            return Err(MigrateError::InvalidRename(format!(
                "table `{to}` must exist in the schema and not yet in the database"
            )));
        }
        let mut table = renamed.tables.remove(from).expect("checked");
        table.name.clone_from(to);
        renamed.tables.insert(to.clone(), table);
        rename_changes.push(Change::RenameTable { from: from.clone(), to: to.clone() });
    }

    for ((table_name, from), to) in &renames.columns {
        let (Some(table), Some(target)) =
            (renamed.tables.get_mut(table_name), new.tables.get(table_name))
        else {
            return Err(MigrateError::InvalidRename(format!(
                "table `{table_name}` must exist both in the database and in the schema"
            )));
        };
        if table.column(from).is_none() {
            return Err(MigrateError::InvalidRename(format!(
                "column `{table_name}.{from}` does not exist"
            )));
        }
        if table.column(to).is_some() || target.column(to).is_none() {
            return Err(MigrateError::InvalidRename(format!(
                "column `{table_name}.{to}` must exist in the schema and not yet in the database"
            )));
        }
        for column in &mut table.columns {
            if column.name == *from {
                column.name.clone_from(to);
            }
        }
        // Databases update index definitions on column rename; mirror that.
        for index in &mut table.indexes {
            for column in &mut index.columns {
                if column == from {
                    column.clone_from(to);
                }
            }
        }
        rename_changes.push(Change::RenameColumn {
            table: table_name.clone(),
            from: from.clone(),
            to: to.clone(),
        });
    }

    let mut drop_indexes = Vec::new();
    let mut create_tables = Vec::new();
    let mut add_columns = Vec::new();
    let mut alter_columns = Vec::new();
    let mut drop_columns = Vec::new();
    let mut drop_tables = Vec::new();
    let mut create_indexes = Vec::new();

    for (name, table) in &new.tables {
        let Some(current) = renamed.tables.get(name) else {
            create_tables.push(Change::CreateTable {
                table: Table { indexes: Vec::new(), ..table.clone() },
            });
            for index in &table.indexes {
                create_indexes.push(Change::CreateIndex {
                    table: name.clone(),
                    index: index.clone(),
                    new_table: true,
                });
            }
            continue;
        };

        for index in &current.indexes {
            if table.index(&index.name) != Some(index) {
                drop_indexes.push(Change::DropIndex { table: name.clone(), index: index.clone() });
            }
        }
        for index in &table.indexes {
            if current.index(&index.name) != Some(index) {
                create_indexes.push(Change::CreateIndex {
                    table: name.clone(),
                    index: index.clone(),
                    new_table: false,
                });
            }
        }
        for column in &table.columns {
            match current.column(&column.name) {
                None => add_columns
                    .push(Change::AddColumn { table: name.clone(), column: column.clone() }),
                Some(existing) if existing != column => alter_columns.push(Change::AlterColumn {
                    table: name.clone(),
                    from: existing.clone(),
                    to: column.clone(),
                }),
                Some(_) => {}
            }
        }
        for column in &current.columns {
            if table.column(&column.name).is_none() {
                drop_columns
                    .push(Change::DropColumn { table: name.clone(), column: column.clone() });
            }
        }
    }
    for (name, table) in &renamed.tables {
        if !new.tables.contains_key(name) {
            drop_tables.push(Change::DropTable { table: table.clone() });
        }
    }

    let hints = rename_hints(&add_columns, &drop_columns, &create_tables, &drop_tables);

    let changes = [
        rename_changes,
        drop_indexes,
        create_tables,
        add_columns,
        alter_columns,
        drop_columns,
        drop_tables,
        create_indexes,
    ]
    .concat();
    Ok(Diff { changes, renamed, hints })
}

fn rename_hints(
    add_columns: &[Change],
    drop_columns: &[Change],
    create_tables: &[Change],
    drop_tables: &[Change],
) -> Vec<String> {
    let mut hints = Vec::new();
    for dropped in drop_columns {
        let Change::DropColumn { table, column: old } = dropped else { continue };
        for added in add_columns {
            if let Change::AddColumn { table: added_table, column: new } = added
                && added_table == table
                && new.ty == old.ty
            {
                hints.push(format!("--rename-column {table}.{}={}", old.name, new.name));
            }
        }
    }
    for dropped in drop_tables {
        let Change::DropTable { table: old } = dropped else { continue };
        let old_columns: Vec<_> = old.columns.iter().map(|column| &column.name).collect();
        for created in create_tables {
            if let Change::CreateTable { table: new } = created
                && new.columns.iter().map(|column| &column.name).eq(old_columns.iter().copied())
            {
                hints.push(format!("--rename-table {}={}", old.name, new.name));
            }
        }
    }
    hints
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ColumnType;

    fn table(
        name: &str,
        columns: &[(&str, ColumnType)],
        indexes: &[(&str, &[&str], bool)],
    ) -> Table {
        Table {
            name: name.into(),
            columns: std::iter::once(Column::new("id", ColumnType::Id).not_null())
                .chain(columns.iter().map(|(name, ty)| Column::new(*name, *ty)))
                .collect(),
            indexes: indexes
                .iter()
                .map(|(name, columns, unique)| Index {
                    name: (*name).into(),
                    columns: columns.iter().map(|column| (*column).into()).collect(),
                    unique: *unique,
                })
                .collect(),
        }
    }

    fn model(tables: Vec<Table>) -> DbModel {
        DbModel { tables: tables.into_iter().map(|table| (table.name.clone(), table)).collect() }
    }

    fn described(diff: &Diff) -> Vec<String> {
        diff.changes.iter().map(Change::describe).collect()
    }

    const TEXT: ColumnType = ColumnType::Text;
    const INT: ColumnType = ColumnType::Integer;

    #[test]
    fn empty_to_model_creates_tables_then_indexes() {
        let new = model(vec![table("a", &[("x", TEXT)], &[("a_x_idx", &["x"], false)])]);
        let diff = diff(&DbModel::default(), &new, &Renames::default()).unwrap();
        assert_eq!(described(&diff), ["create table a", "create index a_x_idx"]);
        assert!(diff.changes.iter().all(|change| change.risk() == Risk::Safe));
    }

    #[test]
    fn identical_models_have_no_changes() {
        let m = model(vec![table("a", &[("x", TEXT)], &[])]);
        assert!(diff(&m, &m, &Renames::default()).unwrap().changes.is_empty());
    }

    #[test]
    fn orders_changes_and_classifies_risk() {
        let old = model(vec![
            table("a", &[("x", TEXT), ("gone", INT)], &[("a_gone_uq", &["gone"], true)]),
            table("old", &[("y", TEXT)], &[]),
        ]);
        let new = model(vec![
            table("a", &[("x", INT), ("added", TEXT)], &[("a_x_uq", &["x"], true)]),
            table("b", &[("z", TEXT)], &[]),
        ]);
        let diff = diff(&old, &new, &Renames::default()).unwrap();
        let risks: Vec<_> =
            diff.changes.iter().map(|change| (change.describe(), change.risk())).collect();
        assert_eq!(
            risks,
            [
                ("drop index a_gone_uq".to_string(), Risk::Safe),
                ("create table b".into(), Risk::Safe),
                ("add column a.added".into(), Risk::Safe),
                ("alter column a.x".into(), Risk::Risky),
                ("drop column a.gone".into(), Risk::Destructive),
                ("drop table old".into(), Risk::Destructive),
                ("create unique index a_x_uq".into(), Risk::Risky),
            ]
        );
    }

    #[test]
    fn hints_likely_renames() {
        let old =
            model(vec![table("a", &[("title", TEXT)], &[]), table("posts", &[("x", TEXT)], &[])]);
        let new = model(vec![
            table("a", &[("headline", TEXT)], &[]),
            table("articles", &[("x", TEXT)], &[]),
        ]);
        let diff = diff(&old, &new, &Renames::default()).unwrap();
        assert_eq!(
            diff.hints,
            ["--rename-column a.title=headline", "--rename-table posts=articles"]
        );
    }

    #[test]
    fn applies_explicit_renames() {
        let old = model(vec![table(
            "posts",
            &[("title", TEXT)],
            &[("posts_title_idx", &["title"], false)],
        )]);
        let new = model(vec![table(
            "articles",
            &[("headline", TEXT)],
            &[("articles_headline_idx", &["headline"], false)],
        )]);
        let mut renames = Renames::default();
        renames.add_table("posts=articles").unwrap();
        renames.add_column("articles.title=headline").unwrap();

        let diff = diff(&old, &new, &renames).unwrap();
        assert_eq!(
            described(&diff),
            [
                "rename table posts to articles",
                "rename column articles.title to headline",
                "drop index posts_title_idx",
                "create index articles_headline_idx",
            ]
        );
        assert!(diff.hints.is_empty());
        assert_eq!(diff.renamed.tables["articles"].indexes[0].columns, ["headline"]);
    }

    #[test]
    fn rejects_invalid_renames() {
        let old = model(vec![table("a", &[("x", TEXT)], &[])]);
        let new = model(vec![table("a", &[("y", TEXT)], &[])]);
        for spec in ["a.nope=y", "a.x=nope", "missing.x=y"] {
            let mut renames = Renames::default();
            renames.add_column(spec).unwrap();
            assert!(
                matches!(diff(&old, &new, &renames), Err(MigrateError::InvalidRename(_))),
                "{spec}"
            );
        }
        let mut renames = Renames::default();
        assert!(renames.add_column("x=y").is_err());
        assert!(renames.add_table("a.b=c").is_err());
        renames.add_table("nope=a").unwrap();
        assert!(diff(&old, &new, &renames).is_err());
    }
}
