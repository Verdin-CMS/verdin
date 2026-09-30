//! Filters on repeatable components and dynamic zones.

use axum::http::StatusCode;
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::App;

fn schema() -> Schema {
    Schema::parse(&[
        Source::content_type(
            "page",
            json!({ "kind": "collectionType", "singularName": "page", "pluralName": "pages",
                    "displayName": "Page",
                    "attributes": {
                        "title": { "type": "string" },
                        "links": { "type": "component", "component": "shared.link", "repeatable": true },
                        "blocks": { "type": "dynamiczone", "components": ["shared.link", "blocks.hero"] }
                    } })
            .to_string(),
        ),
        Source::component(
            "shared",
            "link",
            json!({ "displayName": "Link", "attributes": {
                "url": { "type": "string" }, "clicks": { "type": "integer" }, "external": { "type": "boolean" }
            } })
            .to_string(),
        ),
        Source::component(
            "blocks",
            "hero",
            json!({ "displayName": "Hero", "attributes": { "heading": { "type": "string" } } }).to_string(),
        ),
    ])
    .unwrap()
}

fn titles(body: &Value) -> Vec<String> {
    let mut titles: Vec<String> = body["data"]
        .as_array()
        .unwrap_or_else(|| panic!("{body}"))
        .iter()
        .map(|doc| doc["title"].as_str().unwrap().to_owned())
        .collect();
    titles.sort();
    titles
}

#[tokio::test]
async fn filters_on_repeatable_components_and_zones() {
    let app = App::new(schema()).await;
    let link = |url: &str, clicks: i64, external: bool| json!({ "url": url, "clicks": clicks, "external": external });
    for (title, links, blocks) in [
        (
            "Docs",
            vec![link("https://verdin.dev", 10, false), link("https://rust-lang.org", 3, true)],
            json!([{ "__component": "blocks.hero", "heading": "Hi" }]),
        ),
        (
            "Blog",
            vec![link("https://verdin.dev/blog", 1, false)],
            json!([{ "__component": "shared.link", "url": "https://x.y", "clicks": 0, "external": true }]),
        ),
        ("Empty", vec![], json!([])),
    ] {
        let (status, body) = app
            .post("/api/pages", json!({ "title": title, "links": links, "blocks": blocks }))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    for (query, expected) in [
        ("filters[links][url][$contains]=rust", vec!["Docs"]),
        ("filters[links][url][$startsWith]=https://verdin.dev", vec!["Blog", "Docs"]),
        ("filters[links][clicks][$gte]=5", vec!["Docs"]),
        ("filters[links][external][$eq]=true", vec!["Docs"]),
        ("filters[$not][links][clicks][$gt]=0", vec!["Empty"]),
        ("filters[blocks][__component][$eq]=blocks.hero", vec!["Docs"]),
        ("filters[blocks][__component][$in][0]=shared.link&filters[title][$ne]=Docs", vec!["Blog"]),
    ] {
        let (status, body) = app.get(&format!("/api/pages?{query}")).await;
        assert_eq!(status, StatusCode::OK, "{query}: {body}");
        assert_eq!(titles(&body), expected, "{query}");
    }
    let (status, _) = app.get("/api/pages?filters[blocks][heading][$eq]=Hi").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "zone items are filtered by __component only");
    app.done().await;
}

#[tokio::test]
async fn huge_pages_are_empty() {
    let app = App::new(schema()).await;
    app.post("/api/pages", json!({ "title": "One" })).await;
    for query in [
        "pagination[page]=9223372036854775807&pagination[pageSize]=100",
        "pagination[start]=9223372036854775807",
    ] {
        let (status, body) = app.get(&format!("/api/pages?{query}")).await;
        assert_eq!(status, StatusCode::OK, "{query}: {body}");
        assert_eq!(body["data"], json!([]), "{query}");
    }
}

fn products() -> Schema {
    Schema::parse(&[Source::content_type(
        "product",
        json!({ "kind": "collectionType", "singularName": "product", "pluralName": "products",
                "displayName": "Product",
                "attributes": {
                    "name": { "type": "string" },
                    "price": { "type": "decimal", "precision": 10, "scale": 2 }
                } })
        .to_string(),
    )])
    .unwrap()
}

/// `decimal` values (text on SQLite) sort and compare as numbers through the REST API.
#[tokio::test]
async fn decimals_sort_and_compare_as_numbers() {
    let app = App::new(products()).await;
    for price in [10, 25, 8, 12, 6] {
        let (status, body) =
            app.post("/api/products", json!({ "name": format!("p{price}"), "price": price })).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    let prices = |body: &Value| -> Vec<f64> {
        body["data"]
            .as_array()
            .unwrap_or_else(|| panic!("{body}"))
            .iter()
            .map(|doc| doc["price"].as_f64().unwrap())
            .collect()
    };
    for (query, expected) in [
        ("sort=price:desc", vec![25.0, 12.0, 10.0, 8.0, 6.0]),
        ("sort=price:asc", vec![6.0, 8.0, 10.0, 12.0, 25.0]),
        ("filters[price][$gt]=9&sort=price:desc", vec![25.0, 12.0, 10.0]),
        ("filters[price][$lt]=100&sort=price:desc", vec![25.0, 12.0, 10.0, 8.0, 6.0]),
        (
            "filters[price][$between][0]=8&filters[price][$between][1]=12&sort=price",
            vec![8.0, 10.0, 12.0],
        ),
        ("filters[price][$eq]=12.00", vec![12.0]),
    ] {
        let (status, body) = app.get(&format!("/api/products?{query}")).await;
        assert_eq!(status, StatusCode::OK, "{query}: {body}");
        assert_eq!(prices(&body), expected, "{query}");
    }
    app.done().await;
}

/// Whole decimals are JSON integers (`25`, as Strapi returns them), others the shortest
/// float; `decimal_as_string` is covered by the output unit tests.
#[tokio::test]
async fn whole_decimals_are_integers() {
    let app = App::new(products()).await;
    for (name, price, expected) in [
        ("whole", json!(25), json!(25)),
        ("scaled", json!("8.00"), json!(8)),
        ("half", json!(12.5), json!(12.5)),
    ] {
        let (status, body) =
            app.post("/api/products", json!({ "name": name, "price": price })).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        assert_eq!(body["data"]["price"], expected, "{name}: {body}");
    }
    let (_, body) = app.get("/api/products?sort=price:desc").await;
    let prices: Vec<&Value> =
        body["data"].as_array().unwrap().iter().map(|doc| &doc["price"]).collect();
    assert_eq!(prices, [&json!(25), &json!(12.5), &json!(8)]);
    assert!(prices[0].is_i64() && prices[2].is_i64(), "{body}");
    app.done().await;
}
