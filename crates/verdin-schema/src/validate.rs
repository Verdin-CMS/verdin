//! Whole-schema parsing and cross-reference validation.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use indexmap::IndexMap;

use crate::convert::convert_attribute;
use crate::model::*;
use crate::naming::{self, MAX_ATTRIBUTE_NAME, MAX_TABLE_NAME};
use crate::raw::{RawAttribute, RawComponent, RawContentType};
use crate::{SchemaError, SchemaErrors, Source, SourceKind};

/// Attribute names reserved on content types because the API or system columns use them.
pub const RESERVED_CONTENT_TYPE_ATTRIBUTES: &[&str] = &[
    "id",
    "documentId",
    "locale",
    "publicationState",
    "publishedAt",
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy",
];

/// Content type names that would collide with API routes (`/api/upload`…).
pub const RESERVED_ROUTE_NAMES: &[&str] = &["upload", "uploads"];

/// Attribute names reserved on components (each stored component item carries an `id`).
pub const RESERVED_COMPONENT_ATTRIBUTES: &[&str] = &["id"];

/// Upper bound of `varchar(255)` attributes per content type. At 1,020 bytes each (utf8mb4),
/// this keeps rows under MySQL's 65,535-byte limit together with system columns.
pub const MAX_VARCHAR_ATTRIBUTES: usize = 60;

const SYSTEM_TABLE_PREFIX: &str = "vd_";

#[derive(Default)]
struct Report {
    errors: Vec<SchemaError>,
}

impl Report {
    fn push(&mut self, file: &Path, path: impl Into<String>, message: impl Into<String>) {
        self.errors.push(SchemaError {
            file: file.to_path_buf(),
            path: path.into(),
            message: message.into(),
        });
    }
}

pub fn parse(sources: &[Source]) -> Result<Schema, SchemaErrors> {
    let mut report = Report::default();
    let mut schema = Schema::default();
    // Where each type came from, for error reporting in cross-checks.
    let mut files: HashMap<String, PathBuf> = HashMap::new();

    for source in sources {
        match &source.kind {
            SourceKind::ContentType => {
                if let Some(content_type) = parse_content_type(source, &mut report) {
                    if schema.content_types.contains_key(&content_type.uid) {
                        report.push(
                            &source.path,
                            "",
                            format!("duplicate content type `{}`", content_type.uid),
                        );
                        continue;
                    }
                    files.insert(content_type.uid.clone(), source.path.clone());
                    schema.content_types.insert(content_type.uid.clone(), content_type);
                }
            }
            SourceKind::Component { category } => {
                if let Some(component) = parse_component(source, category, &mut report) {
                    files.insert(component.uid.clone(), source.path.clone());
                    schema.components.insert(component.uid.clone(), component);
                }
            }
        }
    }

    check_content_type_names(&schema, &files, &mut report);
    for content_type in schema.content_types.values() {
        check_attributes(
            &schema,
            &content_type.uid,
            &content_type.attributes,
            false,
            &files[&content_type.uid],
            &mut report,
        );
    }
    for component in schema.components.values() {
        check_attributes(
            &schema,
            &component.uid,
            &component.attributes,
            true,
            &files[&component.uid],
            &mut report,
        );
    }
    check_component_cycles(&schema, &files, &mut report);

    if report.errors.is_empty() { Ok(schema) } else { Err(SchemaErrors(report.errors)) }
}

