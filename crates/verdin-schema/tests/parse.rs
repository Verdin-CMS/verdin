use serde_json::{Value, json};
use verdin_schema::{AttributeKind, ContentTypeKind, RelationKind, Schema, SchemaErrors, Source};

fn ct(name: &str, value: Value) -> Source {
    Source::content_type(name, value.to_string())
}

fn component(category: &str, name: &str, value: Value) -> Source {
    Source::component(category, name, value.to_string())
}

fn blog() -> Vec<Source> {
    vec![
        ct(
            "article",
            json!({
                "kind": "collectionType",
                "singularName": "article",
                "pluralName": "articles",
                "displayName": "Article",
                "options": { "draftAndPublish": true },
                "attributes": {
                    "title": { "type": "string", "required": true, "maxLength": 200 },
                    "slug": { "type": "uid", "targetField": "title" },
                    "body": { "type": "richtext" },
                    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
                    "tags": { "type": "relation", "relation": "manyToMany", "target": "api::tag.tag" },
                    "seo": { "type": "component", "component": "shared.seo" },
                    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
                }
            }),
        ),
        ct(
            "category",
            json!({
                "kind": "collectionType",
                "singularName": "category",
                "pluralName": "categories",
                "displayName": "Category",
                "attributes": {
                    "name": { "type": "string", "unique": true },
                    "articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
                }
            }),
        ),
        ct(
            "tag",
            json!({
                "kind": "collectionType",
                "singularName": "tag",
                "pluralName": "tags",
                "displayName": "Tag",
                "collectionName": "blog_tags",
                "attributes": { "label": { "type": "string" } }
            }),
        ),
        ct(
            "homepage",
            json!({
                "kind": "singleType",
                "singularName": "homepage",
                "pluralName": "homepages",
                "displayName": "Homepage",
                "attributes": { "headline": { "type": "string" } }
            }),
        ),
        component(
            "shared",
            "seo",
            json!({
                "displayName": "SEO",
                "attributes": {
                    "metaTitle": { "type": "string", "maxLength": 60 },
                    "metaDescription": { "type": "text" }
                }
            }),
        ),
        component(
            "blocks",
            "hero",
            json!({ "displayName": "Hero", "attributes": { "title": { "type": "string" }, "seo": { "type": "component", "component": "shared.seo" } } }),
        ),
        component(
            "blocks",
            "quote",
            json!({ "displayName": "Quote", "attributes": { "text": { "type": "text" }, "author": { "type": "relation", "relation": "oneWay", "target": "tag" } } }),
        ),
    ]
}

fn errors(sources: &[Source]) -> Vec<String> {
    let SchemaErrors(errors) = Schema::parse(sources).expect_err("schema should be invalid");
    errors.iter().map(|error| format!("{}: {}", error.path, error.message)).collect()
}

fn replace(mut sources: Vec<Source>, source: Source) -> Vec<Source> {
    sources.retain(|existing| existing.path != source.path);
    sources.push(source);
    sources
}

fn assert_error(sources: &[Source], needle: &str) {
    let errors = errors(sources);
    assert!(
        errors.iter().any(|error| error.contains(needle)),
        "expected `{needle}` in {errors:#?}"
    );
}

#[test]
fn parses_blog_schema() {
    let schema = Schema::parse(&blog()).unwrap();

    assert_eq!(schema.content_types.len(), 4);
    assert_eq!(schema.components.len(), 3);

    let article = schema.content_type("api::article").unwrap();
    assert_eq!(article.kind, ContentTypeKind::CollectionType);
    assert_eq!(article.collection_name, "articles");
    assert!(article.draft_and_publish);
    let names: Vec<_> = article.attributes.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        ["title", "slug", "body", "category", "tags", "seo", "blocks"],
        "order is preserved"
    );
    assert!(matches!(
        &article.attributes["tags"].kind,
        AttributeKind::Relation { relation: RelationKind::ManyToMany, target, .. } if target == "api::tag"
    ));

    assert_eq!(schema.content_type("api::category").unwrap().collection_name, "categories");
    assert_eq!(schema.content_type("api::tag").unwrap().collection_name, "blog_tags");
    assert!(!schema.content_type("api::tag").unwrap().draft_and_publish, "off unless enabled");
    assert_eq!(schema.content_type("api::homepage").unwrap().kind, ContentTypeKind::SingleType);
    assert_eq!(schema.component("shared.seo").unwrap().attributes.len(), 2);
}

