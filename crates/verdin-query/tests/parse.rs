use serde_json::json;
use verdin_db::{ColumnKind, SqlValue};
use verdin_query::*;
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[
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
                    "author": { "type": "relation", "relation": "oneWay", "target": "article" },
                    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" }
                }
            })
            .to_string(),
        ),
        Source::content_type(
            "category",
            json!({
                "kind": "collectionType", "singularName": "category", "pluralName": "categories", "displayName": "Category",
                "options": { "draftAndPublish": true },
                "attributes": {
                    "name": { "type": "string" },
                    "articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
                }
            })
            .to_string(),
        ),
        Source::component("shared", "seo", json!({ "displayName": "SEO", "attributes": { "metaTitle": { "type": "string" } } }).to_string()),
    ])
    .unwrap()
}

fn query_on(uid: &str, raw: &str) -> Result<Query, QueryError> {
    let catalog = Catalog::new(&schema());
    parse_request(Some(raw), catalog.get(uid).unwrap(), &catalog, &Limits::default())
}

fn query(raw: &str) -> Result<Query, QueryError> {
    query_on("api::article", raw)
}

fn populated(query: &Query) -> Vec<&str> {
    query.populate.iter().map(|populate| populate.field.as_str()).collect()
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
    assert!(
        query("filters[seo][metaTitle][$eq]=x").is_ok(),
        "non-repeatable component fields are filterable"
    );
    assert!(error("filters[category]=x").contains("filter `category` by its fields"));
    assert!(error("filters[category][nope][$eq]=x").contains("invalid key `nope`"));
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

    assert_eq!(populated(&query("populate=*").unwrap()), ["seo", "author", "category"]);
    assert_eq!(populated(&query("populate[seo][fields][0]=metaTitle").unwrap()), ["seo"]);
    assert_eq!(populated(&query("populate[0]=seo").unwrap()), ["seo"]);
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

#[test]
fn relation_filters() {
    let q = query("filters[category][name][$eq]=News").unwrap();
    let Some(Filter::Relation(relation)) = q.filters else { panic!() };
    assert_eq!(relation.link_table, "articles_category_lnk");
    assert!(relation.owner && !relation.negate && relation.target_draft_and_publish);
    assert!(
        matches!(relation.inner.as_deref(), Some(Filter::Condition(Condition { column, .. })) if column == "name")
    );

    let q = query("filters[category][$null]=true").unwrap();
    assert!(matches!(
        q.filters,
        Some(Filter::Relation(RelationFilter { negate: true, inner: None, .. }))
    ));

    // The inverse side filters through the owner's link table.
    let q = query_on("api::category", "filters[articles][title][$containsi]=rust").unwrap();
    let Some(Filter::Relation(relation)) = q.filters else { panic!() };
    assert_eq!(relation.link_table, "articles_category_lnk");
    assert!(!relation.owner);
    assert_eq!(relation.target_table, "articles");

    // Nested relations.
    assert!(query("filters[category][articles][author][title][$eq]=x").is_ok());
}

#[test]
fn nested_populate() {
    let q = query("populate[category][fields][0]=name&populate[category][populate][articles][sort]=title:desc&populate[category][filters][name][$ne]=x").unwrap();
    let populate = &q.populate[0];
    assert_eq!(populate.field, "category");
    let sub = populate.query.as_ref().unwrap();
    assert_eq!(sub.fields, Some(vec!["name".into()]));
    assert!(sub.filters.is_some());
    assert_eq!(sub.populate[0].field, "articles");
    assert_eq!(
        sub.populate[0].query.as_ref().unwrap().sort,
        [Sort { column: "title".into(), descending: true }]
    );

    assert!(error("populate[category][limit]=1").contains("invalid key `limit`"));
    let deep = "populate[category][populate][articles][populate][category][populate][articles][populate][category][populate][articles]=true";
    assert!(error(deep).contains("deeper than"));
}
