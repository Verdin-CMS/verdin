//! Applies migrations against `VERDIN_TEST_DATABASE_URL` (in-memory SQLite by default).
//! Every test gets a database of its own.

mod common;

use common::{TestDb, content_type, model};
use serde_json::json;
use verdin_migrate::{
    ApplyOptions, ApplyReport, DbModel, MigrateError, Renames, Risk, Status, apply, status,
};

const SAFE: ApplyOptions = ApplyOptions { allow: Risk::Safe };
const RISKY: ApplyOptions = ApplyOptions { allow: Risk::Risky };
const ALL: ApplyOptions = ApplyOptions { allow: Risk::Destructive };

fn articles(attributes: serde_json::Value) -> DbModel {
    model(&[content_type("article", "articles", attributes)])
}

async fn assert_up_to_date(test: &TestDb, desired: &DbModel) {
    let status = status(&test.db, desired, &Renames::default()).await.unwrap();
    assert!(matches!(status, Status::UpToDate), "expected up to date, got {status:?}");
}

#[tokio::test]
async fn full_lifecycle_preserves_data() {
    let test = TestDb::new().await;
    let none = Renames::default();

    // v1: create
    let v1 = articles(
        json!({ "title": { "type": "string" }, "views": { "type": "integer" }, "flag": { "type": "boolean" } }),
    );
    assert!(matches!(status(&test.db, &v1, &none).await.unwrap(), Status::Pending(_)));
    let report = apply(&test.db, &v1, &none, SAFE).await.unwrap();
    assert!(report.applied_steps > 0);
    assert_up_to_date(&test, &v1).await;
    test.insert("articles", "01J0000000000000000000000A", &[("title", "Hello")]).await;
    test.insert("articles", "01J0000000000000000000000B", &[("title", "World")]).await;

    // v2: add a column and a table, widen a type (risky), make a field unique (risky)
    let v2 = model(&[
        content_type(
            "article",
            "articles",
            json!({
                "title": { "type": "string", "unique": true },
                "views": { "type": "biginteger" },
                "flag": { "type": "boolean" },
                "body": { "type": "text" }
            }),
        ),
        content_type("tag", "tags", json!({ "label": { "type": "string" } })),
    ]);
    let error = apply(&test.db, &v2, &none, SAFE).await.unwrap_err();
    assert!(matches!(error, MigrateError::NeedsApproval { .. }), "{error}");
    assert_up_to_date(&test, &v1).await;
    apply(&test.db, &v2, &none, RISKY).await.unwrap();
    assert_up_to_date(&test, &v2).await;
    assert_eq!(test.count("tags").await, 0);
    test.insert("articles", "01J0000000000000000000000C", &[("title", "New"), ("body", "text")])
        .await;

    // v3: rename a column (explicit), drop a column (destructive)
    let v3 = articles(json!({
        "headline": { "type": "string", "unique": true },
        "views": { "type": "biginteger" },
        "body": { "type": "text" }
    }));
    let mut renames = Renames::default();
    renames.add_column("articles.title=headline").unwrap();
    let error = apply(&test.db, &v3, &renames, RISKY).await.unwrap_err();
    assert!(
        matches!(error, MigrateError::NeedsApproval { .. }),
        "dropping flag and tags is destructive"
    );
    apply(&test.db, &v3, &renames, ALL).await.unwrap();
    assert_up_to_date(&test, &v3).await;

    let mut headlines = test.texts("SELECT headline FROM articles ORDER BY id").await;
    headlines.sort();
    assert_eq!(headlines, [Some("Hello".into()), Some("New".into()), Some("World".into())]);

    // v4: drop everything
    apply(&test.db, &DbModel::default(), &Renames::default(), ALL).await.unwrap();
    assert_up_to_date(&test, &DbModel::default()).await;

    test.drop().await;
}

#[tokio::test]
async fn unique_precheck_blocks_before_any_change() {
    let test = TestDb::new().await;
    let none = Renames::default();
    let v1 = articles(json!({ "title": { "type": "string" } }));
    apply(&test.db, &v1, &none, SAFE).await.unwrap();
    test.insert("articles", "01J0000000000000000000000A", &[("title", "Same")]).await;
    test.insert("articles", "01J0000000000000000000000B", &[("title", "Same")]).await;

    let v2 = articles(
        json!({ "title": { "type": "string", "unique": true }, "body": { "type": "text" } }),
    );
    let error = apply(&test.db, &v2, &none, RISKY).await.unwrap_err();
    assert!(
        matches!(&error, MigrateError::PrecheckFailed { reason, .. } if reason.contains("duplicate")),
        "{error}"
    );
    // Nothing ran: the `body` column (an earlier, safe step) was not added.
    assert!(matches!(status(&test.db, &v1, &none).await.unwrap(), Status::UpToDate));

    test.exec("DELETE FROM articles WHERE document_id = ?", &["01J0000000000000000000000B".into()])
        .await;
    apply(&test.db, &v2, &none, RISKY).await.unwrap();
    assert_up_to_date(&test, &v2).await;

    test.drop().await;
}

