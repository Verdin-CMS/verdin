//! Relations and media inside components and dynamic zones. Component JSON stores the
//! references themselves — `documentId`s for relations (only `oneWay`/`manyWay` are
//! allowed there), file ids for media — checked on write and resolved when the component
//! is populated.

use indexmap::IndexMap;
use serde_json::{Map, Value as Json};
use verdin_schema::{Attribute, AttributeKind, MediaType, Schema};

use crate::Issue;

/// What a reference inside a component points at.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Target {
    /// Documents of a content type (by uid).
    Documents {
        uid: String,
    },
    Files {
        allowed: Vec<MediaType>,
    },
}

/// One relation or media value found in component JSON.
#[derive(Debug, Clone)]
pub(crate) struct Reference {
    pub path: Vec<Json>,
    pub target: Target,
    /// `documentId`s (strings) or file ids (numbers), as stored.
    pub values: Vec<Json>,
}

/// Canonical stored form of a relation value inside a component.
pub(crate) fn normalize_relation(value: &Json, many: bool) -> Result<Json, String> {
    fn id(value: &Json) -> Option<String> {
        match value {
            Json::String(id) if !id.is_empty() => Some(id.clone()),
            Json::Object(object) => {
                object.get("documentId").and_then(Json::as_str).map(str::to_owned)
            }
            _ => None,
        }
    }
    const MESSAGE: &str = "relations take documentIds (strings) or `{ \"documentId\": … }`";
    match (value, many) {
        (Json::Null, false) => Ok(Json::Null),
        (Json::Null, true) => Ok(Json::Array(Vec::new())),
        (Json::Array(items), true) => {
            let mut ids: Vec<String> = Vec::new();
            for item in items {
                let id = id(item).ok_or(MESSAGE)?;
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            Ok(Json::Array(ids.into_iter().map(Json::String).collect()))
        }
        (Json::Array(_), false) => Err("this relation holds a single document".into()),
        (other, false) => Ok(Json::String(id(other).ok_or(MESSAGE)?)),
        (other, true) => Ok(Json::Array(vec![Json::String(id(other).ok_or(MESSAGE)?)])),
    }
}

/// Canonical stored form of a media value inside a component (file ids).
pub(crate) fn normalize_media(value: &Json, multiple: bool) -> Result<Json, String> {
    fn id(value: &Json) -> Option<i64> {
        match value {
            Json::Number(number) => number.as_i64(),
            Json::String(text) => text.parse().ok(),
            Json::Object(object) => object.get("id").and_then(id),
            _ => None,
        }
        .filter(|id| *id > 0)
    }
    const MESSAGE: &str = "media fields take file ids or `{ \"id\": … }`";
    let mut ids: Vec<i64> = match value {
        Json::Null => Vec::new(),
        Json::Array(items) => items.iter().map(id).collect::<Option<_>>().ok_or(MESSAGE)?,
        other => vec![id(other).ok_or(MESSAGE)?],
    };
    ids.dedup();
    if multiple {
        Ok(Json::Array(ids.into_iter().map(Json::from).collect()))
    } else if ids.len() > 1 {
        Err("this media field holds a single file".into())
    } else {
        Ok(ids.into_iter().next().map_or(Json::Null, Json::from))
    }
}

/// Every reference inside the value of a component or dynamic zone attribute.
pub(crate) fn collect(
    schema: &Schema,
    kind: &AttributeKind,
    value: &Json,
    path: &[Json],
) -> Vec<Reference> {
    let mut out = Vec::new();
    walk(schema, kind, value, path, &mut |attribute, value, path| {
        if let Some(target) = target_of(schema, attribute) {
            let values = match value {
                Json::Array(items) => items.clone(),
                Json::Null => Vec::new(),
                other => vec![other.clone()],
            };
            if !values.is_empty() {
                out.push(Reference { path: path.to_vec(), target, values });
            }
        }
    });
    out
}

fn target_of(schema: &Schema, attribute: &Attribute) -> Option<Target> {
    match &attribute.kind {
        AttributeKind::Relation { target, .. } => {
            schema.content_type(target).map(|target| Target::Documents { uid: target.uid.clone() })
        }
        AttributeKind::Media { allowed_types, .. } => {
            Some(Target::Files { allowed: allowed_types.clone() })
        }
        _ => None,
    }
}

/// Calls `visit` for every relation or media attribute value inside component items.
fn walk(
    schema: &Schema,
    kind: &AttributeKind,
    value: &Json,
    path: &[Json],
    visit: &mut dyn FnMut(&Attribute, &Json, &[Json]),
) {
    let item = |object: &Map<String, Json>,
                attributes: &IndexMap<String, Attribute>,
                path: &[Json],
                visit: &mut dyn FnMut(&Attribute, &Json, &[Json])| {
        for (name, attribute) in attributes {
            let Some(value) = object.get(name) else { continue };
            let mut child = path.to_vec();
            child.push(Json::from(name.as_str()));
            match &attribute.kind {
                AttributeKind::Relation { .. } | AttributeKind::Media { .. } => {
                    visit(attribute, value, &child)
                }
                AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. } => {
                    walk(schema, &attribute.kind, value, &child, visit)
                }
                _ => {}
            }
        }
    };
    match (kind, value) {
        (AttributeKind::Component { component, .. }, Json::Object(object)) => {
            if let Some(component) = schema.component(component) {
                item(object, &component.attributes, path, visit);
            }
        }
        (AttributeKind::Component { component, .. }, Json::Array(items)) => {
            if let Some(component) = schema.component(component) {
                for (index, value) in items.iter().enumerate() {
                    if let Json::Object(object) = value {
                        let mut child = path.to_vec();
                        child.push(Json::from(index));
                        item(object, &component.attributes, &child, visit);
                    }
                }
            }
        }
        (AttributeKind::DynamicZone { .. }, Json::Array(items)) => {
            for (index, value) in items.iter().enumerate() {
                let Json::Object(object) = value else { continue };
                let Some(component) = object
                    .get("__component")
                    .and_then(Json::as_str)
                    .and_then(|uid| schema.component(uid))
                else {
                    continue;
                };
                let mut child = path.to_vec();
                child.push(Json::from(index));
                item(object, &component.attributes, &child, visit);
            }
        }
        _ => {}
    }
}

