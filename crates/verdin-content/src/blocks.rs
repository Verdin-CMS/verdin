//! Validation of Strapi's `blocks` rich text JSON:
//!
//! ```json
//! [
//!   { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hi" }] },
//!   { "type": "paragraph", "children": [
//!       { "type": "text", "text": "bold", "bold": true },
//!       { "type": "link", "url": "https://…", "children": [{ "type": "text", "text": "a link" }] } ] },
//!   { "type": "list", "format": "unordered", "children": [
//!       { "type": "list-item", "children": [{ "type": "text", "text": "one" }] } ] },
//!   { "type": "quote", "children": […] },
//!   { "type": "code", "language": "rust", "children": [{ "type": "text", "text": "fn main() {}" }] },
//!   { "type": "image", "image": { "url": "/uploads/…", "alternativeText": "…", … }, "children": [{ "type": "text", "text": "" }] }
//! ]
//! ```

use serde_json::{Map, Value as Json};

use crate::Issue;

const MAX_BLOCKS: usize = 10_000;
const MAX_DEPTH: usize = 8;
const MARKS: &[&str] = &["bold", "italic", "underline", "strikethrough", "code"];

pub fn validate(value: &Json, path: &[Json]) -> Result<(), Vec<Issue>> {
    let Some(blocks) = value.as_array() else {
        return Err(vec![Issue::new(path.to_vec(), "must be a list of blocks")]);
    };
    if blocks.len() > MAX_BLOCKS {
        return Err(vec![Issue::new(path.to_vec(), format!("at most {MAX_BLOCKS} blocks"))]);
    }
    let mut issues = Vec::new();
    for (index, block) in blocks.iter().enumerate() {
        block_node(block, &child(path, index), 0, &mut issues);
    }
    if issues.is_empty() { Ok(()) } else { Err(issues) }
}

fn child(path: &[Json], key: impl Into<Json>) -> Vec<Json> {
    let mut path = path.to_vec();
    path.push(key.into());
    path
}

fn as_object<'a>(
    node: &'a Json,
    path: &[Json],
    issues: &mut Vec<Issue>,
) -> Option<&'a Map<String, Json>> {
    let object = node.as_object();
    if object.is_none() {
        issues.push(Issue::new(path.to_vec(), "must be an object"));
    }
    object
}

fn block_node(node: &Json, path: &[Json], depth: usize, issues: &mut Vec<Issue>) {
    let Some(object) = as_object(node, path, issues) else { return };
    let kind = object.get("type").and_then(Json::as_str).unwrap_or_default();
    match kind {
        "paragraph" | "quote" => inline_children(object, path, depth, issues),
        "heading" => {
            let level = object.get("level").and_then(Json::as_u64);
            if !level.is_some_and(|level| (1..=6).contains(&level)) {
                issues.push(Issue::new(child(path, "level"), "must be 1 to 6"));
            }
            inline_children(object, path, depth, issues);
        }
        "code" => {
            if object
                .get("language")
                .is_some_and(|language| !language.is_string() && !language.is_null())
            {
                issues.push(Issue::new(child(path, "language"), "must be a string"));
            }
            inline_children(object, path, depth, issues);
        }
        "list" => {
            let format = object.get("format").and_then(Json::as_str);
            if !matches!(format, Some("ordered" | "unordered")) {
                issues.push(Issue::new(child(path, "format"), "must be `ordered` or `unordered`"));
            }
            let Some(children) = children(object, path, issues) else { return };
            for (index, item) in children.iter().enumerate() {
                let item_path = child(&child(path, "children"), index);
                let Some(item_object) = as_object(item, &item_path, issues) else { continue };
                match item_object.get("type").and_then(Json::as_str) {
                    Some("list-item") => {
                        inline_children(item_object, &item_path, depth + 1, issues)
                    }
                    // Nested lists.
                    Some("list") if depth < MAX_DEPTH => {
                        block_node(item, &item_path, depth + 1, issues)
                    }
                    _ => issues.push(Issue::new(
                        child(&item_path, "type"),
                        "must be `list-item` or `list`",
                    )),
                }
            }
        }
        "image" => {
            let url = object.get("image").and_then(|image| image.get("url")).and_then(Json::as_str);
            if url.is_none_or(str::is_empty) {
                issues.push(Issue::new(child(path, "image"), "needs an image with a url"));
            }
        }
        "" => issues.push(Issue::new(child(path, "type"), "is required")),
        other => {
            issues.push(Issue::new(child(path, "type"), format!("unknown block type `{other}`")))
        }
    }
}

