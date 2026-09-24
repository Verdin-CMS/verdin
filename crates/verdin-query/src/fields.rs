//! API-facing fields of a content type and how they map to columns.

use std::collections::HashMap;

use indexmap::IndexMap;
use verdin_db::ColumnKind;
use verdin_schema::naming::link_table_name;
use verdin_schema::{Attribute, AttributeKind, ContentType, RelationKind, Schema};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldCategory {
    /// Stored in a column and returned by default (includes `json`).
    Scalar,
    /// A component or dynamic zone: stored as JSON, returned only when populated.
    Nested,
    /// A relation: stored in link tables (M3).
    Relation,
}

#[derive(Debug, Clone)]
pub struct Field {
    /// Name in the API (`documentId`, `metaTitle`).
    pub api: String,
    /// Column name (`document_id`, `meta_title`). Empty for relations.
    pub column: String,
    pub kind: ColumnKind,
    pub category: FieldCategory,
    /// `None` for system fields.
    pub attribute: Option<Attribute>,
    /// Set for relations.
    pub relation: Option<RelationInfo>,
}

/// How a relation field is stored and resolved (docs/architecture.md §8.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationInfo {
    pub kind: RelationKind,
    /// Target content type uid.
    pub target: String,
    pub to_many: bool,
    /// Whether this side stores the links (`false` for `mappedBy` sides).
    pub owner: bool,
    /// The owning side's link table.
    pub link_table: String,
    /// The target type's table.
    pub target_table: String,
    pub target_draft_and_publish: bool,
}

impl Field {
    pub fn is_private(&self) -> bool {
        self.attribute.as_ref().is_some_and(|attribute| attribute.private)
    }

    pub fn is_system(&self) -> bool {
        self.attribute.is_none()
    }

    /// Whether the field can appear in `filters`: public columns other than JSON
    /// (JSON only supports `$null` / `$notNull`, checked by the parser).
    pub fn is_filterable(&self) -> bool {
        self.category == FieldCategory::Scalar && !self.is_private()
    }

    pub fn is_sortable(&self) -> bool {
        self.is_filterable() && self.kind != ColumnKind::Json
    }

    pub fn is_text(&self) -> bool {
        self.kind == ColumnKind::Text
    }
}

/// Fields of one content type in response order:
/// `id`, `documentId`, attributes (schema order), `createdAt`, `updatedAt`, `publishedAt`.
#[derive(Debug, Clone)]
pub struct TypeFields {
    pub uid: String,
    pub table: String,
    pub draft_and_publish: bool,
    fields: IndexMap<String, Field>,
}

impl TypeFields {
    pub fn new(content_type: &ContentType, schema: &Schema) -> Self {
        let system = |api: &str, column: &str, kind| Field {
            api: api.into(),
            column: column.into(),
            kind,
            category: FieldCategory::Scalar,
            attribute: None,
            relation: None,
        };
        let mut fields = IndexMap::new();
        for field in [
            system("id", "id", ColumnKind::BigInt),
            system("documentId", "document_id", ColumnKind::Text),
        ] {
            fields.insert(field.api.clone(), field);
        }
        for (name, attribute) in &content_type.attributes {
            let (kind, category) = attribute_kind(&attribute.kind);
            let column = if category == FieldCategory::Relation {
                String::new()
            } else {
                Attribute::column_name(name)
            };
            let relation = relation_info(content_type, name, &attribute.kind, schema);
            fields.insert(
                name.clone(),
                Field {
                    api: name.clone(),
                    column,
                    kind,
                    category,
                    attribute: Some(attribute.clone()),
                    relation,
                },
            );
        }
        for field in [
            system("createdAt", "created_at", ColumnKind::DateTime),
            system("updatedAt", "updated_at", ColumnKind::DateTime),
            system("publishedAt", "published_at", ColumnKind::DateTime),
        ] {
            fields.insert(field.api.clone(), field);
        }
        Self {
            uid: content_type.uid.clone(),
            table: content_type.collection_name.clone(),
            draft_and_publish: content_type.draft_and_publish,
            fields,
        }
    }

    pub fn get(&self, api: &str) -> Option<&Field> {
        self.fields.get(api)
    }

    pub fn iter(&self) -> impl Iterator<Item = &Field> {
        self.fields.values()
    }

    /// Attribute fields (no system fields), in schema order.
    pub fn attributes(&self) -> impl Iterator<Item = &Field> {
        self.fields.values().filter(|field| !field.is_system())
    }
}

fn relation_info(
    content_type: &ContentType,
    name: &str,
    kind: &AttributeKind,
    schema: &Schema,
) -> Option<RelationInfo> {
    let AttributeKind::Relation { relation, target, mapped_by, .. } = kind else { return None };
    let target_type = schema.content_type(target)?;
    let link_table = match mapped_by {
        None => link_table_name(&content_type.collection_name, name),
        Some(owner_attribute) => link_table_name(&target_type.collection_name, owner_attribute),
    };
    Some(RelationInfo {
        kind: *relation,
        target: target.clone(),
        to_many: relation.is_to_many(),
        owner: mapped_by.is_none(),
        link_table,
        target_table: target_type.collection_name.clone(),
        target_draft_and_publish: target_type.draft_and_publish,
    })
}

/// Fields of every content type, by uid.
#[derive(Debug, Clone, Default)]
pub struct Catalog {
    types: HashMap<String, TypeFields>,
}

impl Catalog {
    pub fn new(schema: &Schema) -> Self {
        let types = schema
            .content_types
            .values()
            .map(|content_type| (content_type.uid.clone(), TypeFields::new(content_type, schema)))
            .collect();
        Self { types }
    }

    pub fn get(&self, uid: &str) -> Option<&TypeFields> {
        self.types.get(uid)
    }
}

/// Column kind and category of an attribute.
pub fn attribute_kind(kind: &AttributeKind) -> (ColumnKind, FieldCategory) {
    use AttributeKind as A;
    let scalar = |kind| (kind, FieldCategory::Scalar);
    match kind {
        A::String { .. }
        | A::Email { .. }
        | A::Uid { .. }
        | A::Enumeration { .. }
        | A::Text { .. }
        | A::RichText { .. } => scalar(ColumnKind::Text),
        A::Integer { .. } => scalar(ColumnKind::Int),
        A::BigInteger { .. } => scalar(ColumnKind::BigInt),
        A::Float { .. } => scalar(ColumnKind::Double),
        A::Decimal { .. } => scalar(ColumnKind::Decimal),
        A::Boolean => scalar(ColumnKind::Bool),
        A::Date { .. } => scalar(ColumnKind::Date),
        A::Time { .. } => scalar(ColumnKind::Time),
        A::DateTime { .. } => scalar(ColumnKind::DateTime),
        A::Json => scalar(ColumnKind::Json),
        A::Component { .. } | A::DynamicZone { .. } => (ColumnKind::Json, FieldCategory::Nested),
        A::Relation { .. } => (ColumnKind::Json, FieldCategory::Relation),
    }
}
