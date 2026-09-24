//! Schema → physical model (docs/architecture.md §8).

use std::collections::BTreeMap;

use verdin_schema::naming::{link_table_name, media_table_name};
use verdin_schema::{Attribute, AttributeKind, ContentType, Schema, VARCHAR_LENGTH};

use crate::model::{Column, ColumnDefault, ColumnType, DbModel, ForeignKey, Index, Table};

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

/// The tables `schema` needs, plus the platform tables (`vd_*`).
pub fn derive_model(schema: &Schema) -> DbModel {
    let mut model = derive_content_model(schema);
    for table in crate::system::system_tables() {
        model.tables.insert(table.name.clone(), table);
    }
    model
}

/// Only the tables of content types (and their link tables).
pub fn derive_content_model(schema: &Schema) -> DbModel {
    let mut tables = BTreeMap::new();
    for content_type in schema.content_types.values() {
        let table = content_type_table(content_type);
        for (name, attribute) in &content_type.attributes {
            if let AttributeKind::Relation { relation, .. } = &attribute.kind
                && attribute.kind.owns_relation()
            {
                let link = link_table(&table.name, name, relation.is_to_many());
                tables.insert(link.name.clone(), link);
            }
            if let AttributeKind::Media { multiple, .. } = &attribute.kind {
                let link = media_table(&table.name, name, *multiple);
                tables.insert(link.name.clone(), link);
            }
        }
        tables.insert(table.name.clone(), table);
    }
    DbModel { tables }
}

/// Links of one owning relation attribute: source row → target document (§8.4).
fn link_table(source_table: &str, attribute: &str, to_many: bool) -> Table {
    let name = link_table_name(source_table, attribute);
    let mut indexes = vec![
        Index {
            name: index_name(&name, "pair", "uq"),
            columns: vec!["source_id".into(), "target_document_id".into()],
            unique: true,
        },
        Index {
            name: index_name(&name, "target", "idx"),
            columns: vec!["target_document_id".into()],
            unique: false,
        },
    ];
    if !to_many {
        indexes.push(Index {
            name: index_name(&name, "source", "uq"),
            columns: vec!["source_id".into()],
            unique: true,
        });
    }
    Table {
        columns: vec![
            Column::new("id", ColumnType::Id).not_null(),
            Column::new("source_id", ColumnType::BigInt).not_null(),
            Column::new("target_document_id", ColumnType::Char { length: DOCUMENT_ID_LENGTH })
                .not_null(),
            Column::new("position", ColumnType::Double).not_null(),
        ],
        indexes,
        foreign_keys: vec![ForeignKey {
            columns: vec!["source_id".into()],
            table: source_table.to_owned(),
            references: vec!["id".into()],
        }],
        name,
    }
}

/// Files of one media attribute: source row → `vd_files` row, ordered (§8.7).
fn media_table(source_table: &str, attribute: &str, multiple: bool) -> Table {
    let name = media_table_name(source_table, attribute);
    let mut indexes = vec![
        Index {
            name: index_name(&name, "pair", "uq"),
            columns: vec!["source_id".into(), "file_id".into()],
            unique: true,
        },
        Index {
            name: index_name(&name, "file", "idx"),
            columns: vec!["file_id".into()],
            unique: false,
        },
    ];
    if !multiple {
        indexes.push(Index {
            name: index_name(&name, "source", "uq"),
            columns: vec!["source_id".into()],
            unique: true,
        });
    }
    Table {
        columns: vec![
            Column::new("id", ColumnType::Id).not_null(),
            Column::new("source_id", ColumnType::BigInt).not_null(),
            Column::new("file_id", ColumnType::BigInt).not_null(),
            Column::new("position", ColumnType::Double).not_null(),
        ],
        indexes,
        foreign_keys: vec![
            ForeignKey {
                columns: vec!["source_id".into()],
                table: source_table.to_owned(),
                references: vec!["id".into()],
            },
            ForeignKey {
                columns: vec!["file_id".into()],
                table: crate::system::FILES.to_owned(),
                references: vec!["id".into()],
            },
        ],
        name,
    }
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

    Table { name, columns, indexes, foreign_keys: Vec::new() }
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
        AttributeKind::Relation { .. } | AttributeKind::Media { .. } => return None,
    })
}

pub use verdin_schema::naming::{MAX_IDENTIFIER, bounded, index_name};

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
