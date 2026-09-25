//! Strapi content types and components (`schemas/` lines) as Verdin schema files.
//! Only `api::` content types are brought over; relations to admin users, end users or
//! plugins, morph relations and custom fields are dropped with a warning.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{Map, Value as Json, json};

/// Fields Strapi adds to every content type.
const SYSTEM: &[&str] = &[
    "id",
    "documentId",
    "createdAt",
    "updatedAt",
    "publishedAt",
    "createdBy",
    "updatedBy",
    "locale",
    "localizations",
    "strapi_stage",
    "strapi_assignee",
];

/// Options copied as they are, when present.
const KEPT: &[&str] = &[
    "required",
    "private",
    "configurable",
    "unique",
    "minLength",
    "maxLength",
    "regex",
    "targetField",
    "min",
    "max",
    "enum",
    "default",
    "multiple",
    "allowedTypes",
    "component",
    "repeatable",
    "components",
];

const SCALARS: &[&str] = &[
    "string",
    "text",
    "richtext",
    "blocks",
    "email",
    "uid",
    "integer",
    "biginteger",
    "float",
    "decimal",
    "boolean",
    "date",
    "time",
    "datetime",
    "enumeration",
    "json",
];

pub struct Converted {
    /// Paths relative to the schema directory, with their JSON.
    pub files: Vec<(PathBuf, Json)>,
    pub warnings: Vec<String>,
    /// Strapi uid → Verdin uid (`api::article.article` → `api::article`).
    pub types: HashMap<String, String>,
}