fn parse_content_type(source: &Source, report: &mut Report) -> Option<ContentType> {
    let file = &source.path;
    let raw: RawContentType = match serde_json::from_str(&source.text) {
        Ok(raw) => raw,
        Err(error) => {
            report.push(file, "", format!("invalid JSON: {error}"));
            return None;
        }
    };

    let kind = match raw.kind.as_str() {
        "collectionType" => ContentTypeKind::CollectionType,
        "singleType" => ContentTypeKind::SingleType,
        other => {
            report.push(
                file,
                "kind",
                format!("must be `collectionType` or `singleType`, got `{other}`"),
            );
            ContentTypeKind::CollectionType
        }
    };
    for (field, value) in [("singularName", &raw.singular_name), ("pluralName", &raw.plural_name)] {
        if !naming::is_kebab_name(value) {
            report.push(
                file,
                field,
                "must be kebab-case: lowercase letters, digits and single dashes",
            );
        }
    }
    if raw.singular_name == raw.plural_name {
        report.push(file, "pluralName", "must differ from singularName");
    }
    if raw.singular_name != source.name {
        report.push(
            file,
            "singularName",
            format!("must match the file name `{}.json`", source.name),
        );
    }
    if raw.display_name.trim().is_empty() {
        report.push(file, "displayName", "must not be empty");
    }

    let collection_name =
        raw.collection_name.clone().unwrap_or_else(|| naming::kebab_to_snake(&raw.plural_name));
    if !naming::is_snake_identifier(&collection_name) {
        report.push(
            file,
            "collectionName",
            "must be snake_case: lowercase letters, digits and underscores",
        );
    } else if collection_name.len() > MAX_TABLE_NAME {
        report.push(file, "collectionName", format!("must be at most {MAX_TABLE_NAME} characters"));
    } else if collection_name.starts_with(SYSTEM_TABLE_PREFIX) {
        report.push(
            file,
            "collectionName",
            format!("`{SYSTEM_TABLE_PREFIX}` is reserved for system tables"),
        );
    }

    // Routes of the content API that are not content types.
    for (field, name) in [("singularName", &raw.singular_name), ("pluralName", &raw.plural_name)] {
        if RESERVED_ROUTE_NAMES.contains(&name.as_str()) {
            report.push(file, field, format!("`{name}` is reserved by the API"));
        }
    }

    let attributes = convert_attributes(raw.attributes, file, report);

    Some(ContentType {
        uid: format!("api::{}", raw.singular_name),
        kind,
        singular_name: raw.singular_name,
        plural_name: raw.plural_name,
        display_name: raw.display_name,
        description: raw.description,
        collection_name,
        draft_and_publish: raw.options.draft_and_publish.unwrap_or(false),
        localized: crate::raw::RawPluginOptions::localized(&raw.plugin_options).unwrap_or(false),
        attributes,
    })
}

fn parse_component(source: &Source, category: &str, report: &mut Report) -> Option<Component> {
    let file = &source.path;
    if !naming::is_kebab_name(category) {
        report.push(file, "", format!("component category `{category}` must be kebab-case"));
    }
    if !naming::is_kebab_name(&source.name) {
        report.push(file, "", format!("component name `{}` must be kebab-case", source.name));
    }
    let raw: RawComponent = match serde_json::from_str(&source.text) {
        Ok(raw) => raw,
        Err(error) => {
            report.push(file, "", format!("invalid JSON: {error}"));
            return None;
        }
    };
    if raw.display_name.trim().is_empty() {
        report.push(file, "displayName", "must not be empty");
    }
    let attributes = convert_attributes(raw.attributes, file, report);
    Some(Component {
        uid: format!("{category}.{}", source.name),
        category: category.into(),
        name: source.name.clone(),
        display_name: raw.display_name,
        description: raw.description,
        icon: raw.icon,
        attributes,
    })
}

fn convert_attributes(
    raw: IndexMap<String, RawAttribute>,
    file: &Path,
    report: &mut Report,
) -> IndexMap<String, Attribute> {
    let mut attributes = IndexMap::with_capacity(raw.len());
    for (name, raw) in raw {
        match convert_attribute(raw) {
            Ok(attribute) => {
                attributes.insert(name, attribute);
            }
            Err(issues) => {
                for (path, message) in issues {
                    report.push(file, format!("attributes.{name}.{path}"), message);
                }
            }
        }
    }
    attributes
}

