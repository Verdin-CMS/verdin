//! `verdin types`: TypeScript definitions of the content API, generated from the schema.

use std::fmt::Write;

use verdin_schema::{Attribute, AttributeKind, ContentTypeKind, Schema};

/// `blog-post` → `BlogPost`, `shared.seo` → `SharedSeo`.
fn pascal(name: &str) -> String {
    name.split(['-', '_', '.'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect()
}

fn component_name(uid: &str) -> String {
    format!("Component{}", pascal(uid))
}

fn quote(text: &str) -> String {
    serde_json::to_string(text).expect("strings serialize")
}

/// A property name, quoted when it is not a plain identifier.
fn key(name: &str) -> String {
    let plain = name.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if plain { name.to_owned() } else { quote(name) }
}

fn target_name(schema: &Schema, target: &str) -> String {
    schema
        .content_type(target)
        .map(|target| pascal(&target.singular_name))
        .unwrap_or_else(|| "unknown".into())
}

/// `(type, optional)` of an attribute in API responses.
fn output(schema: &Schema, attribute: &Attribute) -> (String, bool) {
    use AttributeKind as A;
    let nullable =
        |ty: &str| if attribute.required { ty.to_owned() } else { format!("{ty} | null") };
    match &attribute.kind {
        A::String { .. }
        | A::Email { .. }
        | A::Text { .. }
        | A::RichText { .. }
        | A::Uid { .. } => (nullable("string"), false),
        // Big integers exceed JavaScript numbers: the API sends strings.
        A::BigInteger { .. } => (nullable("string"), false),
        A::Integer { .. } | A::Float { .. } | A::Decimal { .. } => (nullable("number"), false),
        A::Boolean => (nullable("boolean"), false),
        A::Date { .. } | A::Time { .. } | A::DateTime { .. } => (nullable("string"), false),
        A::Enumeration { values } => {
            let union: Vec<String> = values.iter().map(|value| quote(value)).collect();
            (nullable(&union.join(" | ")), false)
        }
        A::Json => ("unknown".into(), false),
        A::Blocks => (nullable("Blocks"), false),
        // Relations, media and components come only when populated.
        A::Relation { relation, target, .. } => {
            let target = target_name(schema, target);
            (
                if relation.is_to_many() {
                    format!("{target}[]")
                } else {
                    format!("{target} | null")
                },
                true,
            )
        }
        A::Media { multiple, .. } => {
            (if *multiple { "Media[]".into() } else { "Media | null".into() }, true)
        }
        A::Component { component, repeatable, .. } => {
            let name = component_name(component);
            (if *repeatable { format!("{name}[]") } else { format!("{name} | null") }, true)
        }
        A::DynamicZone { components, .. } => {
            let items: Vec<String> = components
                .iter()
                .map(|uid| format!("({} & {{ __component: {} }})", component_name(uid), quote(uid)))
                .collect();
            (format!("Array<{}>", items.join(" | ")), true)
        }
    }
}

/// Type of an attribute in writes (`data`).
fn input(schema: &Schema, attribute: &Attribute) -> Option<String> {
    use AttributeKind as A;
    Some(match &attribute.kind {
        A::Relation { mapped_by: Some(_), .. } => return None,
        A::Relation { relation, .. } if relation.is_to_many() => {
            "string[] | { connect?: Array<string | { documentId: string; position?: unknown }>; disconnect?: string[]; set?: string[] }".into()
        }
        A::Relation { .. } => "string | null".into(),
        A::Media { multiple: true, .. } => "number[]".into(),
        A::Media { .. } => "number | null".into(),
        A::Component { component, repeatable, .. } => {
            let name = format!("{}Input", component_name(component));
            if *repeatable { format!("{name}[]") } else { format!("{name} | null") }
        }
        A::DynamicZone { components, .. } => {
            let items: Vec<String> = components
                .iter()
                .map(|uid| format!("({}Input & {{ __component: {} }})", component_name(uid), quote(uid)))
                .collect();
            format!("Array<{}>", items.join(" | "))
        }
        _ => {
            let (ty, _) = output(schema, attribute);
            if ty.ends_with(" | null") || ty == "unknown" { ty } else { format!("{ty} | null") }
        }
    })
}

/// Component attributes inside JSON: relations hold documentIds and media file ids on write.
fn component_input(schema: &Schema, attribute: &Attribute) -> Option<String> {
    match &attribute.kind {
        AttributeKind::Relation { relation, .. } => {
            Some(if relation.is_to_many() { "string[]".into() } else { "string | null".into() })
        }
        _ => input(schema, attribute),
    }
}

const PRELUDE: &str = r#"// Generated by `verdin types`. Do not edit: run `verdin types` again after schema changes.

/** A media library file. */
export interface Media {
  id: number;
  documentId: string;
  name: string;
  alternativeText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  focalPoint: { x: number; y: number } | null;
  formats: Record<string, MediaFormat> | null;
  hash: string;
  ext: string;
  mime: string;
  /** Kilobytes. */
  size: number;
  url: string;
  previewUrl: string | null;
  provider: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
}

export interface MediaFormat {
  name: string;
  hash: string;
  ext: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  sizeInBytes: number;
  url: string;
}

/** Rich text in Strapi's blocks format. */
export type Blocks = Block[];
export type Block =
  | { type: 'paragraph' | 'quote'; children: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: 'code'; language?: string | null; children: InlineNode[] }
  | { type: 'list'; format: 'ordered' | 'unordered'; children: Array<ListItem | Extract<Block, { type: 'list' }>> }
  | { type: 'image'; image: Pick<Media, 'url'> & Partial<Media>; children: InlineNode[] };
export interface ListItem {
  type: 'list-item';
  children: InlineNode[];
}
export type InlineNode = TextNode | { type: 'link'; url: string; children: TextNode[] };
export interface TextNode {
  type: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}

/** Fields every document has. */
export interface DocumentBase {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
"#;

pub fn generate(schema: &Schema) -> String {
    let mut out = String::from(PRELUDE);

    for component in schema.components.values() {
        let name = component_name(&component.uid);
        let _ = writeln!(
            out,
            "\n/** Component `{}`. */\nexport interface {name} {{\n  id: number;",
            component.uid
        );
        for (field, attribute) in &component.attributes {
            let (ty, optional) = output(schema, attribute);
            let _ = writeln!(out, "  {}{}: {ty};", key(field), if optional { "?" } else { "" });
        }
        let _ = writeln!(out, "}}\nexport interface {name}Input {{\n  id?: number;");
        for (field, attribute) in &component.attributes {
            if let Some(ty) = component_input(schema, attribute) {
                let _ = writeln!(out, "  {}?: {ty};", key(field));
            }
        }
        out.push_str("}\n");
    }

    let mut collections = Vec::new();
    let mut singles = Vec::new();
    for content_type in schema.content_types.values() {
        let name = pascal(&content_type.singular_name);
        let description =
            content_type.description.as_deref().map(|text| format!(" {text}")).unwrap_or_default();
        let _ = writeln!(
            out,
            "\n/** `{}` ({}).{description} */\nexport interface {name} extends DocumentBase {{",
            content_type.uid,
            if content_type.kind == ContentTypeKind::SingleType {
                "single type"
            } else {
                "collection"
            },
        );
        for (field, attribute) in &content_type.attributes {
            if attribute.private {
                continue;
            }
            let (ty, optional) = output(schema, attribute);
            let _ = writeln!(out, "  {}{}: {ty};", key(field), if optional { "?" } else { "" });
        }
        let _ = writeln!(out, "}}\nexport interface {name}Input {{");
        for (field, attribute) in &content_type.attributes {
            if let Some(ty) = input(schema, attribute) {
                let _ = writeln!(out, "  {}?: {ty};", key(field));
            }
        }
        out.push_str("}\n");
        match content_type.kind {
            ContentTypeKind::CollectionType => {
                collections.push((content_type.plural_name.clone(), name))
            }
            ContentTypeKind::SingleType => singles.push((content_type.singular_name.clone(), name)),
        }
    }

    out.push_str("\n/** Collection routes (`/api/{route}`) and their documents, for `@verdin/client`. */\nexport interface Collections {\n");
    for (route, name) in &collections {
        let _ = writeln!(out, "  {}: {{ document: {name}; input: {name}Input }};", key(route));
    }
    out.push_str("}\n\n/** Single type routes. */\nexport interface Singles {\n");
    for (route, name) in &singles {
        let _ = writeln!(out, "  {}: {{ document: {name}; input: {name}Input }};", key(route));
    }
    out.push_str("}\n\nexport interface VerdinSchema {\n  collections: Collections;\n  singles: Singles;\n}\n");
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use verdin_schema::Source;

    use super::*;

    #[test]
    fn generates_types() {
        let schema = Schema::parse(&[
            Source::content_type(
                "blog-post",
                json!({ "kind": "collectionType", "singularName": "blog-post", "pluralName": "blog-posts", "displayName": "Post",
                        "attributes": {
                            "title": { "type": "string", "required": true },
                            "status": { "type": "enumeration", "enum": ["draft", "live"] },
                            "views": { "type": "biginteger" },
                            "body": { "type": "blocks" },
                            "cover": { "type": "media" },
                            "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
                            "seo": { "type": "component", "component": "shared.seo" },
                            "secret": { "type": "string", "private": true }
                        } })
                .to_string(),
            ),
            Source::content_type(
                "tag",
                json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags", "displayName": "Tag",
                        "attributes": { "label": { "type": "string" } } })
                .to_string(),
            ),
            Source::component("shared", "seo", json!({ "displayName": "Seo", "attributes": { "metaTitle": { "type": "string" } } }).to_string()),
        ])
        .unwrap();
        let ts = generate(&schema);
        for expected in [
            "export interface BlogPost extends DocumentBase {",
            "  title: string;",
            "  status: \"draft\" | \"live\" | null;",
            "  views: string | null;",
            "  body: Blocks | null;",
            "  cover?: Media | null;",
            "  tags?: Tag[];",
            "  seo?: ComponentSharedSeo | null;",
            "export interface ComponentSharedSeo {",
            "  \"blog-posts\": { document: BlogPost; input: BlogPostInput };",
            "  tags?: string[] | { connect?:",
        ] {
            assert!(ts.contains(expected), "missing `{expected}` in:\n{ts}");
        }
        assert!(!ts.contains("secret: string"), "private fields are not returned");
        assert!(ts.contains("  secret?: string | null;"), "but they can be written");
    }
}
