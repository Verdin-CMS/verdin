//! GraphQL over HTTP against a real database (VERDIN_TEST_DATABASE_URL, SQLite by default).

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use verdin_auth::{AuthConfig, AuthService, ContentAction, NewApiToken, TokenKind};
use verdin_content::{DocumentService, OutputOptions, Registry};
use verdin_migrate::{ApplyOptions, Renames};
use verdin_schema::{Schema, Source};
use verdin_testkit::TestDb;

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, draft: bool, attributes: Value| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural, "displayName": name,
                    "options": { "draftAndPublish": draft }, "attributes": attributes })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct("article", "articles", true, json!({
            "title": { "type": "string", "required": true },
            "views": { "type": "integer" },
            "big": { "type": "biginteger" },
            "published": { "type": "date" },
            "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
            "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
            "seo": { "type": "component", "component": "shared.seo" },
            "blocks": { "type": "dynamiczone", "components": ["blocks.quote", "blocks.hero"] },
            "secret": { "type": "string", "private": true }
        })),
        ct("category", "categories", false, json!({
            "name": { "type": "string" },
            "articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
        })),
        ct("tag", "tags", false, json!({ "label": { "type": "string" } })),
        Source::content_type("homepage", json!({ "kind": "singleType", "singularName": "homepage", "pluralName": "homepages",
            "displayName": "Homepage", "attributes": { "headline": { "type": "string" } } }).to_string()),
        Source::component("shared", "seo", json!({ "displayName": "Seo", "attributes": { "metaTitle": { "type": "string" } } }).to_string()),
        Source::component("blocks", "quote", json!({ "displayName": "Quote", "attributes": { "text": { "type": "text" } } }).to_string()),
        Source::component("blocks", "hero", json!({ "displayName": "Hero", "attributes": { "heading": { "type": "string" } } }).to_string()),
    ])
    .unwrap()
}

struct App {
    router: Router,
    test: TestDb,
    auth: AuthService,
    token: String,
}

impl App {
    async fn new(options: verdin_graphql::Options) -> Self {
        let test = TestDb::new().await;
        let schema = schema();
        verdin_migrate::apply(
            &test.db,
            &verdin_migrate::derive_model(&schema),
            &Renames::default(),
            ApplyOptions::default(),
        )
        .await
        .unwrap();
        let auth = AuthService::new(
            test.db.clone(),
            AuthConfig::new(
                "test-secret-test-secret-test-secret!",
                "test-pepper-test-pepper-test-pepper!",
            )
            .unwrap(),
        );
        auth.bootstrap().await.unwrap();
        let (_, token) = auth
            .create_api_token(NewApiToken {
                name: "tests".into(),
                description: None,
                kind: TokenKind::FullAccess,
                expires_in_days: None,
                permissions: vec![],
            })
            .await
            .unwrap();
        let service =
            DocumentService::new(test.db.clone(), Registry::new(schema), OutputOptions::default());
        let graphql =
            verdin_graphql::schema(service, verdin_query::Limits::default(), &options).unwrap();
        let router = verdin_graphql::router(graphql, auth.clone(), options, "/graphql");
        Self { router, test, auth, token }
    }

