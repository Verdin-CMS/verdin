//! Dialect-neutral physical model: the tables, columns and indexes a schema needs.
//! Snapshots of this model are what migrations diff against.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DbModel {
    pub tables: BTreeMap<String, Table>,
}

impl DbModel {
    /// Stable content hash, stored alongside snapshots.
    pub fn hash(&self) -> String {
        let json = serde_json::to_vec(self).expect("model serializes");
        hex(&Sha256::digest(json))
    }
}

/// Every table has an `id` primary key column of type [`ColumnType::Id`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Table {
    pub name: String,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub indexes: Vec<Index>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub foreign_keys: Vec<ForeignKey>,
}

impl Table {
    pub fn column(&self, name: &str) -> Option<&Column> {
        self.columns.iter().find(|column| column.name == name)
    }

    pub fn index(&self, name: &str) -> Option<&Index> {
        self.indexes.iter().find(|index| index.name == name)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: ColumnType,
    pub nullable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<ColumnDefault>,
}

impl Column {
    pub fn new(name: impl Into<String>, ty: ColumnType) -> Self {
        Self { name: name.into(), ty, nullable: true, default: None }
    }

    pub fn not_null(mut self) -> Self {
        self.nullable = false;
        self
    }

    pub fn default_value(mut self, default: ColumnDefault) -> Self {
        self.default = Some(default);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ColumnType {
    /// Auto-incrementing 64-bit primary key.
    Id,
    BigInt,
    Integer,
    SmallInt,
    Double,
    Decimal {
        precision: u8,
        scale: u8,
    },
    Boolean,
    Char {
        length: u16,
    },
    Varchar {
        length: u16,
    },
    Text,
    Date,
    Time,
    DateTime,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColumnDefault {
    Text(String),
    Int(i64),
}

/// `columns` reference `table(references)`; rows are deleted with the referenced row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForeignKey {
    pub columns: Vec<String>,
    pub table: String,
    pub references: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}
