//! CSV and JSON import and export of one content type (admin).

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, attributes: Value| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural,
                    "displayName": name, "options": { "draftAndPublish": true }, "attributes": attributes })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct("category", "categories", json!({ "name": { "type": "string" } })),
        ct(
            "article",
            "articles",
            json!({
                "title": { "type": "string", "required": true },
                "views": { "type": "integer" },
                "featured": { "type": "boolean" },
                "category": { "type": "relation", "relation": "manyToOne", "target": "category" },
                "tags": { "type": "relation", "relation": "oneToMany", "target": "category" },
                "seo": { "type": "component", "component": "shared.seo" }
            }),
        ),
        Source::component(
            "shared",
            "seo",
            json!({
                "displayName": "SEO", "attributes": { "metaTitle": { "type": "string" } }
            })
            .to_string(),
        ),
    ])
    .unwrap()
}

#[tokio::test]
async fn export_and_import() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let call = |method: Method, uri: String, body: Option<Value>| {
        let (app, admin) = (&app, admin.clone());
        async move { app.call_as(method, &uri, body, As::Bearer(&admin)).await }
    };
    let id = |body: &Value| body["data"]["documentId"].as_str().unwrap().to_owned();
    let (_, rust) = app.post("/api/categories", json!({ "name": "Rust" })).await;
    let (_, web) = app.post("/api/categories", json!({ "name": "Web" })).await;
    let (rust, web) = (id(&rust), id(&web));
    let (status, first) = app
        .post(
            "/api/articles",
            json!({ "title": "=Hello, \"world\"", "views": 3, "featured": true, "category": rust,
                    "tags": [rust, web], "seo": { "metaTitle": "Hi" } }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let first = id(&first);
    app.post("/api/articles", json!({ "title": "Second", "views": 10 })).await;

    let (status, csv) = call(
        Method::GET,
        "/admin/api/content/api::article/export?format=csv&status=published&sort=title".into(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{csv}");
    let csv = csv.as_str().unwrap().to_owned();
    let lines: Vec<&str> = csv.lines().collect();
    assert_eq!(lines[0], "documentId,title,views,featured,category,tags,seo");
    assert_eq!(
        lines[1],
        format!(
            "{first},\"'=Hello, \"\"world\"\"\",3,true,{rust},{rust}|{web},\"{{\"\"id\"\":1,\"\"metaTitle\"\":\"\"Hi\"\"}}\""
        )
    );
    assert!(lines[2].contains(",Second,10,,,,"), "{}", lines[2]);

    let (_, json_export) = call(
        Method::GET,
        "/admin/api/content/api::article/export?format=json&status=published&filters[views][$gt]=5"
            .into(),
        None,
    )
    .await;
    let items = json_export.as_array().unwrap();
    assert_eq!(items.len(), 1, "the list's filters apply: {json_export}");
    assert_eq!(items[0]["title"], "Second");
    assert_eq!(items[0]["tags"], json!([]));

    // Update the first row, add a new one, and one that fails.
    let upload = format!(
        "Id,Title,views,category,Notes\r\n{first},Renamed,4,{web},x\r\n,Brand new,1,,y\r\n,,2,,z\r\n,Ghost,1,missing-id,w\r\n"
    );
    let mapping = json!({ "Id": "documentId", "Title": "title", "Notes": null });
    let (status, report) = call(
        Method::POST,
        "/admin/api/content/api::article/import".into(),
        Some(json!({ "format": "csv", "data": upload, "mapping": mapping, "dryRun": true, "publish": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    let report = &report["data"];
    assert_eq!(
        (report["created"].clone(), report["updated"].clone(), report["failed"].clone()),
        (json!(1), json!(1), json!(2)),
        "{report}"
    );
    assert_eq!(report["errors"][0]["row"], 3);
    assert_eq!(report["errors"][0]["errors"][0]["path"], json!(["title"]), "{report}");
    assert_eq!(report["errors"][1]["row"], 4);
    assert_eq!(report["ignoredColumns"], json!(["Notes"]));
    let (_, list) = app.get("/api/articles?sort=title").await;
    let titles: Vec<&str> =
        list["data"].as_array().unwrap().iter().map(|a| a["title"].as_str().unwrap()).collect();
    assert_eq!(titles, ["=Hello, \"world\"", "Second"], "a dry run writes nothing");

    let (_, report) = call(
        Method::POST,
        "/admin/api/content/api::article/import".into(),
        Some(json!({ "format": "csv", "data": upload, "mapping": mapping, "publish": true })),
    )
    .await;
    assert_eq!(report["data"]["created"], 1, "{report}");
    let (_, list) = app.get("/api/articles?sort=title&populate=category").await;
    let rows: Vec<(String, Value)> = list["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| (a["title"].as_str().unwrap().to_owned(), a["category"]["name"].clone()))
        .collect();
    assert_eq!(
        rows,
        [
            ("Brand new".to_owned(), Value::Null),
            ("Renamed".to_owned(), json!("Web")),
            ("Second".to_owned(), Value::Null),
        ]
    );

    // JSON in the export's shape.
    let data = json!([{ "title": "From JSON", "views": 7, "tags": [web], "seo": { "metaTitle": "J" }, "extra": 1 }]).to_string();
    let (_, report) = call(
        Method::POST,
        "/admin/api/content/api::article/import".into(),
        Some(json!({ "format": "json", "data": data })),
    )
    .await;
    assert_eq!(report["data"]["created"], 1, "{report}");
    assert_eq!(report["data"]["ignoredColumns"], json!(["extra"]));
    let (_, drafts) = call(
        Method::GET,
        "/admin/api/content/api::article?filters[title][$eq]=From%20JSON&populate=*".into(),
        None,
    )
    .await;
    assert_eq!(drafts["data"][0]["seo"]["metaTitle"], "J", "{drafts}");
    assert_eq!(drafts["data"][0]["tags"][0]["name"], "Web");
    app.done().await;
}