    async fn post(
        &self,
        query: &str,
        variables: Value,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method("POST")
            .uri("/graphql")
            .header("content-type", "application/json");
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let body = json!({ "query": query, "variables": variables }).to_string();
        let response =
            self.router.clone().oneshot(request.body(Body::from(body)).unwrap()).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    /// Runs with the full-access token and expects no errors.
    async fn ok(&self, query: &str, variables: Value) -> Value {
        let (status, body) = self.post(query, variables, Some(&self.token.clone())).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert!(body.get("errors").is_none(), "{body}");
        body["data"].clone()
    }

    async fn done(self) {
        self.test.drop().await;
    }
}

#[tokio::test]
async fn queries_and_mutations() {
    let app = App::new(verdin_graphql::Options::default()).await;
    let news = app
        .ok(r#"mutation { createCategory(data: { name: "News" }) { documentId name } }"#, json!({}))
        .await;
    let category = news["createCategory"]["documentId"].as_str().unwrap().to_owned();
    let tag = app
        .ok(r#"mutation { createTag(data: { label: "rust" }) { documentId } }"#, json!({}))
        .await["createTag"]["documentId"]
        .as_str()
        .unwrap()
        .to_owned();

    let create = r#"mutation($data: ArticleInput!) { createArticle(data: $data) { documentId title views big published
        category { name } tags { label } seo { metaTitle }
        blocks { __typename ... on ComponentBlocksQuote { text } ... on ComponentBlocksHero { heading } } } }"#;
    for (title, views) in [("First", 10), ("Second", 30), ("Third", 20)] {
        let data = json!({ "title": title, "views": views, "big": "9007199254740993", "published": "2026-09-24",
            "category": category, "tags": [tag], "seo": { "metaTitle": format!("{title} SEO") },
            "blocks": [{ "__component": "blocks.quote", "text": "Q" }, { "__component": "blocks.hero", "heading": "H" }] });
        let created = app.ok(create, json!({ "data": data })).await["createArticle"].clone();
        assert_eq!(created["title"], title);
        assert_eq!(created["big"], "9007199254740993", "Long keeps precision");
        assert_eq!(created["category"]["name"], "News");
        assert_eq!(created["tags"][0]["label"], "rust");
        assert_eq!(created["seo"]["metaTitle"], format!("{title} SEO"));
        assert_eq!(
            created["blocks"][0],
            json!({ "__typename": "ComponentBlocksQuote", "text": "Q" })
        );
        assert_eq!(
            created["blocks"][1],
            json!({ "__typename": "ComponentBlocksHero", "heading": "H" })
        );
    }

    // Filters, sort, pagination and the connection's pageInfo.
    let list = app
        .ok(
            r#"{ articles(filters: { views: { gte: 20 }, or: [{ title: { eq: "Second" } }, { title: { containsi: "third" } }] },
                           sort: ["views:desc"]) { title }
                 articles_connection(pagination: { page: 2, pageSize: 2 }, sort: ["title:asc"]) {
                   nodes { title } pageInfo { page pageSize pageCount total } } }"#,
            json!({}),
        )
        .await;
    assert_eq!(list["articles"], json!([{ "title": "Second" }, { "title": "Third" }]));
    assert_eq!(list["articles_connection"]["nodes"], json!([{ "title": "Third" }]));
    assert_eq!(
        list["articles_connection"]["pageInfo"],
        json!({ "page": 2, "pageSize": 2, "pageCount": 2, "total": 3 })
    );

    // Relation filters and relation arguments on the inverse side.
    let categories = app
        .ok(
            r#"{ categories(filters: { articles: { views: { gt: 25 } } }) {
                   name articles(sort: ["views:asc"], filters: { views: { gt: 15 } }) { title } } }"#,
            json!({}),
        )
        .await;
    assert_eq!(
        categories["categories"][0]["articles"],
        json!([{ "title": "Third" }, { "title": "Second" }])
    );

    let second = app
        .ok(r#"{ articles(filters: { title: { eq: "Second" } }) { documentId } }"#, json!({}))
        .await["articles"][0]["documentId"]
        .as_str()
        .unwrap()
        .to_owned();
    let one = app
        .ok("query($id: ID!) { article(documentId: $id) { title } }", json!({ "id": second }))
        .await;
    assert_eq!(one["article"]["title"], "Second");

    // Drafts: saved with status DRAFT, invisible to published reads.
    let draft = app
        .ok(r#"mutation { createArticle(data: { title: "Draft" }, status: DRAFT) { documentId publishedAt } }"#, json!({}))
        .await;
    assert!(draft["createArticle"]["publishedAt"].is_null());
    let counts = app
        .ok(r#"{ published: articles_connection { pageInfo { total } } drafts: articles_connection(status: DRAFT) { pageInfo { total } } }"#, json!({}))
        .await;
    assert_eq!(counts["published"]["pageInfo"]["total"], 3);
    assert_eq!(counts["drafts"]["pageInfo"]["total"], 4);

    // Updates, single types, deletes.
    let updated = app
        .ok(
            "mutation($id: ID!) { updateArticle(documentId: $id, data: { views: 99 }) { views } }",
            json!({ "id": second }),
        )
        .await;
    assert_eq!(updated["updateArticle"]["views"], 99);
    let home = app
        .ok(r#"mutation { updateHomepage(data: { headline: "Hi" }) { headline } }"#, json!({}))
        .await;
    assert_eq!(home["updateHomepage"]["headline"], "Hi");
    assert_eq!(app.ok("{ homepage { headline } }", json!({})).await["homepage"]["headline"], "Hi");
    let deleted = app
        .ok(
            "mutation($id: ID!) { deleteArticle(documentId: $id) { documentId } }",
            json!({ "id": second }),
        )
        .await;
    assert_eq!(deleted["deleteArticle"]["documentId"], second);
    assert!(
        app.ok("query($id: ID!) { article(documentId: $id) { title } }", json!({ "id": second }))
            .await["article"]
            .is_null()
    );
    app.done().await;
}

#[tokio::test]
async fn errors_permissions_and_limits() {
    let app = App::new(verdin_graphql::Options { max_depth: 4, ..Default::default() }).await;
    let token = app.token.clone();

    // Validation errors carry Strapi-like details.
    let (_, body) = app
        .post(
            r#"mutation { createArticle(data: { views: 1 }) { title } }"#,
            json!({}),
            Some(&token),
        )
        .await;
    assert_eq!(body["errors"][0]["extensions"]["code"], "BAD_USER_INPUT", "{body}");
    assert_eq!(
        body["errors"][0]["extensions"]["details"][0]["message"],
        "title is a required field"
    );
    let (_, body) =
        app.post(r#"{ articles(sort: ["nope:asc"]) { title } }"#, json!({}), Some(&token)).await;
    assert_eq!(body["errors"][0]["extensions"]["code"], "BAD_USER_INPUT", "{body}");

    // Private fields do not exist in the schema.
    let (_, body) = app.post("{ articles { secret } }", json!({}), Some(&token)).await;
    assert!(body["errors"][0]["message"].as_str().unwrap().contains("secret"), "{body}");

    // The public role needs grants, like REST.
    let (_, body) = app.post("{ articles { title } }", json!({}), None).await;
    assert_eq!(body["errors"][0]["extensions"]["code"], "FORBIDDEN", "{body}");
    app.auth.set_public_grants(&[("api::article".into(), ContentAction::Find)]).await.unwrap();
    let (_, body) = app.post("{ articles { title } }", json!({}), None).await;
    assert!(body.get("errors").is_none(), "{body}");
    let (_, body) = app.post("{ articles(status: DRAFT) { title } }", json!({}), None).await;
    assert_eq!(body["errors"][0]["extensions"]["code"], "FORBIDDEN", "drafts need readDrafts");
    let (_, body) = app
        .post(r#"mutation { createTag(data: { label: "x" }) { label } }"#, json!({}), None)
        .await;
    assert_eq!(body["errors"][0]["extensions"]["code"], "FORBIDDEN");
    let (status, _) = app.post("{ articles { title } }", json!({}), Some("not-a-token")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Depth limit.
    let (_, body) = app
        .post(
            "{ categories { articles { category { articles { category { name } } } } } }",
            json!({}),
            Some(&token),
        )
        .await;
    assert!(body["errors"][0]["message"].as_str().unwrap().contains("too deep"), "{body}");

    // Introspection works by default.
    let (_, body) = app
        .post("{ __type(name: \"Article\") { fields { name } } }", json!({}), Some(&token))
        .await;
    let names: Vec<&str> = body["data"]["__type"]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&"title") && names.contains(&"category") && !names.contains(&"secret"),
        "{names:?}"
    );
    app.done().await;
}
