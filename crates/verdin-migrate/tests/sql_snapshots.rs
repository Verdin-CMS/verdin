//! Rendered DDL per dialect, reviewed through insta snapshots.

mod common;

use common::{content_type, model};
use serde_json::json;
use verdin_db::Flavor;
use verdin_migrate::{DbModel, Plan, Renames, Risk, build_plan};

const FLAVORS: [Flavor; 4] = [Flavor::Postgres, Flavor::MySql, Flavor::MariaDb, Flavor::Sqlite];

fn render(plan: &Plan) -> String {
    plan.steps
        .iter()
        .map(|step| {
            format!(
                "-- {} [{}]\n{};",
                step.description,
                step.risk.as_str(),
                step.statements.join(";\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn v1() -> DbModel {
    model(&[content_type(
        "article",
        "articles",
        json!({
            "title": { "type": "string", "required": true },
            "slug": { "type": "uid", "targetField": "title" },
            "body": { "type": "richtext" },
            "views": { "type": "integer" },
            "price": { "type": "decimal" },
            "featured": { "type": "boolean" },
            "publishOn": { "type": "date" },
            "seo": { "type": "json" }
        }),
    )])
}

fn v2() -> DbModel {
    model(&[
        content_type(
            "article",
            "articles",
            json!({
                "headline": { "type": "string", "required": true },
                "slug": { "type": "uid", "targetField": "headline" },
                "body": { "type": "richtext" },
                "views": { "type": "biginteger" },
                "price": { "type": "decimal" },
                "publishOn": { "type": "datetime" },
                "seo": { "type": "json" },
                "rating": { "type": "float", "unique": true }
            }),
        ),
        content_type("tag", "tags", json!({ "label": { "type": "string" } })),
    ])
}

#[test]
fn create_from_empty() {
    for flavor in FLAVORS {
        let plan = build_plan(&DbModel::default(), &v1(), &Renames::default(), flavor).unwrap();
        insta::assert_snapshot!(format!("create_{flavor}"), render(&plan));
    }
}

#[test]
fn evolve_schema() {
    let mut renames = Renames::default();
    renames.add_column("articles.title=headline").unwrap();
    for flavor in FLAVORS {
        let plan = build_plan(&v1(), &v2(), &renames, flavor).unwrap();
        insta::assert_snapshot!(format!("evolve_{flavor}"), render(&plan));
    }
}

#[test]
fn sqlite_rebuilds_tables_for_type_changes() {
    let v3 = model(&[content_type(
        "article",
        "articles",
        json!({
            "title": { "type": "string", "required": true },
            "slug": { "type": "uid", "targetField": "title" },
            "body": { "type": "richtext" },
            "views": { "type": "string" },
            "price": { "type": "decimal" },
            "publishOn": { "type": "date" },
            "seo": { "type": "json" },
            "summary": { "type": "text" }
        }),
    )]);
    let plan = build_plan(&v1(), &v3, &Renames::default(), Flavor::Sqlite).unwrap();
    insta::assert_snapshot!(render(&plan));
}

fn with_relations() -> DbModel {
    model(&[
        content_type(
            "article",
            "articles",
            json!({
                "title": { "type": "string" },
                "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
                "tags": { "type": "relation", "relation": "manyWay", "target": "tag" }
            }),
        ),
        content_type(
            "category",
            "categories",
            json!({ "articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" } }),
        ),
        content_type("tag", "tags", json!({ "label": { "type": "string" } })),
    ])
}

#[test]
fn link_tables() {
    let model = with_relations();
    let names: Vec<_> = model.tables.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        ["articles", "articles_category_lnk", "articles_tags_lnk", "categories", "tags"],
        "mappedBy sides have no table"
    );
    for flavor in [Flavor::Postgres, Flavor::MySql] {
        let plan = build_plan(&DbModel::default(), &model, &Renames::default(), flavor).unwrap();
        let rendered = render(&plan);
        let link = rendered
            .split("\n\n")
            .find(|step| step.contains("create table articles_category_lnk"))
            .unwrap();
        insta::assert_snapshot!(format!("link_table_{flavor}"), link);
        // Link tables are created after, and dropped before, the tables they reference.
        let order: Vec<_> = plan
            .steps
            .iter()
            .filter(|step| step.description.starts_with("create table"))
            .map(|step| step.description.clone())
            .collect();
        assert_eq!(order.last().unwrap(), "create table articles_tags_lnk");
        let drop = build_plan(&model, &DbModel::default(), &Renames::default(), flavor).unwrap();
        assert!(drop.steps[0].description.ends_with("_lnk"), "{:?}", drop.steps[0].description);
    }
}

#[test]
fn renaming_a_table_renames_its_link_tables() {
    let renamed = model(&[
        content_type(
            "post",
            "posts",
            json!({
                "title": { "type": "string" },
                "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "posts" },
                "tags": { "type": "relation", "relation": "manyWay", "target": "tag" }
            }),
        ),
        content_type(
            "category",
            "categories",
            json!({ "posts": { "type": "relation", "relation": "oneToMany", "target": "post", "mappedBy": "category" } }),
        ),
        content_type("tag", "tags", json!({ "label": { "type": "string" } })),
    ]);
    let mut renames = Renames::default();
    renames.add_table("articles=posts").unwrap();
    let plan = build_plan(&with_relations(), &renamed, &renames, Flavor::Postgres).unwrap();
    let destructive: Vec<_> = plan
        .steps
        .iter()
        .filter(|step| step.risk == Risk::Destructive)
        .map(|step| &step.description)
        .collect();
    assert!(destructive.is_empty(), "{destructive:?}");
    let renames: Vec<_> = plan
        .steps
        .iter()
        .filter(|step| step.description.starts_with("rename table"))
        .map(|step| step.description.as_str())
        .collect();
    assert_eq!(
        renames,
        [
            "rename table articles to posts",
            "rename table articles_category_lnk to posts_category_lnk",
            "rename table articles_tags_lnk to posts_tags_lnk"
        ]
    );
}