fn check_content_type_names(
    schema: &Schema,
    files: &HashMap<String, PathBuf>,
    report: &mut Report,
) {
    // Singular and plural names share one namespace: both become API routes.
    let mut route_names: BTreeMap<&str, &str> = BTreeMap::new();
    let mut tables: BTreeMap<&str, &str> = BTreeMap::new();
    for content_type in schema.content_types.values() {
        let file = &files[&content_type.uid];
        for (field, name) in [
            ("singularName", &content_type.singular_name),
            ("pluralName", &content_type.plural_name),
        ] {
            if let Some(other) = route_names.insert(name, &content_type.uid)
                && other != content_type.uid
            {
                report.push(file, field, format!("`{name}` is already used by `{other}`"));
            }
        }
        if let Some(other) = tables.insert(&content_type.collection_name, &content_type.uid) {
            report.push(
                file,
                "collectionName",
                format!("table `{}` is already used by `{other}`", content_type.collection_name),
            );
        }
    }
}

fn check_attributes(
    schema: &Schema,
    owner_uid: &str,
    attributes: &IndexMap<String, Attribute>,
    in_component: bool,
    file: &Path,
    report: &mut Report,
) {
    let reserved =
        if in_component { RESERVED_COMPONENT_ATTRIBUTES } else { RESERVED_CONTENT_TYPE_ATTRIBUTES };
    let reserved_columns: BTreeSet<String> =
        reserved.iter().map(|name| naming::snake_case(name)).collect();
    let mut columns: BTreeMap<String, &str> = BTreeMap::new();
    let mut varchar_count = 0;

    for (name, attribute) in attributes {
        let at = |suffix: &str| {
            if suffix.is_empty() {
                format!("attributes.{name}")
            } else {
                format!("attributes.{name}.{suffix}")
            }
        };

        if !naming::is_attribute_name(name) {
            report.push(
                file,
                at(""),
                "attribute names must start with a letter, then letters, digits and underscores",
            );
            continue;
        }
        if name.len() > MAX_ATTRIBUTE_NAME {
            report.push(
                file,
                at(""),
                format!("attribute names must be at most {MAX_ATTRIBUTE_NAME} characters"),
            );
        }
        let column = naming::snake_case(name);
        if reserved.contains(&name.as_str()) || reserved_columns.contains(&column) {
            report.push(file, at(""), format!("`{name}` is reserved"));
        }
        if attribute.kind.has_column()
            && let Some(other) = columns.insert(column.clone(), name)
        {
            report.push(file, at(""), format!("maps to the same column `{column}` as `{other}`"));
        }

        match &attribute.kind {
            AttributeKind::String { .. }
            | AttributeKind::Email { .. }
            | AttributeKind::Uid { .. }
            | AttributeKind::Enumeration { .. } => varchar_count += 1,
            _ => {}
        }

        match &attribute.kind {
            AttributeKind::Uid { target_field: Some(target), .. } => match attributes.get(target) {
                Some(Attribute {
                    kind: AttributeKind::String { .. } | AttributeKind::Text { .. },
                    ..
                }) => {}
                Some(_) => report.push(
                    file,
                    at("targetField"),
                    format!("`{target}` must be a string or text attribute"),
                ),
                None => {
                    report.push(file, at("targetField"), format!("unknown attribute `{target}`"))
                }
            },
            AttributeKind::Relation { relation, target, inversed_by, mapped_by } => {
                let Some(target_type) = schema.content_type(target) else {
                    report.push(file, at("target"), format!("unknown content type `{target}`"));
                    continue;
                };
                if in_component {
                    if relation.inverse().is_some() {
                        report.push(
                            file,
                            at("relation"),
                            "relations inside components must be `oneWay` or `manyWay`",
                        );
                    }
                    continue;
                }
                if let Some(inverse) = inversed_by {
                    check_inverse(
                        owner_uid,
                        name,
                        *relation,
                        target_type,
                        inverse,
                        file,
                        &at("inversedBy"),
                        report,
                    );
                }
                if let Some(owner) = mapped_by {
                    match target_type.attributes.get(owner) {
                        Some(Attribute {
                            kind: AttributeKind::Relation { target: back, inversed_by: Some(inverse), .. },
                            ..
                        }) if back == owner_uid && inverse == name => {}
                        _ => report.push(
                            file,
                            at("mappedBy"),
                            format!("`{target}.{owner}` must be a relation to `{owner_uid}` with `inversedBy: \"{name}\"`"),
                        ),
                    }
                }
            }
            AttributeKind::Component { component, .. } => {
                if schema.component(component).is_none() {
                    report.push(file, at("component"), format!("unknown component `{component}`"));
                }
            }
            AttributeKind::DynamicZone { components, .. } => {
                if in_component {
                    report.push(file, at(""), "dynamic zones cannot be nested in components");
                }
                for (index, component) in components.iter().enumerate() {
                    if schema.component(component).is_none() {
                        report.push(
                            file,
                            at(&format!("components[{index}]")),
                            format!("unknown component `{component}`"),
                        );
                    }
                }
            }
            _ => {}
        }
    }

    if varchar_count > MAX_VARCHAR_ATTRIBUTES {
        report.push(
            file,
            "attributes",
            format!("at most {MAX_VARCHAR_ATTRIBUTES} string/email/uid/enumeration attributes per type (MySQL row size); use `text` for some"),
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn check_inverse(
    owner_uid: &str,
    name: &str,
    relation: RelationKind,
    target_type: &ContentType,
    inverse: &str,
    file: &Path,
    at: &str,
    report: &mut Report,
) {
    let expected = relation.inverse().expect("bidirectional relation");
    match target_type.attributes.get(inverse) {
        Some(Attribute { kind: AttributeKind::Relation { relation: other, target, mapped_by, .. }, .. })
            if target == owner_uid && mapped_by.as_deref() == Some(name) =>
        {
            if *other != expected {
                report.push(
                    file,
                    at,
                    format!("`{}.{inverse}` must be `{}` to mirror `{}`", target_type.uid, expected.as_str(), relation.as_str()),
                );
            }
        }
        _ => report.push(
            file,
            at,
            format!(
                "`{}.{inverse}` must be a `{}` relation to `{owner_uid}` with `mappedBy: \"{name}\"`",
                target_type.uid,
                expected.as_str()
            ),
        ),
    }
}

/// Components may nest other components, but never themselves (directly or indirectly).
fn check_component_cycles(schema: &Schema, files: &HashMap<String, PathBuf>, report: &mut Report) {
    fn children(component: &Component) -> impl Iterator<Item = &str> {
        component.attributes.values().filter_map(|attribute| match &attribute.kind {
            AttributeKind::Component { component, .. } => Some(component.as_str()),
            _ => None,
        })
    }

    fn visit<'a>(
        schema: &'a Schema,
        uid: &'a str,
        path: &mut Vec<&'a str>,
    ) -> Option<Vec<&'a str>> {
        if let Some(start) = path.iter().position(|seen| *seen == uid) {
            let mut cycle = path[start..].to_vec();
            cycle.push(uid);
            return Some(cycle);
        }
        let component = schema.component(uid)?;
        path.push(uid);
        for child in children(component) {
            if let Some(cycle) = visit(schema, child, path) {
                return Some(cycle);
            }
        }
        path.pop();
        None
    }

    let mut reported = BTreeSet::new();
    for uid in schema.components.keys() {
        if let Some(cycle) = visit(schema, uid, &mut Vec::new())
            && reported.insert(cycle[0].to_owned())
        {
            report.push(
                &files[cycle[0]],
                "",
                format!("components nest in a cycle: {}", cycle.join(" → ")),
            );
        }
    }
}
