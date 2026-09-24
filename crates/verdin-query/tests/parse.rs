use serde_json::json;
use verdin_db::{ColumnKind, SqlValue};
use verdin_query::*;
use verdin_schema::{Schema, Source};

fn fields() -> TypeFields {
    let schema = Schema::parse(&[
        Source::content_type(
            "article",
            json!({
                "kind": "collectionType", "singularName": "article", "pluralName": "articles", "displayName": "Article",
                "attributes": {
                    "title": { "type": "string" },
                    "views": { "type": "integer" },
                    "rating": { "type": "decimal" },
                    "featured": { "type": "boolean" },
                    "publishOn": { "type": "date" },
                    "meta": { "type": "json" },
                    "secret": { "type": "string", "private": true },
                    "seo": { "type": "component", "component": "shared.seo" },
                    "author": { "type": "relation", "relation": "oneWay", "target": "article" }
                }
            })
            .to_string(),
        ),
        Source::component("shared", "seo", json!({ "displayName": "SEO", "attributes": { "metaTitle": { "type": "string" } } }).to_string()),
    ])
    .unwrap();
    TypeFields::new(schema.content_type("api::article").unwrap())
}

fn query(raw: &str) -> Result<Query, QueryError> {
    parse_request(Some(raw), &fields(), &Limits::default())
}

fn error(raw: &str) -> String {
    query(raw).unwrap_err().message
}

#[test]
fn defaults() {
    let q = query("").unwrap();
    assert_eq!(q.filters, None);
    assert_eq!(q.status, Status::Published);
    assert_eq!(
        q.pagination,
        Pagination { mode: PageMode::Page { page: 1, page_size: 25 }, with_count: true }
    );
}

#[test]
fn typed_filters() {
    let q =
        query("filters[views][$gte]=10&filters[title]=Hello&filters[featured][$eq]=true").unwrap();
    let Some(Filter::And(conditions)) = q.filters else { panic!() };
    let conditions: Vec<_> = conditions
        .into_iter()
        .map(|filter| match filter {
            Filter::Condition(condition) => (condition.column, condition.op, condition.operand),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        conditions,
        [
            ("views".into(), Op::Gte, Operand::Value(SqlValue::Int(10))),
            ("title".into(), Op::Eq, Operand::Value(SqlValue::Text("Hello".into()))),
            ("featured".into(), Op::Eq, Operand::Value(SqlValue::Bool(true))),
        ]
    );
}

#[test]
fn logical_and_list_operators() {
    let q = query("filters[$or][0][views][$in][0]=1&filters[$or][0][views][$in][1]=2&filters[$or][1][$not][title][$null]=true&filters[publishOn][$between][0]=2026-01-01&filters[publishOn][$between][1]=2026-12-31").unwrap();
    let Some(Filter::And(parts)) = q.filters else { panic!() };
    let Filter::Or(branches) = &parts[0] else { panic!() };
    assert!(
        matches!(&branches[0], Filter::Condition(Condition { op: Op::In, operand: Operand::List(values), .. }) if values.len() == 2)
    );
    assert!(
        matches!(&branches[1], Filter::Not(inner) if matches!(**inner, Filter::Condition(Condition { op: Op::IsNull, .. })))
    );
    assert!(matches!(
        &parts[1],
        Filter::Condition(Condition { op: Op::Between, kind: ColumnKind::Date, .. })
    ));

    let q = query("filters[title][$null]=false").unwrap();
    assert!(matches!(q.filters, Some(Filter::Condition(Condition { op: Op::IsNotNull, .. }))));
}

#[test]
fn rejects_invalid_filters() {
    assert!(error("filters[nope][$eq]=1").contains("invalid key `nope`"));
    assert!(
        error("filters[secret][$eq]=1").contains("invalid key `secret`"),
        "private fields are not filterable"
    );
    assert!(error("filters[views][$eq]=abc").contains("expects an integer"));
    assert!(error("filters[views][$containsi]=1").contains("cannot be used"));
    assert!(error("filters[meta][$eq]=1").contains("cannot be used"));
    assert!(query("filters[meta][$null]=true").is_ok());
    assert!(error("filters[views][$like]=1").contains("invalid filter operator"));
    assert!(error("filters[seo][metaTitle][$eq]=x").contains("not supported yet"));
    assert!(error("filters[publishOn][$between]=2026-01-01").contains("two values"));
    assert!(error("filters[$eq]=1").contains("top level"));
}

#[test]
fn sort_fields_populate() {
    let q = query("sort=title:desc,views&sort[1]=createdAt").unwrap();
    assert_eq!(
        q.sort,
        [
            Sort { column: "title".into(), descending: true },
            Sort { column: "views".into(), descending: false },
            Sort { column: "created_at".into(), descending: false },
        ]
    );
    assert!(error("sort=meta").contains("cannot sort"));
    assert!(error("sort=title:up").contains("invalid sort direction"));

    assert_eq!(
        query("fields[0]=title&fields[1]=views").unwrap().fields,
        Some(vec!["title".into(), "views".into()])
    );
    assert_eq!(
        query("fields=title,createdAt").unwrap().fields,
        Some(vec!["title".into(), "createdAt".into()])
    );
    assert!(error("fields=seo").contains("invalid key `seo` in fields"));

    assert_eq!(query("populate=*").unwrap().populate, ["seo"]);
    assert_eq!(query("populate[seo][fields][0]=metaTitle").unwrap().populate, ["seo"]);
    assert_eq!(query("populate[0]=seo").unwrap().populate, ["seo"]);
    assert!(error("populate=author").contains("not supported yet"));
    assert!(error("populate=title").contains("invalid key"));
}

#[test]
fn pagination_and_status() {
    let limits = Limits::default();
    let q = query("pagination[page]=3&pagination[pageSize]=500").unwrap();
    assert_eq!(q.pagination.mode, PageMode::Page { page: 3, page_size: limits.max_page_size });
    assert_eq!(q.pagination.offset(), 200);

    let q = query("pagination[start]=5&pagination[limit]=-1&pagination[withCount]=false").unwrap();
    assert_eq!(
        q.pagination,
        Pagination { mode: PageMode::Offset { start: 5, limit: 100 }, with_count: false }
    );

    assert!(error("pagination[page]=0").contains("≥ 1"));
    assert!(error("pagination[page]=1&pagination[limit]=2").contains("either"));
    assert_eq!(query("status=draft").unwrap().status, Status::Draft);
    assert!(error("status=archived").contains("status"));
    assert!(error("include=all").contains("invalid query parameter `include`"));
}