#[test]
fn reports_invalid_json_and_unknown_keys() {
    let sources = replace(blog(), Source::content_type("tag", "{ not json"));
    assert_error(&sources, "invalid JSON");

    let sources = replace(
        blog(),
        ct(
            "tag",
            json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags", "displayName": "Tag", "colour": "red" }),
        ),
    );
    assert_error(&sources, "unknown field `colour`");
}

#[test]
fn checks_content_type_names() {
    let base = json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags", "displayName": "Tag" });

    let mut bad = base.clone();
    bad["singularName"] = json!("Tag");
    assert_error(&replace(blog(), ct("tag", bad)), "singularName: must be kebab-case");

    let mut bad = base.clone();
    bad["singularName"] = json!("label");
    assert_error(&replace(blog(), ct("tag", bad)), "singularName: must match the file name");

    let mut bad = base.clone();
    bad["pluralName"] = json!("articles");
    assert_error(&replace(blog(), ct("tag", bad)), "`articles` is already used by `api::article`");

    let mut bad = base.clone();
    bad["collectionName"] = json!("articles");
    assert_error(&replace(blog(), ct("tag", bad)), "table `articles` is already used");

    let mut bad = base.clone();
    bad["collectionName"] = json!("vd_tags");
    assert_error(&replace(blog(), ct("tag", bad)), "reserved for system tables");

    let mut bad = base;
    bad["kind"] = json!("folder");
    assert_error(
        &replace(blog(), ct("tag", bad)),
        "kind: must be `collectionType` or `singleType`",
    );
}

fn tag_with(attributes: Value) -> Source {
    ct(
        "tag",
        json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags", "displayName": "Tag", "attributes": attributes }),
    )
}

#[test]
fn checks_attribute_names() {
    assert_error(
        &replace(blog(), tag_with(json!({ "_label": { "type": "string" } }))),
        "must start with a letter",
    );
    // Strapi-style names are allowed; two names for one column are not.
    assert!(
        Schema::parse(&replace(
            blog(),
            tag_with(json!({ "Label": { "type": "string" }, "kit_man": { "type": "string" } }))
        ))
        .is_ok()
    );
    assert_error(
        &replace(
            blog(),
            tag_with(
                json!({ "metaTitle": { "type": "string" }, "meta_title": { "type": "string" } }),
            ),
        ),
        "maps to the same column `meta_title`",
    );
    assert_error(
        &replace(blog(), tag_with(json!({ "createdAt": { "type": "datetime" } }))),
        "`createdAt` is reserved",
    );
    assert_error(
        &replace(blog(), tag_with(json!({ "documentId": { "type": "string" } }))),
        "`documentId` is reserved",
    );
}

#[test]
fn reports_attribute_option_errors_with_paths() {
    let sources =
        replace(blog(), tag_with(json!({ "label": { "type": "string", "maxLength": 300 } })));
    assert_error(&sources, "attributes.label.maxLength: must be ≤ 255");
}

#[test]
fn checks_uid_target_field() {
    assert_error(
        &replace(blog(), tag_with(json!({ "slug": { "type": "uid", "targetField": "nope" } }))),
        "unknown attribute `nope`",
    );
    assert_error(
        &replace(
            blog(),
            tag_with(
                json!({ "n": { "type": "integer" }, "slug": { "type": "uid", "targetField": "n" } }),
            ),
        ),
        "must be a string or text attribute",
    );
}

