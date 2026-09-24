//! Schema → physical model (docs/architecture.md §8).

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};
use verdin_schema::{Attribute, AttributeKind, ContentType, Schema, VARCHAR_LENGTH};

use crate::model::{Column, ColumnDefault, ColumnType, DbModel, Index, Table, hex};

/// PostgreSQL allows 63-byte identifiers and MySQL 64; we stay under both.
pub const MAX_IDENTIFIER: usize = 60;

pub const DOCUMENT_ID_LENGTH: u16 = 26;
pub const LOCALE_LENGTH: u16 = 16;

/// Columns every content type table starts with.
pub fn system_columns() -> Vec<Column> {
    vec![
        Column::new("id", ColumnType::Id).not_null(),
        Column::new("document_id", ColumnType::Char { length: DOCUMENT_ID_LENGTH }).not_null(),
        Column::new("locale", ColumnType::Varchar { length: LOCALE_LENGTH })
            .not_null()
            .default_value(ColumnDefault::Text(String::new())),
        Column::new("publication_state", ColumnType::SmallInt).not_null(),
        Column::new("published_at", ColumnType::DateTime),
        Column::new("created_at", ColumnType::DateTime).not_null(),
        Column::new("updated_at", ColumnType::DateTime).not_null(),
        Column::new("created_by_id", ColumnType::BigInt),
        Column::new("updated_by_id", ColumnType::BigInt),
    ]
}

pub fn derive_model(schema: &Schema) -> DbModel {
    let tables: BTreeMap<String, Table> = schema
        .content_types
        .values()
        .map(|content_type| {
            let table = content_type_table(content_type);
            (table.name.clone(), table)
        })
        .collect();
    DbModel { tables }
}

fn content_type_table(content_type: &ContentType) -> Table {
    let name = content_type.collection_name.clone();
    let mut columns = system_columns();
    let mut indexes = vec![
        Index {
            name: index_name(&name, "document", "uq"),
            columns: vec!["document_id".into(), "locale".into(), "publication_state".into()],
            unique: true,
        },
        Index {
            name: index_name(&name, "state", "idx"),
            columns: vec!["publication_state".into(), "locale".into()],
            unique: false,
        },
    ];

    for (attribute_name, attribute) in &content_type.attributes {
        let Some(ty) = column_type(attribute) else { continue };
        let column = Attribute::column_name(attribute_name);
        // Draft rows may be incomplete, so `required` is enforced on publish, not by the database.
        columns.push(Column::new(column.clone(), ty));
        if attribute.kind.is_unique() {
            // Scoped by state: a draft and its published version share values.
            indexes.push(Index {
                name: index_name(&name, &column, "uq"),
                columns: vec![column, "locale".into(), "publication_state".into()],
                unique: true,
            });
        }
    }

    Table { name, columns, indexes }
}

fn column_type(attribute: &Attribute) -> Option<ColumnType> {
    let varchar = ColumnType::Varchar { length: VARCHAR_LENGTH as u16 };
    Some(match &attribute.kind {
        AttributeKind::String { .. }
        | AttributeKind::Email { .. }
        | AttributeKind::Uid { .. }
        | AttributeKind::Enumeration { .. } => varchar,
        AttributeKind::Text { .. } | AttributeKind::RichText { .. } => ColumnType::Text,
        AttributeKind::Integer { .. } => ColumnType::Integer,
        AttributeKind::BigInteger { .. } => ColumnType::BigInt,
        AttributeKind::Float { .. } => ColumnType::Double,
        AttributeKind::Decimal { precision, scale, .. } => {
            ColumnType::Decimal { precision: *precision, scale: *scale }
        }
        AttributeKind::Boolean => ColumnType::Boolean,
        AttributeKind::Date { .. } => ColumnType::Date,
        AttributeKind::Time { .. } => ColumnType::Time,
        AttributeKind::DateTime { .. } => ColumnType::DateTime,
        AttributeKind::Json
        | AttributeKind::Component { .. }
        | AttributeKind::DynamicZone { .. } => ColumnType::Json,
        AttributeKind::Relation { .. } => return None,
    })
}

/// `{table}_{part}_{suffix}`, shortened deterministically when over [`MAX_IDENTIFIER`].
pub fn index_name(table: &str, part: &str, suffix: &str) -> String {
    bounded(&format!("{table}_{part}_{suffix}"))
}

/// Truncates `name` to fit [`MAX_IDENTIFIER`], appending an 8-char hash of the full name
/// so that distinct long names stay distinct.
pub fn bounded(name: &str) -> String {
    if name.len() <= MAX_IDENTIFIER {
        return name.to_owned();
    }
    let hash = hex(&Sha256::digest(name.as_bytes()));
    format!("{}_{}", &name[..MAX_IDENTIFIER - 9], &hash[..8])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use verdin_schema::Source;

    #[test]
    fn bounds_long_identifiers() {
        assert_eq!(bounded("short_name"), "short_name");
        let long = "a".repeat(70);
        let bounded_name = bounded(&long);
        assert_eq!(bounded_name.len(), MAX_IDENTIFIER);
        assert_ne!(bounded(&"a".repeat(71)), bounded_name, "hash keeps names distinct");
        assert_eq!(bounded(&long), bounded_name, "deterministic");
    }

    #[test]
    fn derives_content_type_table() {
        let schema = Schema::parse(&[Source::content_type(
            "article",
            json!({
                "kind": "collectionType", "singularName": "article", "pluralName": "articles", "displayName": "Article",
                "attributes": {
                    "title": { "type": "string" },
                    "slug": { "type": "uid", "targetField": "title" },
                    "views": { "type": "integer" },
                    "price": { "type": "decimal", "precision": 8, "scale": 3 },
                    "related": { "type": "relation", "relation": "manyWay", "target": "article" },
                    "extra": { "type": "json" }
                }
            })
            .to_string(),
        )])
        .unwrap();

        let model = derive_model(&schema);
        let table = &model.tables["articles"];
        let names: Vec<_> = table.columns.iter().map(|column| column.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "id",
                "document_id",
                "locale",
                "publication_state",
                "published_at",
                "created_at",
                "updated_at",
                "created_by_id",
                "updated_by_id",
                "title",
                "slug",
                "views",
                "price",
                "extra"
            ],
            "relations have no column"
        );
        assert!(table.columns[9..].iter().all(|column| column.nullable));
        assert_eq!(
            table.column("price").unwrap().ty,
            ColumnType::Decimal { precision: 8, scale: 3 }
        );

        let index_names: Vec<_> = table.indexes.iter().map(|index| index.name.as_str()).collect();
        assert_eq!(index_names, ["articles_document_uq", "articles_state_idx", "articles_slug_uq"]);
        assert_eq!(
            table.index("articles_slug_uq").unwrap().columns,
            ["slug", "locale", "publication_state"]
        );
    }
}
