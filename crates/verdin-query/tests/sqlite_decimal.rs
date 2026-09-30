//! `decimal` values are stored as text on SQLite; filters and sorts must still compare
//! them as numbers (top-level columns, component values and sorts through a relation).

use rust_decimal::Decimal;
use verdin_db::{ColumnKind, ConnectOptions, Database, Flavor, SqlValue};
use verdin_query::sql::{FilterContext, SqlBuilder, write_filter, write_order_by};
use verdin_query::{Condition, Filter, Op, Operand, Sort, SortVia, Status};

const PRICES: [i64; 5] = [10, 25, 8, 12, 6];

async fn database() -> Database {
    let db = Database::connect("sqlite::memory:", &ConnectOptions::default()).await.unwrap();
    for statement in [
        "CREATE TABLE products (id integer PRIMARY KEY, document_id text, price text, seo text)",
        "CREATE TABLE makers (id integer PRIMARY KEY, document_id text, locale text, \
         publication_state integer, rating text)",
        "CREATE TABLE products_maker_lnk (source_id integer, target_document_id text)",
    ] {
        db.queries().execute(statement, &[]).await.unwrap();
    }
    for (index, price) in PRICES.into_iter().enumerate() {
        let id = index as i64 + 1;
        // Bound as the service binds them: text on SQLite.
        let decimal = SqlValue::Decimal(Decimal::from(price));
        let seo = SqlValue::Text(format!("{{\"price\":{price}}}"));
        db.queries()
            .execute(
                "INSERT INTO products (id, document_id, price, seo) VALUES (?, ?, ?, ?)",
                &[SqlValue::BigInt(id), SqlValue::Text(format!("p{id}")), decimal.clone(), seo],
            )
            .await
            .unwrap();
        db.queries()
            .execute(
                "INSERT INTO makers (id, document_id, locale, publication_state, rating) \
                 VALUES (?, ?, '', 1, ?)",
                &[SqlValue::BigInt(id), SqlValue::Text(format!("m{id}")), decimal],
            )
            .await
            .unwrap();
        db.queries()
            .execute(
                "INSERT INTO products_maker_lnk (source_id, target_document_id) VALUES (?, ?)",
                &[SqlValue::BigInt(id), SqlValue::Text(format!("m{id}"))],
            )
            .await
            .unwrap();
    }
    db
}

/// Prices of the rows matching `filter`, in `sort` order.
async fn prices(db: &Database, filter: Option<Filter>, sort: &[Sort]) -> Vec<i64> {
    let context = FilterContext::new(Status::Published);
    let mut select = SqlBuilder::new(Flavor::Sqlite);
    select.push("SELECT t.price FROM products AS t WHERE ");
    match &filter {
        Some(filter) => write_filter(&mut select, filter, "t", context),
        None => {
            select.push("1 = 1");
        }
    }
    write_order_by(&mut select, sort, Some("t"), context);
    let rows = db.queries().fetch_all(&select.sql, &select.params, &[ColumnKind::Decimal]).await;
    rows.unwrap()
        .into_iter()
        .map(|row| match &row[0] {
            SqlValue::Decimal(value) => value.to_string().parse().unwrap(),
            other => panic!("not a decimal: {other:?}"),
        })
        .collect()
}

fn price(path: &[&str], op: Op, operand: Operand) -> Filter {
    let column = if path.is_empty() { "price" } else { "seo" };
    Filter::Condition(Condition {
        column: column.into(),
        path: path.iter().map(|segment| segment.to_string()).collect(),
        kind: ColumnKind::Decimal,
        op,
        operand,
    })
}

fn decimal(value: i64) -> SqlValue {
    SqlValue::Decimal(Decimal::from(value))
}

fn by_price(descending: bool) -> Sort {
    Sort { decimal: true, ..Sort::by("price", descending) }
}

