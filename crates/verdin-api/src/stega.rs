//! Visual editing: content source maps hidden in text ("stega"). Reads that send
//! `X-Verdin-Stega: true` with a token get, after every string, string-like text,
//! rich text and block text, an invisible suffix naming where to edit it in the admin.
//! The overlay script (`visual-editing.js`) finds them on the page.
//!
//! Encoding: U+2064, then each UTF-8 byte of `{"origin":"verdin","href":"…"}` as four
//! base-4 digits (most significant first) written with U+200B, U+200C, U+200D and
//! U+2060, then U+2063.

use serde_json::{Value as Json, json};
use verdin_schema::{AttributeKind, Schema};

pub const START: char = '\u{2064}';
pub const END: char = '\u{2063}';
const DIGITS: [char; 4] = ['\u{200b}', '\u{200c}', '\u{200d}', '\u{2060}'];
/// The request header that asks for it.
pub const HEADER: &str = "x-verdin-stega";

/// The invisible form of `payload`.
pub fn encode(payload: &Json) -> String {
    let text = payload.to_string();
    let mut out = String::with_capacity(text.len() * 4 + 2);
    out.push(START);
    for byte in text.bytes() {
        for shift in [6, 4, 2, 0] {
            out.push(DIGITS[usize::from((byte >> shift) & 3)]);
        }
    }
    out.push(END);
    out
}

/// The payloads hidden in `text` (for tests and tools).
pub fn decode(text: &str) -> Vec<Json> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(START) {
        rest = &rest[start + START.len_utf8()..];
        let Some(end) = rest.find(END) else { break };
        let digits: Vec<u8> = rest[..end]
            .chars()
            .filter_map(|c| DIGITS.iter().position(|d| *d == c).map(|d| d as u8))
            .collect();
        let bytes: Vec<u8> = digits
            .chunks(4)
            .filter(|chunk| chunk.len() == 4)
            .map(|c| c[0] << 6 | c[1] << 4 | c[2] << 2 | c[3])
            .collect();
        if let Ok(value) = serde_json::from_slice(&bytes) {
            found.push(value);
        }
        rest = &rest[end + END.len_utf8()..];
    }
    found
}

/// Text without its hidden payloads.
pub fn strip(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut hidden = false;
    for c in text.chars() {
        match c {
            START => hidden = true,
            END => hidden = false,
            _ if hidden => {}
            c => out.push(c),
        }
    }
    out
}

/// Where a value is edited.
struct Place<'a> {
    admin: &'a str,
    uid: &'a str,
    document_id: &'a str,
    locale: Option<&'a str>,
}

impl Place<'_> {
    fn mark(&self, text: &mut String, field: &str) {
        let mut href = format!("{}/content/{}/{}", self.admin, self.uid, self.document_id);
        let mut query = Vec::new();
        if let Some(locale) = self.locale {
            query.push(format!("locale={locale}"));
        }
        query.push(format!("field={field}"));
        href.push('?');
        href.push_str(&query.join("&"));
        text.push_str(&encode(&json!({ "origin": "verdin", "href": href })));
    }
}

/// Marks the text of a response's documents of `uid` (`data`: one document or a list).
pub fn mark_response(schema: &Schema, uid: &str, data: &mut Json, admin: &str) {
    match data {
        Json::Array(items) => {
            for item in items {
                mark_document(schema, uid, item, admin);
            }
        }
        Json::Object(_) => mark_document(schema, uid, data, admin),
        _ => {}
    }
}

fn mark_document(schema: &Schema, uid: &str, document: &mut Json, admin: &str) {
    let Some(content_type) = schema.content_type(uid) else { return };
    let Some(document_id) = document.get("documentId").and_then(Json::as_str).map(str::to_owned)
    else {
        return;
    };
    let locale = document.get("locale").and_then(Json::as_str).map(str::to_owned);
    let place = Place { admin, uid, document_id: &document_id, locale: locale.as_deref() };
    mark_attributes(schema, &content_type.attributes, document, &place, "");
}

