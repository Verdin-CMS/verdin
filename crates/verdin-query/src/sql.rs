//! AST → SQL fragments per dialect (docs/architecture.md §9.3).
//!
//! Text semantics are aligned across engines: `$eq`/`$ne`/`$in` and the case-sensitive
//! pattern operators compare exactly (binary collation on MySQL/MariaDB, whose default
//! collations are case- and accent-insensitive); the `…i` operators are case-insensitive
//! (on SQLite only for ASCII). Sorting puts NULLs last in both directions.

use verdin_db::{Flavor, SqlValue};

use crate::ast::{Condition, Filter, Op, Operand, Sort};

const MYSQL_BINARY_COLLATION: &str = "utf8mb4_bin";
const LIKE_ESCAPE: char = '!';

/// SQL text with `?` placeholders and the matching parameters.
#[derive(Debug, Clone)]
pub struct SqlBuilder {
    pub flavor: Flavor,
    pub sql: String,
    pub params: Vec<SqlValue>,
}

impl SqlBuilder {
    pub fn new(flavor: Flavor) -> Self {
        Self { flavor, sql: String::new(), params: Vec::new() }
    }

    pub fn push(&mut self, sql: &str) -> &mut Self {
        self.sql.push_str(sql);
        self
    }

    pub fn param(&mut self, value: SqlValue) -> &mut Self {
        self.sql.push('?');
        self.params.push(value);
        self
    }

    pub fn ident(&mut self, identifier: &str) -> &mut Self {
        let quoted = self.flavor.quote(identifier);
        self.sql.push_str(&quoted);
        self
    }

    /// `"alias"."column"` or `"column"`.
    pub fn column(&mut self, alias: Option<&str>, column: &str) -> &mut Self {
        if let Some(alias) = alias {
            self.ident(alias).push(".");
        }
        self.ident(column)
    }

    fn param_list(&mut self, values: &[SqlValue]) {
        self.push("(");
        for (index, value) in values.iter().enumerate() {
            if index > 0 {
                self.push(", ");
            }
            self.param(value.clone());
        }
        self.push(")");
    }
}

pub fn write_filter(out: &mut SqlBuilder, filter: &Filter, alias: Option<&str>) {
    match filter {
        Filter::And(children) | Filter::Or(children) if children.is_empty() => {
            out.push(if matches!(filter, Filter::And(_)) { "1 = 1" } else { "1 = 0" });
        }
        Filter::And(children) | Filter::Or(children) => {
            let joiner = if matches!(filter, Filter::And(_)) { " AND " } else { " OR " };
            out.push("(");
            for (index, child) in children.iter().enumerate() {
                if index > 0 {
                    out.push(joiner);
                }
                write_filter(out, child, alias);
            }
            out.push(")");
        }
        Filter::Not(child) => {
            out.push("NOT (");
            write_filter(out, child, alias);
            out.push(")");
        }
        Filter::Condition(condition) => write_condition(out, condition, alias),
    }
}

