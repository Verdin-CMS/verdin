//! OpenAPI 3.1 description of the content API, generated from the schema.

use serde_json::{Map, Value, json};
use verdin_content::Registry;
use verdin_query::FieldCategory;
use verdin_schema::{Attribute, AttributeKind, ContentTypeKind, Schema};

pub fn document(registry: &Registry, prefix: &str) -> Value {
    let schema = &registry.schema;
    let mut paths = Map::new();
    let mut schemas = Map::new();

    schemas.insert("Error".into(), error_schema());
    schemas.insert("UploadFile".into(), upload_file_schema());
    for component in schema.components.values() {
        schemas.insert(
            component_name(&component.uid),
            attributes_schema(schema, &component.attributes, true),
        );
    }

    let mut models: Vec<_> = registry.types().collect();
    models.sort_by(|a, b| a.uid().cmp(b.uid()));
    for model in models {
        let content_type = &model.content_type;
        let name = pascal_case(&content_type.singular_name);
        let reference = json!({ "$ref": format!("#/components/schemas/{name}") });
        let input_reference = json!({ "$ref": format!("#/components/schemas/{name}Input") });

        let mut document = attributes_schema(schema, &content_type.attributes, false);
        let properties = document["properties"].as_object_mut().expect("object schema");
        let mut ordered = Map::new();
        ordered.insert("id".into(), json!({ "type": "integer", "format": "int64" }));
        ordered.insert("documentId".into(), json!({ "type": "string" }));
        ordered.append(properties);
        for field in ["createdAt", "updatedAt"] {
            ordered.insert(field.into(), json!({ "type": "string", "format": "date-time" }));
        }
        ordered.insert(
            "publishedAt".into(),
            json!({ "type": ["string", "null"], "format": "date-time" }),
        );
        document["properties"] = Value::Object(ordered);
        document["required"] = json!(["id", "documentId"]);
        schemas.insert(name.clone(), document);
        schemas.insert(
            format!("{name}Input"),
            attributes_schema(schema, &content_type.attributes, true),
        );

        let single_response = json!({
            "description": "OK",
            "content": { "application/json": { "schema": {
                "type": "object",
                "properties": { "data": reference, "meta": { "type": "object" } }
            }}}
        });
        let request = json!({
            "required": true,
            "content": { "application/json": { "schema": {
                "type": "object", "required": ["data"], "properties": { "data": input_reference }
            }}}
        });
        let tag = json!([content_type.display_name]);
        let read_params = json!([param_ref("fields"), param_ref("populate"), param_ref("status")]);
        let errors = error_responses();

        if content_type.kind == ContentTypeKind::SingleType {
            let path = format!("{prefix}/{}", content_type.singular_name);
            paths.insert(path, json!({
                "get": operation(&tag, &format!("Get the {}", content_type.display_name), &read_params, None, &single_response, &errors),
                "put": operation(&tag, &format!("Create or update the {}", content_type.display_name), &read_params, Some(&request), &single_response, &errors),
                "delete": operation(&tag, &format!("Delete the {}", content_type.display_name), &json!([]), None, &json!({ "description": "Deleted" }), &errors),
            }));
            continue;
        }

        let list_response = json!({
            "description": "OK",
            "content": { "application/json": { "schema": {
                "type": "object",
                "properties": {
                    "data": { "type": "array", "items": reference },
                    "meta": { "type": "object", "properties": { "pagination": { "$ref": "#/components/schemas/Pagination" } } }
                }
            }}}
        });
        let list_params = json!([
            param_ref("filters"),
            param_ref("sort"),
            param_ref("fields"),
            param_ref("populate"),
            param_ref("paginationPage"),
            param_ref("paginationPageSize"),
            param_ref("paginationStart"),
            param_ref("paginationLimit"),
            param_ref("paginationWithCount"),
            param_ref("status")
        ]);
        let plural = &content_type.plural_name;
        paths.insert(format!("{prefix}/{plural}"), json!({
            "get": operation(&tag, &format!("List {plural}"), &list_params, None, &list_response, &errors),
            "post": operation(&tag, &format!("Create {}", with_article(&content_type.singular_name)), &read_params, Some(&request), &json!({ "description": "Created", "content": single_response["content"] }), &errors),
        }));
        let document_params = prepend(json!([param_ref("documentId")]), &read_params);
        paths.insert(format!("{prefix}/{plural}/{{documentId}}"), json!({
            "get": operation(&tag, &format!("Get {}", with_article(&content_type.singular_name)), &document_params, None, &single_response, &errors),
            "put": operation(&tag, &format!("Update {}", with_article(&content_type.singular_name)), &document_params, Some(&request), &single_response, &errors),
            "delete": operation(&tag, &format!("Delete {}", with_article(&content_type.singular_name)), &json!([param_ref("documentId")]), None, &json!({ "description": "Deleted" }), &errors),
        }));
        if content_type.draft_and_publish {
            let action_params = prepend(
                json!([param_ref("documentId"), {
                    "name": "action", "in": "path", "required": true,
                    "schema": { "type": "string", "enum": ["publish", "unpublish", "discard-draft"] }
                }]),
                &read_params,
            );
            paths.insert(format!("{prefix}/{plural}/{{documentId}}/actions/{{action}}"), json!({
                "post": operation(&tag, "Publish, unpublish or discard the draft", &action_params, None, &single_response, &errors),
            }));
        }
    }

    schemas.insert("Pagination".into(), json!({
        "type": "object",
        "properties": {
            "page": { "type": "integer" }, "pageSize": { "type": "integer" }, "pageCount": { "type": "integer" },
            "start": { "type": "integer" }, "limit": { "type": "integer" }, "total": { "type": "integer" }
        }
    }));

    json!({
        "openapi": "3.1.0",
        "info": { "title": "Verdin content API", "version": env!("CARGO_PKG_VERSION") },
        "paths": paths,
        "components": { "schemas": schemas, "parameters": parameters() },
    })
}

