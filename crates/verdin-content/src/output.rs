//! Column values → API JSON.

use rust_decimal::prelude::ToPrimitive;
use serde_json::Value as Json;
use verdin_db::SqlValue;
use verdin_db::value::{format_date, format_datetime, format_time};
use verdin_schema::AttributeKind;

#[derive(Debug, Clone, Copy, Default)]
pub struct OutputOptions {
    /// Serialize `decimal` values as strings (exact) instead of numbers (Strapi-compatible).
    pub decimal_as_string: bool,
}

/// Converts a decoded column value to its API representation.
/// `attribute` is `None` for system fields.
pub fn value_to_json(
    attribute: Option<&AttributeKind>,
    value: SqlValue,
    options: OutputOptions,
) -> Json {
    match value {
        SqlValue::Null(_) => Json::Null,
        SqlValue::Bool(value) => Json::Bool(value),
        SqlValue::SmallInt(value) => Json::from(value),
        SqlValue::Int(value) => Json::from(value),
        // `biginteger` attributes are strings (Strapi-compatible, beyond JS number precision);
        // system ids are numbers.
        SqlValue::BigInt(value) => match attribute {
            Some(AttributeKind::BigInteger { .. }) => Json::String(value.to_string()),
            _ => Json::from(value),
        },
        SqlValue::Double(value) => {
            serde_json::Number::from_f64(value).map_or(Json::Null, Json::Number)
        }
        SqlValue::Decimal(value) => {
            if options.decimal_as_string {
                Json::String(value.normalize().to_string())
            } else {
                value
                    .to_f64()
                    .and_then(serde_json::Number::from_f64)
                    .map_or(Json::Null, Json::Number)
            }
        }
        SqlValue::Text(value) => Json::String(value),
        SqlValue::Date(value) => Json::String(format_date(value)),
        SqlValue::Time(value) => Json::String(format_time(value)),
        SqlValue::DateTime(value) => Json::String(format_datetime(value)),
        SqlValue::Json(value) => value,
    }
}
