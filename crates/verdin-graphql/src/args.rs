//! GraphQL arguments and selections → the same parameter tree REST query strings parse to,
//! so both APIs share validation, filters, pagination and populate.

use async_graphql::SelectionField;
use async_graphql::{Name, Value};
use indexmap::IndexMap;
use verdin_query::{FieldCategory, Node, TypeFields};

use crate::Model;

/// Filter operators of the GraphQL inputs (`eq` → `$eq`).
pub const OPERATORS: &[&str] = &[
    "eq",
    "eqi",
    "ne",
    "nei",
    "lt",
    "lte",
    "gt",
    "gte",
    "in",
    "notIn",
    "contains",
    "notContains",
    "containsi",
    "notContainsi",
    "startsWith",
    "startsWithi",
    "endsWith",
    "endsWithi",
    "null",
    "notNull",
    "between",
];

fn leaf(value: &Value) -> Option<String> {
    Some(match value {
        Value::Null => return None,
        Value::String(text) => text.clone(),
        Value::Boolean(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::Enum(name) => name.to_string(),
        other => other.to_string(),
    })
}

fn list(items: &[Value], convert: impl Fn(&Value) -> Option<Node>) -> Node {
    Node::Map(
        items
            .iter()
            .filter_map(&convert)
            .enumerate()
            .map(|(index, node)| (index.to_string(), node))
            .collect(),
    )
}

/// `{ title: { containsi: "x" }, or: [..], category: { name: { eq: "News" } } }` →
/// `filters[title][$containsi]=x&filters[$or][0]…`.
pub fn filters(value: &Value) -> Option<Node> {
    let Value::Object(object) = value else { return None };
    let mut map = IndexMap::new();
    for (key, value) in object {
        let key = key.as_str();
        let node = match (key, value) {
            ("and" | "or", Value::List(items)) => list(items, filters),
            ("not", value) => match filters(value) {
                Some(node) => node,
                None => continue,
            },
            (operator, Value::List(items)) if OPERATORS.contains(&operator) => {
                list(items, |item| leaf(item).map(Node::Leaf))
            }
            (operator, value) if OPERATORS.contains(&operator) => match leaf(value) {
                Some(text) => Node::Leaf(text),
                None => continue,
            },
            (_, value @ Value::Object(_)) => match filters(value) {
                Some(node) => node,
                None => continue,
            },
            _ => continue,
        };
        let name = if OPERATORS.contains(&key) || matches!(key, "and" | "or" | "not") {
            format!("${key}")
        } else {
            key.to_owned()
        };
        map.insert(name, node);
    }
    Some(Node::Map(map))
}

/// Arguments shared by collection queries and to-many relations.
pub fn list_arguments(arguments: &[(Name, Value)], root: &mut IndexMap<String, Node>) {
    for (name, value) in arguments {
        match (name.as_str(), value) {
            ("filters", value) => {
                if let Some(node) = filters(value) {
                    root.insert("filters".into(), node);
                }
            }
            ("pagination", Value::Object(object)) => {
                let map: IndexMap<String, Node> = object
                    .iter()
                    .filter_map(|(key, value)| {
                        leaf(value).map(|text| (key.to_string(), Node::Leaf(text)))
                    })
                    .collect();
                root.insert("pagination".into(), Node::Map(map));
            }
            ("sort", Value::List(items)) => {
                root.insert("sort".into(), list(items, |item| leaf(item).map(Node::Leaf)));
            }
            ("sort", Value::String(text)) => {
                root.insert("sort".into(), Node::Leaf(text.clone()));
            }
            ("status", Value::Enum(status)) => {
                root.insert("status".into(), Node::Leaf(status.to_ascii_lowercase()));
            }
            _ => {}
        }
    }
}

/// `populate` for what the selection asks: relations (with their own arguments and
/// sub-selections), media, components and dynamic zones.
pub fn populate<'a>(
    model: &Model<'_>,
    fields: &TypeFields,
    selection: impl Iterator<Item = SelectionField<'a>>,
) -> Option<Node> {
    let mut map = IndexMap::new();
    for selected in selection {
        let name = selected.name();
        let Some(field) = fields.get(name) else { continue };
        match field.category {
            FieldCategory::Scalar => {}
            FieldCategory::Nested | FieldCategory::Media => {
                map.insert(name.to_owned(), Node::Leaf("true".into()));
            }
            FieldCategory::Relation => {
                let relation = field.relation.as_ref().expect("relation info");
                let Some(target) = model.catalog.get(&relation.target) else { continue };
                let mut sub = IndexMap::new();
                if let Ok(arguments) = selected.arguments() {
                    list_arguments(&arguments, &mut sub);
                }
                // Relation arguments never pick a status: related documents follow the parent.
                sub.shift_remove("status");
                if let Some(nested) = populate(model, target, selected.selection_set()) {
                    sub.insert("populate".into(), nested);
                }
                map.insert(
                    name.to_owned(),
                    if sub.is_empty() { Node::Leaf("true".into()) } else { Node::Map(sub) },
                );
            }
        }
    }
    if map.is_empty() { None } else { Some(Node::Map(map)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(json: serde_json::Value) -> Value {
        Value::from_json(json).unwrap()
    }

    fn render(node: &Node) -> String {
        match node {
            Node::Leaf(text) => text.clone(),
            Node::Map(map) => format!(
                "{{{}}}",
                map.iter().map(|(k, v)| format!("{k}:{}", render(v))).collect::<Vec<_>>().join(",")
            ),
        }
    }

    #[test]
    fn converts_filters() {
        let node = filters(&value(serde_json::json!({
            "title": { "containsi": "rust", "notIn": ["a", "b"] },
            "views": { "gt": 3, "null": false },
            "or": [{ "featured": { "eq": true } }, { "category": { "name": { "eq": "News" } } }],
            "not": { "slug": { "eq": null } }
        })))
        .unwrap();
        assert_eq!(
            render(&node),
            "{title:{$containsi:rust,$notIn:{0:a,1:b}},views:{$gt:3,$null:false},\
             $or:{0:{featured:{$eq:true}},1:{category:{name:{$eq:News}}}},$not:{slug:{}}}"
        );
    }
}