fn operation(
    tag: &Value,
    summary: &str,
    parameters: &Value,
    body: Option<&Value>,
    ok: &Value,
    errors: &Value,
) -> Value {
    let mut responses = errors.as_object().cloned().unwrap_or_default();
    let status = if summary.starts_with("Create ") {
        "201"
    } else if summary.starts_with("Delete") {
        "204"
    } else {
        "200"
    };
    responses.insert(status.into(), ok.clone());
    let mut operation = json!({ "tags": tag, "summary": summary, "parameters": parameters, "responses": responses });
    if let Some(body) = body {
        operation["requestBody"] = body.clone();
    }
    operation
}

fn prepend(first: Value, rest: &Value) -> Value {
    let mut items = first.as_array().cloned().unwrap_or_default();
    items.extend(rest.as_array().cloned().unwrap_or_default());
    Value::Array(items)
}

fn param_ref(name: &str) -> Value {
    json!({ "$ref": format!("#/components/parameters/{name}") })
}

fn parameters() -> Value {
    let query = |name: &str, description: &str, schema: Value| json!({ "name": name, "in": "query", "required": false, "description": description, "schema": schema });
    json!({
        "documentId": { "name": "documentId", "in": "path", "required": true, "schema": { "type": "string" } },
        "filters": {
            "name": "filters", "in": "query", "required": false, "style": "deepObject", "explode": true,
            "description": "Filters, e.g. `filters[title][$containsi]=rust`.",
            "schema": { "type": "object" }
        },
        "sort": query("sort", "Sort, e.g. `title:asc,createdAt:desc`.", json!({ "type": "string" })),
        "fields": query("fields", "Comma-separated fields to return.", json!({ "type": "string" })),
        "populate": query("populate", "Components / dynamic zones to include, or `*`.", json!({ "type": "string" })),
        "paginationPage": query("pagination[page]", "Page number (from 1).", json!({ "type": "integer", "minimum": 1 })),
        "paginationPageSize": query("pagination[pageSize]", "Page size.", json!({ "type": "integer", "minimum": 1 })),
        "paginationStart": query("pagination[start]", "Offset.", json!({ "type": "integer", "minimum": 0 })),
        "paginationLimit": query("pagination[limit]", "Limit (-1 for the maximum).", json!({ "type": "integer" })),
        "paginationWithCount": query("pagination[withCount]", "Include the total count.", json!({ "type": "boolean" })),
        "status": query("status", "Version to read or write.", json!({ "type": "string", "enum": ["published", "draft"] })),
    })
}

