//! Content API query parameters: parsing (Strapi v5 compatible), validation against the
//! schema, and SQL generation per dialect.

mod ast;
mod fields;
mod params;
mod parse;
pub mod sql;
pub mod temporal;

use std::fmt;

pub use ast::*;
pub use fields::{
    Catalog, Field, FieldCategory, MediaInfo, RelationInfo, TypeFields, attribute_kind,
};
pub use params::{Node, parse_query_string};
pub use parse::{Limits, parse, scalar_value};

/// An invalid query. Messages are safe to return to API clients.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryError {
    pub message: String,
}

impl QueryError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into() }
    }
}

impl fmt::Display for QueryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for QueryError {}

/// Parses a raw query string for one content type.
pub fn parse_request(
    raw: Option<&str>,
    fields: &TypeFields,
    catalog: &Catalog,
    limits: &Limits,
) -> Result<Query, QueryError> {
    let root = parse_query_string(raw.unwrap_or_default())?;
    parse(&root, fields, catalog, limits)
}