/// Simulates drift: a table the plan wants to create already exists, so a step fails
/// mid-plan. Transactional dialects roll everything back; MySQL/MariaDB keep the steps
/// already committed and resume from the failed one once the cause is fixed.
#[tokio::test]
async fn failure_mid_plan_rolls_back_or_resumes() {
    let test = TestDb::new().await;
    let none = Renames::default();
    let desired = model(&[
        content_type("article", "articles", json!({ "title": { "type": "string" } })),
        content_type("tag", "tags", json!({ "label": { "type": "string" } })),
    ]);
    test.exec("CREATE TABLE tags (id integer)", &[]).await;

    let error = apply(&test.db, &desired, &none, SAFE).await.unwrap_err();
    let MigrateError::StepFailed { index, step, .. } = &error else { panic!("{error}") };
    assert_eq!(step, "create table tags");
    assert_eq!(*index, 1, "articles is created first");

    let current = status(&test.db, &desired, &none).await.unwrap();
    if test.flavor().transactional_ddl() {
        assert!(matches!(current, Status::Pending(_)), "{current:?}");
        assert!(!test.table_exists("articles").await, "creating articles was rolled back");
    } else {
        let Status::Interrupted { done, error, .. } = current else { panic!("{current:?}") };
        assert_eq!(done, 1);
        assert!(error.is_some_and(|message| message.contains("tags")));

        // A different schema cannot silently take over a half-applied plan.
        let other =
            model(&[content_type("article", "articles", json!({ "title": { "type": "text" } }))]);
        let mismatch = apply(&test.db, &other, &none, ALL).await.unwrap_err();
        assert!(
            matches!(mismatch, MigrateError::InterruptedPlanMismatch { done: 1 }),
            "{mismatch}"
        );
    }

    test.exec("DROP TABLE tags", &[]).await;
    let report = apply(&test.db, &desired, &none, SAFE).await.unwrap();
    if test.flavor().transactional_ddl() {
        assert_eq!(report.resumed_from, None);
    } else {
        assert_eq!(report.resumed_from, Some(1), "{report:?}");
        assert!(report.applied_steps < 8, "steps before the failure are not re-run: {report:?}");
    }
    assert_up_to_date(&test, &desired).await;
    assert_eq!(test.count("articles").await, 0);

    test.drop().await;
}

#[tokio::test]
async fn noop_apply_reports_nothing() {
    let test = TestDb::new().await;
    let report = apply(&test.db, &DbModel::default(), &Renames::default(), SAFE).await.unwrap();
    assert_eq!(report, ApplyReport { applied_steps: 0, resumed_from: None });
    test.drop().await;
}

/// Link rows follow their source row (ON DELETE CASCADE) and survive schema changes to
/// the source table, including SQLite table rebuilds.
#[tokio::test]
async fn link_tables_cascade_and_survive_rebuilds() {
    let test = TestDb::new().await;
    let none = Renames::default();
    let schema = |views: &str| {
        model(&[
            content_type(
                "article",
                "articles",
                json!({ "title": { "type": "string" }, "views": { "type": views }, "tags": { "type": "relation", "relation": "manyWay", "target": "tag" } }),
            ),
            content_type("tag", "tags", json!({ "label": { "type": "string" } })),
        ])
    };
    apply(&test.db, &schema("integer"), &none, SAFE).await.unwrap();
    test.insert("articles", "01J0000000000000000000000A", &[("title", "A")]).await;
    test.insert("articles", "01J0000000000000000000000B", &[("title", "B")]).await;
    let link = "INSERT INTO articles_tags_lnk (source_id, target_document_id, position) SELECT id, ?, 1 FROM articles";
    test.exec(link, &["01J00000000000000000000TAG".into()]).await;
    assert_eq!(test.count("articles_tags_lnk").await, 2);

    // A type change: a rebuild on SQLite, ALTER elsewhere. Links must survive.
    apply(&test.db, &schema("string"), &none, RISKY).await.unwrap();
    assert_up_to_date(&test, &schema("string")).await;
    assert_eq!(test.count("articles_tags_lnk").await, 2);

    test.exec("DELETE FROM articles WHERE document_id = ?", &["01J0000000000000000000000A".into()])
        .await;
    assert_eq!(test.count("articles_tags_lnk").await, 1, "links cascade with their source row");

    apply(&test.db, &DbModel::default(), &none, ALL).await.unwrap();
    assert!(!test.table_exists("articles_tags_lnk").await);
    test.drop().await;
}
