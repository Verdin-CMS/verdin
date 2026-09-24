//! API-facing fields of a content type and how they map to columns.

use indexmap::IndexMap;
use verdin_db::ColumnKind;
use verdin_schema::{Attribute, AttributeKind, ContentType};

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
    pub table: String,
    fields: IndexMap<String, Field>,
}

impl TypeFields {
    pub fn new(content_type: &ContentType) -> Self {
        let system = |api: &str, column: &str, kind| Field {
            api: api.into(),
            column: column.into(),
            kind,
            category: FieldCategory::Scalar,
            attribute: None,
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
            fields.insert(
                name.clone(),
                Field {
                    api: name.clone(),
                    column,
                    kind,
                    category,
                    attribute: Some(attribute.clone()),
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
        Self { table: content_type.collection_name.clone(), fields }
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