fn write_condition(out: &mut SqlBuilder, condition: &Condition, alias: Option<&str>) {
    let mysql = out.flavor.is_mysql_family();
    let exact_text = mysql && condition.kind == verdin_db::ColumnKind::Text;
    let col = |out: &mut SqlBuilder| {
        out.column(alias, &condition.column);
    };

    match (&condition.operand, condition.op) {
        (Operand::None, Op::IsNull) => {
            col(out);
            out.push(" IS NULL");
        }
        (Operand::None, _) => {
            col(out);
            out.push(" IS NOT NULL");
        }
        (Operand::Value(value), Op::Eq) if exact_text => {
            // The first comparison can use the (case-insensitive) index; the second is exact.
            out.push("(");
            col(out);
            out.push(" = ").param(value.clone()).push(" AND ");
            col(out);
            out.push(" = ")
                .param(value.clone())
                .push(&format!(" COLLATE {MYSQL_BINARY_COLLATION})"));
        }
        (Operand::Value(value), Op::Ne) if exact_text => {
            col(out);
            out.push(" <> ")
                .param(value.clone())
                .push(&format!(" COLLATE {MYSQL_BINARY_COLLATION}"));
        }
        (Operand::Value(value), op @ (Op::Eq | Op::Ne | Op::Lt | Op::Lte | Op::Gt | Op::Gte)) => {
            let symbol = match op {
                Op::Eq => "=",
                Op::Ne => "<>",
                Op::Lt => "<",
                Op::Lte => "<=",
                Op::Gt => ">",
                _ => ">=",
            };
            col(out);
            out.push(&format!(" {symbol} ")).param(value.clone());
        }
        (Operand::Value(value), op @ (Op::Eqi | Op::Nei)) => {
            out.push("LOWER(");
            col(out);
            out.push(if op == Op::Eqi { ") = LOWER(" } else { ") <> LOWER(" });
            out.param(value.clone()).push(")");
        }
        (Operand::List(values), op @ (Op::In | Op::NotIn)) => {
            let negate = op == Op::NotIn;
            if values.is_empty() {
                out.push(if negate { "1 = 1" } else { "1 = 0" });
                return;
            }
            col(out);
            if exact_text {
                out.push(&format!(" COLLATE {MYSQL_BINARY_COLLATION}"));
            }
            out.push(if negate { " NOT IN " } else { " IN " });
            out.param_list(values);
        }
        (Operand::Pair(low, high), Op::Between) => {
            col(out);
            out.push(" BETWEEN ").param(low.clone()).push(" AND ").param(high.clone());
        }
        (Operand::Value(value), op) => write_pattern(out, condition, alias, value, op),
        (operand, op) => unreachable!("parser never builds {op:?} with {operand:?}"),
    }
}

/// `$contains`, `$startsWith`, `$endsWith` and their negated / case-insensitive forms.
fn write_pattern(
    out: &mut SqlBuilder,
    condition: &Condition,
    alias: Option<&str>,
    value: &SqlValue,
    op: Op,
) {
    let text = value.as_text().unwrap_or_default().to_owned();
    let negate = matches!(op, Op::NotContains | Op::NotContainsi);
    let insensitive =
        matches!(op, Op::Containsi | Op::NotContainsi | Op::StartsWithi | Op::EndsWithi);
    let (prefix, suffix) = match op {
        Op::StartsWith | Op::StartsWithi => ("", "%"),
        Op::EndsWith | Op::EndsWithi => ("%", ""),
        _ => ("%", "%"),
    };

    // Every non-null string contains, starts and ends with "".
    if text.is_empty() {
        if negate {
            out.push("1 = 0");
        } else {
            out.column(alias, &condition.column).push(" IS NOT NULL");
        }
        return;
    }
    if negate {
        out.push("NOT (");
    }

    if out.flavor == Flavor::Sqlite && !insensitive {
        // SQLite's LIKE ignores ASCII case; compare substrings instead.
        match op {
            Op::StartsWith => {
                out.push("substr(").column(alias, &condition.column).push(", 1, length(");
                out.param(SqlValue::Text(text.clone())).push(")) = ").param(SqlValue::Text(text));
            }
            Op::EndsWith => {
                out.push("substr(").column(alias, &condition.column).push(", -length(");
                out.param(SqlValue::Text(text.clone())).push(")) = ").param(SqlValue::Text(text));
            }
            _ => {
                out.push("instr(").column(alias, &condition.column).push(", ");
                out.param(SqlValue::Text(text)).push(") > 0");
            }
        }
    } else {
        let pattern = format!("{prefix}{}{suffix}", escape_like(&text));
        out.column(alias, &condition.column);
        let like = if out.flavor == Flavor::Postgres && insensitive { " ILIKE " } else { " LIKE " };
        out.push(like).param(SqlValue::Text(pattern));
        if out.flavor.is_mysql_family() && !insensitive {
            out.push(&format!(" COLLATE {MYSQL_BINARY_COLLATION}"));
        }
        out.push(&format!(" ESCAPE '{LIKE_ESCAPE}'"));
    }

    if negate {
        out.push(")");
    }
}

fn escape_like(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '%' | '_') || c == LIKE_ESCAPE {
            out.push(LIKE_ESCAPE);
        }
        out.push(c);
    }
    out
}