fn mark_attributes(
    schema: &Schema,
    attributes: &indexmap::IndexMap<String, verdin_schema::Attribute>,
    object: &mut Json,
    place: &Place<'_>,
    prefix: &str,
) {
    let Json::Object(map) = object else { return };
    for (name, attribute) in attributes {
        let Some(value) = map.get_mut(name) else { continue };
        let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}.{name}") };
        match &attribute.kind {
            AttributeKind::String { .. }
            | AttributeKind::Text { .. }
            | AttributeKind::RichText { .. } => {
                if let Json::String(text) = value
                    && !text.is_empty()
                {
                    place.mark(text, &path);
                }
            }
            AttributeKind::Blocks => mark_blocks(value, place, &path),
            AttributeKind::Component { component, .. } => {
                let Some(component) = schema.component(component) else { continue };
                match value {
                    Json::Array(items) => {
                        for (index, item) in items.iter_mut().enumerate() {
                            mark_attributes(
                                schema,
                                &component.attributes,
                                item,
                                place,
                                &format!("{path}.{index}"),
                            );
                        }
                    }
                    item => mark_attributes(schema, &component.attributes, item, place, &path),
                }
            }
            AttributeKind::DynamicZone { .. } => {
                if let Json::Array(items) = value {
                    for (index, item) in items.iter_mut().enumerate() {
                        let component = item
                            .get("__component")
                            .and_then(Json::as_str)
                            .and_then(|uid| schema.component(uid));
                        if let Some(component) = component {
                            mark_attributes(
                                schema,
                                &component.attributes,
                                item,
                                place,
                                &format!("{path}.{index}"),
                            );
                        }
                    }
                }
            }
            AttributeKind::Relation { target, .. } => {
                if let Some(target) = schema.content_type(target) {
                    mark_response(schema, &target.uid, value, place.admin);
                }
            }
            _ => {}
        }
    }
}

/// The first text of each block (a paragraph, heading, list item…).
fn mark_blocks(value: &mut Json, place: &Place<'_>, path: &str) {
    fn first_text(node: &mut Json) -> Option<&mut String> {
        if node.get("type").and_then(Json::as_str) == Some("text") {
            return match node.get_mut("text") {
                Some(Json::String(text)) if !text.is_empty() => Some(text),
                _ => None,
            };
        }
        node.get_mut("children")?.as_array_mut()?.iter_mut().find_map(first_text)
    }
    let Json::Array(blocks) = value else { return };
    for (index, block) in blocks.iter_mut().enumerate() {
        if let Some(text) = first_text(block) {
            place.mark(text, &format!("{path}.{index}"));
        }
    }
}