fn error_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "data": { "type": "null" },
            "error": {
                "type": "object",
                "properties": {
                    "status": { "type": "integer" }, "name": { "type": "string" },
                    "message": { "type": "string" }, "details": { "type": "object" }
                }
            }
        }
    })
}

fn error_responses() -> Value {
    let error = |description: &str| json!({ "description": description, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } });
    json!({ "400": error("Bad Request"), "403": error("Forbidden"), "404": error("Not Found") })
}

/// Object schema of attributes. `input` includes private fields (they are writable).
fn attributes_schema(
    schema: &Schema,
    attributes: &indexmap::IndexMap<String, Attribute>,
    input: bool,
) -> Value {
    let mut properties = Map::new();
    for (name, attribute) in attributes {
        if attribute.private && !input {
            continue;
        }
        let (_, category) = verdin_query::attribute_kind(&attribute.kind);
        if let AttributeKind::Media { multiple, .. } = &attribute.kind {
            let one = if input {
                json!({ "type": "integer", "description": "file id" })
            } else {
                json!({ "$ref": "#/components/schemas/UploadFile" })
            };
            let property = if *multiple {
                json!({ "type": "array", "items": one })
            } else {
                json!({ "oneOf": [one, { "type": "null" }] })
            };
            properties.insert(name.clone(), property);
            continue;
        }
        if category == FieldCategory::Relation {
            if let Some(property) = relation_schema(schema, &attribute.kind, input) {
                properties.insert(name.clone(), property);
            }
            continue;
        }
        let mut property = attribute_schema(schema, &attribute.kind);
        if let Some(default) = &attribute.default {
            property["default"] = default.clone();
        }
        properties.insert(name.clone(), property);
    }
    json!({ "type": "object", "properties": properties })
}

fn attribute_schema(schema: &Schema, kind: &AttributeKind) -> Value {
    let nullable = |ty: &str| json!([ty, "null"]);
    match kind {
        AttributeKind::String { max_length, .. }
        | AttributeKind::Text { max_length, .. }
        | AttributeKind::RichText { max_length, .. } => {
            let mut value = json!({ "type": nullable("string") });
            if let Some(max) = max_length {
                value["maxLength"] = json!(max);
            }
            value
        }
        AttributeKind::Email { .. } => json!({ "type": nullable("string"), "format": "email" }),
        AttributeKind::Uid { .. } => json!({ "type": nullable("string") }),
        AttributeKind::Enumeration { values } => {
            json!({ "type": nullable("string"), "enum": values })
        }
        AttributeKind::Integer { .. } => json!({ "type": nullable("integer"), "format": "int32" }),
        AttributeKind::BigInteger { .. } => {
            json!({ "type": nullable("string"), "format": "int64" })
        }
        AttributeKind::Float { .. } => json!({ "type": nullable("number"), "format": "double" }),
        AttributeKind::Decimal { .. } => json!({ "type": nullable("number") }),
        AttributeKind::Boolean => json!({ "type": nullable("boolean") }),
        AttributeKind::Date { .. } => json!({ "type": nullable("string"), "format": "date" }),
        AttributeKind::Time { .. } => json!({ "type": nullable("string"), "format": "time" }),
        AttributeKind::DateTime { .. } => {
            json!({ "type": nullable("string"), "format": "date-time" })
        }
        AttributeKind::Json => json!({}),
        AttributeKind::Blocks => json!({
            "type": ["array", "null"],
            "description": "Rich text blocks (Strapi format)",
            "items": { "type": "object", "required": ["type"], "properties": { "type": { "type": "string" } } }
        }),
        AttributeKind::Component { component, repeatable, .. } => {
            let reference =
                json!({ "$ref": format!("#/components/schemas/{}", component_name(component)) });
            if *repeatable {
                json!({ "type": "array", "items": reference })
            } else {
                json!({ "oneOf": [reference, { "type": "null" }] })
            }
        }
        AttributeKind::DynamicZone { components, .. } => {
            let variants: Vec<Value> = components
                .iter()
                .filter(|uid| schema.component(uid).is_some())
                .map(|uid| {
                    json!({ "allOf": [
                        { "$ref": format!("#/components/schemas/{}", component_name(uid)) },
                        { "type": "object", "required": ["__component"], "properties": { "__component": { "const": uid } } }
                    ]})
                })
                .collect();
            json!({ "type": "array", "items": { "oneOf": variants } })
        }
        AttributeKind::Relation { .. } | AttributeKind::Media { .. } => json!({}),
    }
}