/// ` ORDER BY …`, always ending with `id` so that pagination is stable.
pub fn write_order_by(out: &mut SqlBuilder, sort: &[Sort], alias: Option<&str>) {
    out.push(" ORDER BY ");
    for item in sort {
        let direction = if item.descending { "DESC" } else { "ASC" };
        if out.flavor.is_mysql_family() {
            out.column(alias, &item.column).push(" IS NULL, ");
            out.column(alias, &item.column).push(&format!(" {direction}, "));
        } else {
            out.column(alias, &item.column).push(&format!(" {direction} NULLS LAST, "));
        }
    }
    let id_descending =
        sort.iter().find(|item| item.column == "id").is_some_and(|item| item.descending);
    if !sort.iter().any(|item| item.column == "id") || id_descending {
        out.column(alias, "id").push(if id_descending { " DESC" } else { " ASC" });
    } else {
        out.column(alias, "id").push(" ASC");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use verdin_db::ColumnKind;

    fn condition(op: Op, value: &str) -> Filter {
        Filter::Condition(Condition {
            column: "title".into(),
            kind: ColumnKind::Text,
            op,
            operand: Operand::Value(SqlValue::Text(value.into())),
        })
    }

    fn render(flavor: Flavor, filter: &Filter) -> (String, Vec<SqlValue>) {
        let mut out = SqlBuilder::new(flavor);
        write_filter(&mut out, filter, None);
        (out.sql, out.params)
    }

    #[test]
    fn exact_equality_on_mysql_text() {
        let (sql, params) = render(Flavor::MySql, &condition(Op::Eq, "a"));
        assert_eq!(sql, "(`title` = ? AND `title` = ? COLLATE utf8mb4_bin)");
        assert_eq!(params.len(), 2);
        assert_eq!(render(Flavor::Postgres, &condition(Op::Eq, "a")).0, "\"title\" = ?");
    }

    #[test]
    fn patterns_per_dialect() {
        assert_eq!(
            render(Flavor::Postgres, &condition(Op::Containsi, "50%")).0,
            "\"title\" ILIKE ? ESCAPE '!'"
        );
        assert_eq!(
            render(Flavor::Postgres, &condition(Op::Containsi, "50%_!")).1,
            [SqlValue::Text("%50!%!_!!%".into())]
        );
        assert_eq!(
            render(Flavor::MariaDb, &condition(Op::StartsWith, "a")).0,
            "`title` LIKE ? COLLATE utf8mb4_bin ESCAPE '!'"
        );
        assert_eq!(
            render(Flavor::Sqlite, &condition(Op::EndsWith, "a")).0,
            "substr(\"title\", -length(?)) = ?"
        );
        assert_eq!(
            render(Flavor::Sqlite, &condition(Op::NotContains, "a")).0,
            "NOT (instr(\"title\", ?) > 0)"
        );
        assert_eq!(render(Flavor::Sqlite, &condition(Op::Contains, "")).0, "\"title\" IS NOT NULL");
    }

    #[test]
    fn combinators() {
        let filter =
            Filter::Or(vec![condition(Op::Eq, "a"), Filter::Not(Box::new(condition(Op::Lt, "b")))]);
        assert_eq!(render(Flavor::Sqlite, &filter).0, "(\"title\" = ? OR NOT (\"title\" < ?))");
        assert_eq!(render(Flavor::Sqlite, &Filter::Or(vec![])).0, "1 = 0");
    }

    #[test]
    fn order_by_puts_nulls_last_and_ends_with_id() {
        let sort = [Sort { column: "title".into(), descending: true }];
        let mut out = SqlBuilder::new(Flavor::Postgres);
        write_order_by(&mut out, &sort, None);
        assert_eq!(out.sql, " ORDER BY \"title\" DESC NULLS LAST, \"id\" ASC");
        let mut out = SqlBuilder::new(Flavor::MySql);
        write_order_by(&mut out, &sort, None);
        assert_eq!(out.sql, " ORDER BY `title` IS NULL, `title` DESC, `id` ASC");
    }
}