fn children<'a>(
    object: &'a Map<String, Json>,
    path: &[Json],
    issues: &mut Vec<Issue>,
) -> Option<&'a Vec<Json>> {
    let children = object.get("children").and_then(Json::as_array);
    if children.is_none() {
        issues.push(Issue::new(child(path, "children"), "must be a list"));
    }
    children
}

fn inline_children(
    object: &Map<String, Json>,
    path: &[Json],
    depth: usize,
    issues: &mut Vec<Issue>,
) {
    let Some(children) = children(object, path, issues) else { return };
    for (index, node) in children.iter().enumerate() {
        inline_node(node, &child(&child(path, "children"), index), depth, issues);
    }
}

fn inline_node(node: &Json, path: &[Json], depth: usize, issues: &mut Vec<Issue>) {
    let Some(object) = as_object(node, path, issues) else { return };
    match object.get("type").and_then(Json::as_str) {
        Some("text") => {
            if !object.get("text").is_some_and(Json::is_string) {
                issues.push(Issue::new(child(path, "text"), "must be a string"));
            }
            for mark in MARKS {
                if object.get(*mark).is_some_and(|value| !value.is_boolean()) {
                    issues.push(Issue::new(child(path, *mark), "must be a boolean"));
                }
            }
        }
        Some("link") if depth < MAX_DEPTH => {
            let url = object.get("url").and_then(Json::as_str).unwrap_or_default();
            if !safe_url(url) {
                issues.push(Issue::new(
                    child(path, "url"),
                    "must be an http(s), mailto, tel or relative URL",
                ));
            }
            inline_children(object, path, depth + 1, issues);
        }
        _ => issues.push(Issue::new(child(path, "type"), "must be `text` or `link`")),
    }
}

/// Links may not run script (`javascript:`, `data:`…) when a frontend renders them.
fn safe_url(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return false;
    }
    match url.split_once(':') {
        Some((scheme, _))
            if !scheme.contains('/') && !scheme.contains('?') && !scheme.contains('#') =>
        {
            matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https" | "mailto" | "tel")
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn messages(value: Json) -> Vec<String> {
        match validate(&value, &[json!("body")]) {
            Ok(()) => Vec::new(),
            Err(issues) => issues
                .into_iter()
                .map(|issue| {
                    let path: Vec<String> = issue
                        .path
                        .iter()
                        .map(|part| part.as_str().map_or_else(|| part.to_string(), str::to_owned))
                        .collect();
                    format!("{}: {}", path.join("."), issue.message)
                })
                .collect(),
        }
    }

    #[test]
    fn accepts_strapi_blocks() {
        let blocks = json!([
            { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Title" }] },
            { "type": "paragraph", "children": [
                { "type": "text", "text": "bold", "bold": true, "italic": false },
                { "type": "link", "url": "https://verdin.dev", "children": [{ "type": "text", "text": "site" }] },
                { "type": "link", "url": "/about", "children": [{ "type": "text", "text": "about" }] }
            ] },
            { "type": "list", "format": "ordered", "children": [
                { "type": "list-item", "children": [{ "type": "text", "text": "one" }] },
                { "type": "list", "format": "unordered", "children": [
                    { "type": "list-item", "children": [{ "type": "text", "text": "nested" }] } ] }
            ] },
            { "type": "quote", "children": [{ "type": "text", "text": "q" }] },
            { "type": "code", "language": "rust", "children": [{ "type": "text", "text": "fn main() {}" }] },
            { "type": "image", "image": { "url": "/uploads/a.png", "alternativeText": "A" }, "children": [{ "type": "text", "text": "" }] }
        ]);
        assert_eq!(messages(blocks), Vec::<String>::new());
    }

    #[test]
    fn rejects_malformed_and_unsafe_blocks() {
        let found = messages(json!([
            { "type": "heading", "level": 9, "children": [] },
            { "type": "paragraph", "children": [{ "type": "link", "url": "javascript:alert(1)", "children": [] }] },
            { "type": "paragraph", "children": [{ "type": "text", "text": 3, "bold": "yes" }] },
            { "type": "video" },
            { "type": "list", "format": "bullets", "children": [{ "type": "paragraph" }] },
            { "type": "image", "image": {} },
            "text"
        ]));
        assert_eq!(found.len(), 9, "{found:#?}");
        assert!(found.iter().any(|m| m.contains("javascript") || m.contains("url")), "{found:#?}");
        assert_eq!(messages(json!({ "type": "paragraph" })), ["body: must be a list of blocks"]);
    }
}
