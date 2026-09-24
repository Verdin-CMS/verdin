//! Validated schema model. Built only through [`crate::Schema::parse`] / [`crate::Schema::load_dir`].

use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde_json::Value;

use crate::naming;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Schema {
    /// Keyed by content type uid (`api::article`).
    pub content_types: BTreeMap<String, ContentType>,
    /// Keyed by component uid (`shared.seo`).
    pub components: BTreeMap<String, Component>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentTypeKind {
    CollectionType,
    SingleType,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContentType {
    pub uid: String,
    pub kind: ContentTypeKind,
    pub singular_name: String,
    pub plural_name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub collection_name: String,
    pub draft_and_publish: bool,
    pub attributes: IndexMap<String, Attribute>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Component {
    pub uid: String,
    pub category: String,
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub attributes: IndexMap<String, Attribute>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Attribute {
    pub required: bool,
    pub private: bool,
    pub configurable: bool,
    pub default: Option<Value>,
    pub kind: AttributeKind,
}

impl Attribute {
    /// Column name for this attribute (`metaTitle` → `meta_title`).
    pub fn column_name(name: &str) -> String {
        naming::snake_case(name)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AttributeKind {
    String {
        min_length: Option<u32>,
        max_length: Option<u32>,
        regex: Option<String>,
        unique: bool,
    },
    Email {
        min_length: Option<u32>,
        max_length: Option<u32>,
        unique: bool,
    },
    Text {
        min_length: Option<u32>,
        max_length: Option<u32>,
    },
    RichText {
        min_length: Option<u32>,
        max_length: Option<u32>,
    },
    Uid {
        target_field: Option<String>,
        min_length: Option<u32>,
        max_length: Option<u32>,
        regex: Option<String>,
    },
    Integer {
        min: Option<i64>,
        max: Option<i64>,
        unique: bool,
    },
    BigInteger {
        min: Option<i64>,
        max: Option<i64>,
        unique: bool,
    },
    Float {
        min: Option<f64>,
        max: Option<f64>,
        unique: bool,
    },
    Decimal {
        precision: u8,
        scale: u8,
        min: Option<f64>,
        max: Option<f64>,
        unique: bool,
    },
    Boolean,
    Date {
        unique: bool,
    },
    Time {
        unique: bool,
    },
    DateTime {
        unique: bool,
    },
    Enumeration {
        values: Vec<String>,
    },
    Json,
    Relation {
        relation: RelationKind,
        target: String,
        inversed_by: Option<String>,
        mapped_by: Option<String>,
    },
    Component {
        component: String,
        repeatable: bool,
        min: Option<u32>,
        max: Option<u32>,
    },
    DynamicZone {
        components: Vec<String>,
        min: Option<u32>,
        max: Option<u32>,
    },
    /// Files from the media library, linked through `{table}_{field}_mda` (§8.7).
    Media {
        multiple: bool,
        /// Empty means any file.
        allowed_types: Vec<MediaType>,
    },
}

/// Kinds of files a media attribute accepts (Strapi's `allowedTypes`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaType {
    Images,
    Videos,
    Audios,
    Files,
}

impl MediaType {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "images" => Self::Images,
            "videos" => Self::Videos,
            "audios" => Self::Audios,
            "files" => Self::Files,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Images => "images",
            Self::Videos => "videos",
            Self::Audios => "audios",
            Self::Files => "files",
        }
    }

    /// The category of a MIME type: `image/*`, `video/*`, `audio/*`, anything else.
    pub fn of_mime(mime: &str) -> Self {
        match mime.split('/').next() {
            Some("image") => Self::Images,
            Some("video") => Self::Videos,
            Some("audio") => Self::Audios,
            _ => Self::Files,
        }
    }
}

impl AttributeKind {
    /// The `type` value used in schema files.
    pub fn type_name(&self) -> &'static str {
        match self {
            AttributeKind::String { .. } => "string",
            AttributeKind::Email { .. } => "email",
            AttributeKind::Text { .. } => "text",
            AttributeKind::RichText { .. } => "richtext",
            AttributeKind::Uid { .. } => "uid",
            AttributeKind::Integer { .. } => "integer",
            AttributeKind::BigInteger { .. } => "biginteger",
            AttributeKind::Float { .. } => "float",
            AttributeKind::Decimal { .. } => "decimal",
            AttributeKind::Boolean => "boolean",
            AttributeKind::Date { .. } => "date",
            AttributeKind::Time { .. } => "time",
            AttributeKind::DateTime { .. } => "datetime",
            AttributeKind::Enumeration { .. } => "enumeration",
            AttributeKind::Json => "json",
            AttributeKind::Relation { .. } => "relation",
            AttributeKind::Component { .. } => "component",
            AttributeKind::DynamicZone { .. } => "dynamiczone",
            AttributeKind::Media { .. } => "media",
        }
    }

    /// Whether values must be unique among documents (uids always are).
    pub fn is_unique(&self) -> bool {
        match self {
            AttributeKind::String { unique, .. }
            | AttributeKind::Email { unique, .. }
            | AttributeKind::Integer { unique, .. }
            | AttributeKind::BigInteger { unique, .. }
            | AttributeKind::Float { unique, .. }
            | AttributeKind::Decimal { unique, .. }
            | AttributeKind::Date { unique }
            | AttributeKind::Time { unique }
            | AttributeKind::DateTime { unique } => *unique,
            AttributeKind::Uid { .. } => true,
            _ => false,
        }
    }

    /// For relations: whether this side stores the links (everything but `mappedBy`).
    pub fn owns_relation(&self) -> bool {
        matches!(self, AttributeKind::Relation { mapped_by: None, .. })
    }

    /// Whether the attribute is stored as a column on the owning row.
    /// Relations live in link tables instead.
    pub fn has_column(&self) -> bool {
        !matches!(self, AttributeKind::Relation { .. } | AttributeKind::Media { .. })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationKind {
    OneToOne,
    OneToMany,
    ManyToOne,
    ManyToMany,
    OneWay,
    ManyWay,
}

impl RelationKind {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "oneToOne" => RelationKind::OneToOne,
            "oneToMany" => RelationKind::OneToMany,
            "manyToOne" => RelationKind::ManyToOne,
            "manyToMany" => RelationKind::ManyToMany,
            "oneWay" => RelationKind::OneWay,
            "manyWay" => RelationKind::ManyWay,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RelationKind::OneToOne => "oneToOne",
            RelationKind::OneToMany => "oneToMany",
            RelationKind::ManyToOne => "manyToOne",
            RelationKind::ManyToMany => "manyToMany",
            RelationKind::OneWay => "oneWay",
            RelationKind::ManyWay => "manyWay",
        }
    }

    /// Whether a document links to many targets through this relation.
    pub fn is_to_many(self) -> bool {
        matches!(self, RelationKind::OneToMany | RelationKind::ManyToMany | RelationKind::ManyWay)
    }

    /// Whether a target may be linked from at most one source document.
    pub fn has_unique_target(self) -> bool {
        matches!(self, RelationKind::OneToOne | RelationKind::OneToMany)
    }

    /// The kind the other side of a bidirectional relation must declare.
    pub fn inverse(self) -> Option<Self> {
        match self {
            RelationKind::OneToOne => Some(RelationKind::OneToOne),
            RelationKind::OneToMany => Some(RelationKind::ManyToOne),
            RelationKind::ManyToOne => Some(RelationKind::OneToMany),
            RelationKind::ManyToMany => Some(RelationKind::ManyToMany),
            RelationKind::OneWay | RelationKind::ManyWay => None,
        }
    }
}