#[test]
fn checks_relations() {
    assert_error(
        &replace(
            blog(),
            tag_with(
                json!({ "x": { "type": "relation", "relation": "oneWay", "target": "missing" } }),
            ),
        ),
        "unknown content type `api::missing`",
    );

    // Inverse side declares the wrong kind.
    let sources = replace(
        blog(),
        ct(
            "category",
            json!({
                "kind": "collectionType", "singularName": "category", "pluralName": "categories", "displayName": "Category",
                "attributes": { "articles": { "type": "relation", "relation": "manyToMany", "target": "article", "mappedBy": "category" } }
            }),
        ),
    );
    assert_error(&sources, "must be `oneToMany` to mirror `manyToOne`");

    // mappedBy pointing at an attribute that does not point back.
    let sources = replace(
        blog(),
        tag_with(
            json!({ "articles": { "type": "relation", "relation": "manyToMany", "target": "article", "mappedBy": "tags" } }),
        ),
    );
    assert_error(&sources, "attributes.articles.mappedBy");
}

#[test]
fn checks_components() {
    assert_error(
        &replace(
            blog(),
            tag_with(json!({ "seo": { "type": "component", "component": "shared.nope" } })),
        ),
        "unknown component `shared.nope`",
    );
    assert_error(
        &replace(
            blog(),
            tag_with(
                json!({ "zone": { "type": "dynamiczone", "components": ["blocks.hero", "x.y"] } }),
            ),
        ),
        "attributes.zone.components[1]: unknown component `x.y`",
    );

    let mut sources = blog();
    sources.push(component("nested", "zone", json!({ "displayName": "Zone", "attributes": { "z": { "type": "dynamiczone", "components": ["blocks.hero"] } } })));
    assert_error(&sources, "dynamic zones cannot be nested in components");

    let mut sources = blog();
    sources.push(component("loop", "a", json!({ "displayName": "A", "attributes": { "b": { "type": "component", "component": "loop.b" } } })));
    sources.push(component("loop", "b", json!({ "displayName": "B", "attributes": { "a": { "type": "component", "component": "loop.a" } } })));
    assert_error(&sources, "components nest in a cycle: loop.a → loop.b → loop.a");

    let mut sources = blog();
    sources.push(component("shared", "link", json!({ "displayName": "Link", "attributes": { "to": { "type": "relation", "relation": "manyToOne", "target": "article" } } })));
    assert_error(&sources, "relations inside components must be `oneWay` or `manyWay`");

    // Media inside components is allowed (stored as file ids in the component JSON).
    let mut sources = blog();
    sources.push(component(
        "shared",
        "photo",
        json!({ "displayName": "Photo", "attributes": { "file": { "type": "media" } } }),
    ));
    assert!(Schema::parse(&sources).is_ok());

    let mut sources = blog();
    sources.push(ct("upload", json!({ "kind": "collectionType", "singularName": "upload", "pluralName": "uploads", "displayName": "Upload", "attributes": {} })));
    assert_error(&sources, "`upload` is reserved by the API");
}

#[test]
fn collects_all_errors() {
    let sources = replace(
        blog(),
        tag_with(
            json!({ "_bad": { "type": "string" }, "worse": { "type": "markdown" }, "slug": { "type": "uid", "targetField": "nope" } }),
        ),
    );
    assert_eq!(errors(&sources).len(), 3);
}

#[test]
fn loads_directory_layout() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("content-types")).unwrap();
    std::fs::create_dir_all(root.join("components/shared")).unwrap();
    std::fs::write(
        root.join("content-types/page.json"),
        json!({ "kind": "collectionType", "singularName": "page", "pluralName": "pages", "displayName": "Page",
                "attributes": { "seo": { "type": "component", "component": "shared.seo" } } })
        .to_string(),
    )
    .unwrap();
    std::fs::write(root.join("content-types/page.ui.json"), "{ \"ignored\": true }").unwrap();
    std::fs::write(
        root.join("components/shared/seo.json"),
        json!({ "displayName": "SEO", "attributes": { "metaTitle": { "type": "string" } } })
            .to_string(),
    )
    .unwrap();

    let schema = Schema::load_dir(root).unwrap();
    assert!(schema.content_type("api::page").is_some());
    assert!(schema.component("shared.seo").is_some());

    assert_eq!(Schema::load_dir(&root.join("missing")).unwrap(), Schema::default());
}