/// The overlay: outlines marked text on hover and opens the field in the admin (or asks
/// the admin's preview frame to focus it).
pub const OVERLAY: &str = r#"(() => {
  const START = '\u2064', END = '\u2063', DIGITS = ['\u200b', '\u200c', '\u200d', '\u2060'];
  const decode = (text) => {
    const found = [];
    let from = 0;
    for (;;) {
      const start = text.indexOf(START, from);
      if (start < 0) break;
      const end = text.indexOf(END, start + 1);
      if (end < 0) break;
      const digits = [...text.slice(start + 1, end)].map((c) => DIGITS.indexOf(c)).filter((d) => d >= 0);
      const bytes = new Uint8Array(Math.floor(digits.length / 4));
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (digits[i * 4] << 6) | (digits[i * 4 + 1] << 4) | (digits[i * 4 + 2] << 2) | digits[i * 4 + 3];
      }
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if (value && value.origin === 'verdin' && typeof value.href === 'string') found.push(value);
      } catch (_) {}
      from = end + 1;
    }
    return found;
  };
  const marked = new WeakMap();
  const scan = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.includes(START) || !node.parentElement) continue;
      const [payload] = decode(node.data);
      if (payload) marked.set(node.parentElement, payload);
    }
    for (const element of root.querySelectorAll ? root.querySelectorAll('[alt],[title]') : []) {
      for (const attribute of ['alt', 'title']) {
        const [payload] = decode(element.getAttribute(attribute) || '');
        if (payload) marked.set(element, payload);
      }
    }
  };
  const box = document.createElement('div');
  const button = document.createElement('button');
  button.textContent = 'Edit';
  box.style.cssText = 'position:fixed;pointer-events:none;outline:2px solid #16a34a;border-radius:4px;z-index:2147483646;display:none';
  button.style.cssText = 'position:fixed;z-index:2147483647;display:none;font:600 12px system-ui;padding:2px 8px;border:0;border-radius:4px;background:#16a34a;color:#fff;cursor:pointer';
  let current = null;
  const open = (payload) => {
    const url = new URL(payload.href);
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'verdin:edit', href: payload.href }, url.origin);
    } else {
      window.open(payload.href, '_blank', 'noopener');
    }
  };
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (current) open(current);
  });
  document.addEventListener('mouseover', (event) => {
    let element = event.target;
    while (element && element !== document.body && !marked.has(element)) element = element.parentElement;
    if (!element || !marked.has(element)) return;
    current = marked.get(element);
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: rect.left - 2 + 'px', top: rect.top - 2 + 'px', width: rect.width + 4 + 'px', height: rect.height + 4 + 'px' });
    Object.assign(button.style, { display: 'block', left: Math.max(rect.right - 44, 0) + 'px', top: Math.max(rect.top - 22, 0) + 'px' });
  });
  const start = () => {
    document.body.append(box, button);
    scan(document.body);
    new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) scan(node.nodeType === 1 ? node : node.parentNode || document.body);
        if (change.type === 'characterData' && change.target.parentNode) scan(change.target.parentNode);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_strips() {
        let payload = json!({ "origin": "verdin", "href": "https://cms.test/admin/content/api::article/x?field=título" });
        let text = format!("Hello{}", encode(&payload));
        assert_eq!(decode(&text), [payload]);
        assert_eq!(strip(&text), "Hello");
        assert!(text.chars().skip(5).all(|c| c == START || c == END || DIGITS.contains(&c)));
    }

    #[test]
    fn marks_documents_components_and_relations() {
        let schema = Schema::parse(&[
            verdin_schema::Source::content_type(
                "article",
                json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                        "displayName": "Article", "attributes": {
                            "title": { "type": "string" }, "slug": { "type": "uid" },
                            "seo": { "type": "component", "component": "shared.seo" },
                            "author": { "type": "relation", "relation": "manyToOne", "target": "author" },
                            "body": { "type": "blocks" } } })
                .to_string(),
            ),
            verdin_schema::Source::content_type(
                "author",
                json!({ "kind": "collectionType", "singularName": "author", "pluralName": "authors",
                        "displayName": "Author", "attributes": { "name": { "type": "string" } } })
                .to_string(),
            ),
            verdin_schema::Source::component(
                "shared",
                "seo",
                json!({ "displayName": "SEO", "attributes": { "metaTitle": { "type": "string" } } }).to_string(),
            ),
        ])
        .unwrap();
        let mut data = json!([{
            "documentId": "a1", "title": "Hi", "slug": "hi",
            "seo": { "id": 1, "metaTitle": "Meta" },
            "author": { "documentId": "b2", "name": "Ada" },
            "body": [{ "type": "paragraph", "children": [{ "type": "text", "text": "Para" }] }]
        }]);
        mark_response(&schema, "api::article", &mut data, "https://cms.test/admin");
        let href =
            |value: &Json| decode(value.as_str().unwrap())[0]["href"].as_str().unwrap().to_owned();
        assert_eq!(
            href(&data[0]["title"]),
            "https://cms.test/admin/content/api::article/a1?field=title"
        );
        assert_eq!(data[0]["slug"], "hi", "identifiers stay clean");
        assert!(href(&data[0]["seo"]["metaTitle"]).ends_with("field=seo.metaTitle"));
        assert_eq!(
            href(&data[0]["author"]["name"]),
            "https://cms.test/admin/content/api::author/b2?field=name"
        );
        assert!(href(&data[0]["body"][0]["children"][0]["text"]).ends_with("field=body.0"));
    }
}