/// Replaces references inside populated component values with the resolved documents and
/// files; `documents` and `files` map stored ids to their JSON (missing ids resolve to
/// nothing: the target was deleted or is not in the requested version).
pub(crate) fn substitute(
    schema: &Schema,
    kind: &AttributeKind,
    value: &mut Json,
    documents: &std::collections::HashMap<(String, String), Json>,
    files: &std::collections::HashMap<i64, Json>,
) {
    fn resolve(
        attribute: &Attribute,
        target: &Target,
        value: &Json,
        documents: &std::collections::HashMap<(String, String), Json>,
        files: &std::collections::HashMap<i64, Json>,
    ) -> Json {
        let one = |value: &Json| -> Option<Json> {
            match target {
                Target::Documents { uid } => value
                    .as_str()
                    .and_then(|id| documents.get(&(uid.clone(), id.to_owned())).cloned()),
                Target::Files { .. } => value.as_i64().and_then(|id| files.get(&id).cloned()),
            }
        };
        let many = match &attribute.kind {
            AttributeKind::Relation { relation, .. } => relation.is_to_many(),
            AttributeKind::Media { multiple, .. } => *multiple,
            _ => false,
        };
        match value {
            Json::Array(items) if many => Json::Array(items.iter().filter_map(one).collect()),
            other if !many => one(other).unwrap_or(Json::Null),
            _ => Json::Array(Vec::new()),
        }
    }

    fn walk_mut(
        schema: &Schema,
        kind: &AttributeKind,
        value: &mut Json,
        documents: &std::collections::HashMap<(String, String), Json>,
        files: &std::collections::HashMap<i64, Json>,
    ) {
        let item = |object: &mut Map<String, Json>, attributes: &IndexMap<String, Attribute>| {
            for (name, attribute) in attributes {
                let Some(value) = object.get_mut(name) else { continue };
                match &attribute.kind {
                    AttributeKind::Relation { .. } | AttributeKind::Media { .. } => {
                        if let Some(target) = target_of(schema, attribute) {
                            *value = resolve(attribute, &target, value, documents, files);
                        }
                    }
                    AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. } => {
                        walk_mut(schema, &attribute.kind, value, documents, files)
                    }
                    _ => {}
                }
            }
        };
        match (kind, value) {
            (AttributeKind::Component { component, .. }, Json::Object(object)) => {
                if let Some(component) = schema.component(component) {
                    item(object, &component.attributes);
                }
            }
            (AttributeKind::Component { component, .. }, Json::Array(items)) => {
                if let Some(component) = schema.component(component) {
                    for value in items {
                        if let Json::Object(object) = value {
                            item(object, &component.attributes);
                        }
                    }
                }
            }
            (AttributeKind::DynamicZone { .. }, Json::Array(items)) => {
                for value in items {
                    let Json::Object(object) = value else { continue };
                    let Some(component) = object
                        .get("__component")
                        .and_then(Json::as_str)
                        .and_then(|uid| schema.component(uid))
                    else {
                        continue;
                    };
                    item(object, &component.attributes);
                }
            }
            _ => {}
        }
    }
    walk_mut(schema, kind, value, documents, files);
}

/// A reference issue for `path`.
pub(crate) fn issue(path: &[Json], message: impl Into<String>) -> Issue {
    Issue::new(path.to_vec(), message)
}