/// A media library file (Strapi's upload file shape).
pub(crate) fn upload_file_schema() -> Value {
    let text = json!({ "type": "string" });
    let nullable_text = json!({ "type": ["string", "null"] });
    let nullable_int = json!({ "type": ["integer", "null"] });
    json!({
        "type": "object",
        "properties": {
            "id": { "type": "integer" },
            "documentId": text,
            "name": text,
            "alternativeText": nullable_text,
            "caption": nullable_text,
            "width": nullable_int,
            "height": nullable_int,
            "focalPoint": { "type": ["object", "null"] },
            "formats": { "type": ["object", "null"] },
            "hash": text,
            "ext": text,
            "mime": text,
            "size": { "type": "number", "description": "kilobytes" },
            "url": text,
            "previewUrl": nullable_text,
            "provider": text,
            "provider_metadata": { "type": ["object", "null"] },
            "createdAt": { "type": "string", "format": "date-time" },
            "updatedAt": { "type": "string", "format": "date-time" },
            "publishedAt": { "type": "string", "format": "date-time" }
        }
    })
}

/// Output: the populated document(s). Input: documentIds, or `{ connect, disconnect, set }`
/// (owning side only; `mappedBy` sides are read-only).
fn relation_schema(schema: &Schema, kind: &AttributeKind, input: bool) -> Option<Value> {
    let AttributeKind::Relation { relation, target, mapped_by, .. } = kind else { return None };
    let target = schema.content_type(target)?;
    if input {
        if mapped_by.is_some() {
            return None;
        }
        let id = json!({ "oneOf": [
            { "type": "string" },
            { "type": "object", "required": ["documentId"], "properties": {
                "documentId": { "type": "string" },
                "position": { "type": "object", "properties": {
                    "before": { "type": "string" }, "after": { "type": "string" },
                    "start": { "type": "boolean" }, "end": { "type": "boolean" }
                }}
            }}
        ]});
        let ids = json!({ "oneOf": [id, { "type": "array", "items": id }] });
        return Some(json!({ "oneOf": [
            { "type": "null" },
            ids,
            { "type": "object", "properties": { "connect": ids, "disconnect": ids, "set": ids } }
        ]}));
    }
    let reference =
        json!({ "$ref": format!("#/components/schemas/{}", pascal_case(&target.singular_name)) });
    Some(if relation.is_to_many() {
        json!({ "type": "array", "items": reference, "description": "Returned when populated." })
    } else {
        json!({ "oneOf": [reference, { "type": "null" }], "description": "Returned when populated." })
    })
}

/// `shared.seo` → `SharedSeoComponent`.
fn component_name(uid: &str) -> String {
    let name: String = uid.split(['.', '-']).map(pascal_case).collect();
    format!("{name}Component")
}

/// `blog-post` → `BlogPost`.
fn pascal_case(name: &str) -> String {
    name.split('-')
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect()
}

/// `article` → `an article`, `page` → `a page` (by the first letter, good enough for names).
fn with_article(name: &str) -> String {
    let vowel = name.chars().next().is_some_and(|c| "aeiouAEIOU".contains(c));
    format!("{} {name}", if vowel { "an" } else { "a" })
}