#[tokio::test]
async fn top_level_decimals_sort_and_compare_as_numbers() {
    let db = database().await;
    assert_eq!(prices(&db, None, &[by_price(true)]).await, [25, 12, 10, 8, 6]);
    assert_eq!(prices(&db, None, &[by_price(false)]).await, [6, 8, 10, 12, 25]);

    let gt = price(&[], Op::Gt, Operand::Value(decimal(9)));
    assert_eq!(prices(&db, Some(gt), &[by_price(true)]).await, [25, 12, 10]);
    let lt = price(&[], Op::Lt, Operand::Value(decimal(100)));
    assert_eq!(prices(&db, Some(lt), &[by_price(true)]).await, [25, 12, 10, 8, 6]);
    let between = price(&[], Op::Between, Operand::Pair(decimal(8), decimal(12)));
    assert_eq!(prices(&db, Some(between), &[by_price(false)]).await, [8, 10, 12]);
    let lte = price(&[], Op::Lte, Operand::Value(decimal(10)));
    assert_eq!(prices(&db, Some(lte), &[by_price(false)]).await, [6, 8, 10]);

    // Equality is numeric too: `12.00` matches the stored `12`.
    let eq = price(&[], Op::Eq, Operand::Value(SqlValue::Decimal("12.00".parse().unwrap())));
    assert_eq!(prices(&db, Some(eq), &[]).await, [12]);
    let listed = price(&[], Op::In, Operand::List(vec![decimal(6), decimal(25)]));
    assert_eq!(prices(&db, Some(listed), &[by_price(false)]).await, [6, 25]);
    let not_null = price(&[], Op::IsNotNull, Operand::None);
    assert_eq!(prices(&db, Some(not_null), &[]).await.len(), 5);
    let null = price(&[], Op::IsNull, Operand::None);
    assert!(prices(&db, Some(null), &[]).await.is_empty());
}

#[tokio::test]
async fn component_decimals_compare_as_numbers() {
    let db = database().await;
    let gt = price(&["price"], Op::Gt, Operand::Value(decimal(9)));
    assert_eq!(prices(&db, Some(gt), &[by_price(true)]).await, [25, 12, 10]);
    let lt = price(&["price"], Op::Lt, Operand::Value(decimal(100)));
    assert_eq!(prices(&db, Some(lt), &[by_price(true)]).await, [25, 12, 10, 8, 6]);
    let eq = price(&["price"], Op::Eq, Operand::Value(decimal(8)));
    assert_eq!(prices(&db, Some(eq), &[]).await, [8]);
}

#[tokio::test]
async fn sorts_through_a_relation_compare_as_numbers() {
    let db = database().await;
    let via = SortVia {
        link_table: "products_maker_lnk".into(),
        owner: true,
        target_table: "makers".into(),
        target_draft_and_publish: false,
        target_localized: false,
    };
    let sort = Sort { via: Some(via), decimal: true, ..Sort::by("rating", true) };
    assert_eq!(prices(&db, None, &[sort]).await, [25, 12, 10, 8, 6]);
}

#[test]
fn only_sqlite_casts() {
    let filter = price(&[], Op::Gt, Operand::Value(decimal(9)));
    let render = |flavor| {
        let context = FilterContext::new(Status::Published);
        let mut out = SqlBuilder::new(flavor);
        write_filter(&mut out, &filter, "t", context);
        write_order_by(&mut out, &[by_price(true)], Some("t"), context);
        (out.sql, out.params)
    };
    let (sql, params) = render(Flavor::Sqlite);
    assert_eq!(
        sql,
        "CAST(\"t\".\"price\" AS REAL) > ? ORDER BY CAST(\"t\".\"price\" AS REAL) DESC NULLS LAST, \
         \"t\".\"id\" ASC"
    );
    assert_eq!(params, [SqlValue::Double(9.0)]);
    let (sql, params) = render(Flavor::Postgres);
    assert_eq!(
        sql,
        "\"t\".\"price\" > ? ORDER BY \"t\".\"price\" DESC NULLS LAST, \"t\".\"id\" ASC"
    );
    assert_eq!(params, [decimal(9)]);
}