/// Converts the schema lines of an export.
pub fn convert(schemas: &[Json]) -> Converted {
    // Strapi uid → Verdin relation target (the singular name).
    let targets: HashMap<String, String> = schemas
        .iter()
        .filter(|schema| is_api_type(schema))
        .filter_map(|schema| {
            Some((
                schema["uid"].as_str()?.to_owned(),
                schema["info"]["singularName"].as_str()?.to_owned(),
            ))
        })
        .collect();
    let mut out = Converted { files: Vec::new(), warnings: Vec::new(), types: HashMap::new() };
    for schema in schemas {
        let Some(uid) = schema["uid"].as_str() else { continue };
        if is_api_type(schema) {
            let Some(singular) = schema["info"]["singularName"].as_str() else { continue };
            let mut file = Map::new();
            file.insert("kind".into(), schema["kind"].clone());
            file.insert("singularName".into(), json!(singular));
            file.insert("pluralName".into(), schema["info"]["pluralName"].clone());
            file.insert("displayName".into(), schema["info"]["displayName"].clone());
            if let Some(description) =
                schema["info"]["description"].as_str().filter(|d| !d.is_empty())
            {
                file.insert("description".into(), json!(description));
            }
            if let Some(collection) = schema["collectionName"].as_str() {
                file.insert("collectionName".into(), json!(collection));
            }
            if schema["options"]["draftAndPublish"].as_bool() == Some(true) {
                file.insert("options".into(), json!({ "draftAndPublish": true }));
            }
            if schema["pluginOptions"]["i18n"]["localized"].as_bool() == Some(true) {
                file.insert("pluginOptions".into(), json!({ "i18n": { "localized": true } }));
            }
            let attributes =
                attributes(uid, &schema["attributes"], false, &targets, &mut out.warnings);
            file.insert("attributes".into(), Json::Object(attributes));
            out.types.insert(uid.to_owned(), format!("api::{singular}"));
            out.files.push((
                PathBuf::from("content-types").join(format!("{singular}.json")),
                Json::Object(file),
            ));
        } else if schema["modelType"] == "component" {
            let Some((category, name)) = uid.split_once('.') else { continue };
            let mut file = Map::new();
            file.insert("displayName".into(), schema["info"]["displayName"].clone());
            for key in ["description", "icon"] {
                if let Some(value) = schema["info"][key].as_str().filter(|value| !value.is_empty())
                {
                    file.insert(key.into(), json!(value));
                }
            }
            let attributes =
                attributes(uid, &schema["attributes"], true, &targets, &mut out.warnings);
            file.insert("attributes".into(), Json::Object(attributes));
            out.files.push((
                PathBuf::from("components").join(category).join(format!("{name}.json")),
                Json::Object(file),
            ));
        }
    }
    fix_relation_pairs(&mut out);
    out.files.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Strapi tolerates `inversedBy` / `mappedBy` pointing at attributes that do not match;
/// such halves are dropped (the side keeps its own links).
fn fix_relation_pairs(out: &mut Converted) {
    let by_name: HashMap<String, usize> = out
        .files
        .iter()
        .enumerate()
        .filter_map(|(index, (_, json))| Some((json["singularName"].as_str()?.to_owned(), index)))
        .collect();
    let snapshot: Vec<Json> = out.files.iter().map(|(_, json)| json.clone()).collect();
    for (index, (_, json)) in out.files.iter_mut().enumerate() {
        let Some(own) = json["singularName"].as_str().map(str::to_owned) else { continue };
        let Some(attributes) = json.get_mut("attributes").and_then(Json::as_object_mut) else {
            continue;
        };
        for (name, attribute) in attributes.iter_mut() {
            let Some(target) = attribute["target"].as_str().map(str::to_owned) else { continue };
            for (key, back) in [("inversedBy", "mappedBy"), ("mappedBy", "inversedBy")] {
                let Some(other) = attribute.get(key).and_then(Json::as_str).map(str::to_owned)
                else {
                    continue;
                };
                let matches = by_name.get(&target).is_some_and(|&target_index| {
                    let counterpart = &snapshot[target_index]["attributes"][&other];
                    counterpart["target"] == own.as_str() && counterpart[back] == name.as_str()
                });
                if !matches {
                    attribute.as_object_mut().expect("attribute object").remove(key);
                    out.warnings.push(format!(
                        "api::{own}.{name}: `{key}: {other}` has no matching `{back}` on {target}; dropped"
                    ));
                }
            }
            let _ = index;
        }
    }
}

fn is_api_type(schema: &Json) -> bool {
    schema["modelType"] == "contentType"
        && schema["uid"].as_str().is_some_and(|uid| uid.starts_with("api::"))
}

fn attributes(
    owner: &str,
    raw: &Json,
    in_component: bool,
    targets: &HashMap<String, String>,
    warnings: &mut Vec<String>,
) -> Map<String, Json> {
    let mut out = Map::new();
    let Some(raw) = raw.as_object() else { return out };
    for (name, attribute) in raw {
        if !in_component && SYSTEM.contains(&name.as_str()) {
            continue;
        }
        let mut warn = |message: String| warnings.push(format!("{owner}.{name}: {message}"));
        if let Some(custom) = attribute["customField"].as_str() {
            warn(format!(
                "custom field `{custom}` imported as a plain `{}`",
                attribute["type"].as_str().unwrap_or("?")
            ));
        }
        let ty = attribute["type"].as_str().unwrap_or_default();
        let mut converted = Map::new();
        match ty {
            "timestamp" => {
                converted.insert("type".into(), json!("datetime"));
            }
            "password" => {
                warn("password fields are not imported".into());
                continue;
            }
            ty if SCALARS.contains(&ty) || matches!(ty, "media" | "component" | "dynamiczone") => {
                converted.insert("type".into(), json!(ty));
            }
            "relation" => {
                let relation = attribute["relation"].as_str().unwrap_or_default();
                let target = attribute["target"].as_str().unwrap_or_default();
                if relation.starts_with("morph") {
                    warn(format!("`{relation}` relations are not supported; skipped"));
                    continue;
                }
                let Some(target_name) = targets.get(target) else {
                    warn(format!("relation to `{target}` skipped (only api:: types are imported)"));
                    continue;
                };
                converted.insert("type".into(), json!("relation"));
                if in_component {
                    // Components hold one-way references only.
                    let kind = match relation {
                        "oneToMany" | "manyToMany" | "manyWay" => "manyWay",
                        _ => "oneWay",
                    };
                    if kind != relation {
                        warn(format!("`{relation}` inside a component imported as `{kind}`"));
                    }
                    converted.insert("relation".into(), json!(kind));
                } else {
                    converted.insert("relation".into(), json!(relation));
                    for key in ["inversedBy", "mappedBy"] {
                        if let Some(value) = attribute.get(key) {
                            converted.insert(key.into(), value.clone());
                        }
                    }
                }
                converted.insert("target".into(), json!(target_name));
            }
            other => {
                warn(format!("attribute type `{other}` is not supported; skipped"));
                continue;
            }
        }
        if let Some(object) = attribute.as_object() {
            for key in KEPT {
                if let Some(value) = object.get(*key).filter(|value| !value.is_null()) {
                    // `required` / `private` / `unique` default to false: keep files small.
                    if value == &json!(false) && matches!(*key, "required" | "private" | "unique") {
                        continue;
                    }
                    converted.insert((*key).into(), value.clone());
                }
            }
        }
        if matches!(ty, "text" | "richtext" | "blocks" | "json")
            && converted.remove("unique").is_some()
        {
            warn(format!("`unique` is not supported on `{ty}` attributes; dropped"));
        }
        if !in_component && attribute["pluginOptions"]["i18n"]["localized"].as_bool() == Some(false)
        {
            converted.insert("pluginOptions".into(), json!({ "i18n": { "localized": false } }));
        }
        out.insert(name.clone(), Json::Object(converted));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_types_and_components() {
        let schemas = vec![
            json!({ "uid": "api::article.article", "modelType": "contentType", "kind": "collectionType",
                    "collectionName": "articles",
                    "info": { "singularName": "article", "pluralName": "articles", "displayName": "Article" },
                    "options": { "draftAndPublish": true }, "pluginOptions": { "i18n": { "localized": true } },
                    "attributes": {
                        "title": { "type": "string", "required": true, "pluginOptions": { "i18n": { "localized": true } } },
                        "price": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } },
                        "authors": { "type": "relation", "relation": "manyToMany", "target": "api::author.author", "inversedBy": "articles" },
                        "owner": { "type": "relation", "relation": "oneToOne", "target": "admin::user" },
                        "createdAt": { "type": "datetime" },
                        "color": { "type": "string", "customField": "plugin::color-picker.color" }
                    } }),
            json!({ "uid": "api::author.author", "modelType": "contentType", "kind": "collectionType",
                    "info": { "singularName": "author", "pluralName": "authors", "displayName": "Author" },
                    "attributes": { "articles": { "type": "relation", "relation": "manyToMany", "target": "api::article.article", "mappedBy": "authors" } } }),
            json!({ "uid": "page-blocks.carousel", "modelType": "component",
                    "info": { "displayName": "Carousel", "icon": "images" },
                    "attributes": { "products": { "type": "relation", "relation": "oneToMany", "target": "api::article.article" } } }),
            json!({ "uid": "admin::user", "modelType": "contentType", "info": { "singularName": "user" }, "attributes": {} }),
        ];
        let converted = convert(&schemas);
        let paths: Vec<String> =
            converted.files.iter().map(|(path, _)| path.display().to_string()).collect();
        assert_eq!(
            paths,
            [
                "components/page-blocks/carousel.json",
                "content-types/article.json",
                "content-types/author.json"
            ]
        );
        let article = &converted.files[1].1;
        assert_eq!(article["pluginOptions"], json!({ "i18n": { "localized": true } }));
        assert_eq!(article["attributes"]["title"], json!({ "type": "string", "required": true }));
        assert_eq!(
            article["attributes"]["price"]["pluginOptions"],
            json!({ "i18n": { "localized": false } })
        );
        assert_eq!(
            article["attributes"]["authors"],
            json!({ "type": "relation", "relation": "manyToMany", "inversedBy": "articles", "target": "author" })
        );
        assert!(article["attributes"].get("owner").is_none());
        assert!(article["attributes"].get("createdAt").is_none());
        assert_eq!(converted.files[0].1["attributes"]["products"]["relation"], "manyWay");
        assert_eq!(converted.types["api::article.article"], "api::article");
        assert_eq!(converted.warnings.len(), 3, "{:?}", converted.warnings);
    }
}
