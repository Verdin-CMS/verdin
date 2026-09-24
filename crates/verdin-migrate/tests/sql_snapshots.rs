//! Rendered DDL per dialect, reviewed through insta snapshots.

mod common;

use common::{content_type, model};
use serde_json::json;
use verdin_db::Flavor;
use verdin_migrate::{DbModel, Plan, Renames, build_plan};

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
