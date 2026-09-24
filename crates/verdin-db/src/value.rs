//! Typed statement parameters and result values, with per-backend encoding.
//!
//! Values are decoded according to a caller-supplied [`ColumnKind`] (schema-driven decoding),
//! never according to the type the driver reports. That is what makes MariaDB's `JSON`
//! (really `LONGTEXT`), MySQL's `TINYINT(1)` booleans and SQLite's text timestamps uniform.
//!
//! SQLite has no date, time or decimal types; those are stored as fixed-format text so that
//! lexicographic order equals chronological/numeric order for dates and times.

use rust_decimal::Decimal;
use serde_json::Value as Json;
use time::format_description::FormatItem;
use time::macros::format_description;
use time::{Date, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};

/// How a column is decoded (and how a typed NULL is bound).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnKind {
    Bool,
    SmallInt,
    Int,
    BigInt,
    Double,
    Decimal,
    Text,
    Date,
    Time,
    DateTime,
    Json,
}

/// A statement parameter or a decoded result value.
#[derive(Debug, Clone, PartialEq)]
pub enum SqlValue {
    /// A NULL of the given kind (PostgreSQL needs typed NULL parameters).
    Null(ColumnKind),
    Bool(bool),
    SmallInt(i16),
    Int(i32),
    BigInt(i64),
    Double(f64),
    Decimal(Decimal),
    Text(String),
    Date(Date),
    Time(Time),
    /// Always UTC.
    DateTime(OffsetDateTime),
    Json(Json),
}

impl SqlValue {
    pub fn is_null(&self) -> bool {
        matches!(self, SqlValue::Null(_))
    }

    /// Integer value of any integer variant.
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            SqlValue::SmallInt(value) => Some(i64::from(*value)),
            SqlValue::Int(value) => Some(i64::from(*value)),
            SqlValue::BigInt(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            SqlValue::Text(value) => Some(value),
            _ => None,
        }
    }

    pub fn into_text(self) -> Option<String> {
        match self {
            SqlValue::Text(value) => Some(value),
            _ => None,
        }
    }
}

impl From<i64> for SqlValue {
    fn from(value: i64) -> Self {
        SqlValue::BigInt(value)
    }
}

impl From<&str> for SqlValue {
    fn from(value: &str) -> Self {
        SqlValue::Text(value.to_owned())
    }
}

impl From<String> for SqlValue {
    fn from(value: String) -> Self {
        SqlValue::Text(value)
    }
}

pub const DATE_FORMAT: &[FormatItem<'static>] = format_description!("[year]-[month]-[day]");
pub const TIME_FORMAT: &[FormatItem<'static>] =
    format_description!("[hour]:[minute]:[second].[subsecond digits:3]");
pub const DATETIME_FORMAT: &[FormatItem<'static>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");

pub fn format_date(date: Date) -> String {
    date.format(DATE_FORMAT).expect("valid date format")
}

pub fn format_time(time: Time) -> String {
    time.format(TIME_FORMAT).expect("valid time format")
}

/// `2026-09-24T10:00:00.000Z`: millisecond precision, UTC.
pub fn format_datetime(datetime: OffsetDateTime) -> String {
    datetime.to_offset(UtcOffset::UTC).format(DATETIME_FORMAT).expect("valid datetime format")
}

/// Truncates to the millisecond precision every backend stores.
pub fn truncate_millis(datetime: OffsetDateTime) -> OffsetDateTime {
    let nanos = datetime.nanosecond();
    datetime.replace_nanosecond(nanos - nanos % 1_000_000).expect("valid nanosecond")
}

pub(crate) fn parse_sqlite_datetime(text: &str) -> Option<OffsetDateTime> {
    PrimitiveDateTime::parse(text, DATETIME_FORMAT).ok().map(PrimitiveDateTime::assume_utc)
}

/// Binds a slice of [`SqlValue`]s onto a sqlx query for one backend.
macro_rules! bind_values {
    (postgres, $query:expr, $values:expr) => {{
        use $crate::value::{ColumnKind as K, SqlValue as V};
        let mut query = $query;
        for value in $values {
            query = match value {
                V::Null(kind) => match kind {
                    K::Bool => query.bind(None::<bool>),
                    K::SmallInt => query.bind(None::<i16>),
                    K::Int => query.bind(None::<i32>),
                    K::BigInt => query.bind(None::<i64>),
                    K::Double => query.bind(None::<f64>),
                    K::Decimal => query.bind(None::<rust_decimal::Decimal>),
                    K::Text => query.bind(None::<String>),
                    K::Date => query.bind(None::<time::Date>),
                    K::Time => query.bind(None::<time::Time>),
                    K::DateTime => query.bind(None::<time::OffsetDateTime>),
                    K::Json => query.bind(None::<sqlx::types::Json<serde_json::Value>>),
                },
                V::Bool(value) => query.bind(*value),
                V::SmallInt(value) => query.bind(*value),
                V::Int(value) => query.bind(*value),
                V::BigInt(value) => query.bind(*value),
                V::Double(value) => query.bind(*value),
                V::Decimal(value) => query.bind(*value),
                V::Text(value) => query.bind(value.as_str()),
                V::Date(value) => query.bind(*value),
                V::Time(value) => query.bind(*value),
                V::DateTime(value) => query.bind(*value),
                V::Json(value) => query.bind(sqlx::types::Json(value)),
            };
        }
        query
    }};
    (mysql, $query:expr, $values:expr) => {{
        use $crate::value::SqlValue as V;
        let mut query = $query;
        for value in $values {
            query = match value {
                // MySQL does not type-check NULL parameters.
                V::Null(_) => query.bind(None::<String>),
                V::Bool(value) => query.bind(*value),
                V::SmallInt(value) => query.bind(*value),
                V::Int(value) => query.bind(*value),
                V::BigInt(value) => query.bind(*value),
                V::Double(value) => query.bind(*value),
                V::Decimal(value) => query.bind(*value),
                V::Text(value) => query.bind(value.as_str()),
                V::Date(value) => query.bind(*value),
                V::Time(value) => query.bind(*value),
                V::DateTime(value) => query.bind(*value),
                V::Json(value) => query.bind(value.to_string()),
            };
        }
        query
    }};
    (sqlite, $query:expr, $values:expr) => {{
        use $crate::value::{SqlValue as V, format_date, format_datetime, format_time};
        let mut query = $query;
        for value in $values {
            query = match value {
                V::Null(_) => query.bind(None::<String>),
                V::Bool(value) => query.bind(*value),
                V::SmallInt(value) => query.bind(i64::from(*value)),
                V::Int(value) => query.bind(i64::from(*value)),
                V::BigInt(value) => query.bind(*value),
                V::Double(value) => query.bind(*value),
                V::Decimal(value) => query.bind(value.to_string()),
                V::Text(value) => query.bind(value.as_str()),
                V::Date(value) => query.bind(format_date(*value)),
                V::Time(value) => query.bind(format_time(*value)),
                V::DateTime(value) => query.bind(format_datetime(*value)),
                V::Json(value) => query.bind(value.to_string()),
            };
        }
        query
    }};
}
pub(crate) use bind_values;

/// Decodes every row with `kinds`, one kind per column.
macro_rules! decode_rows {
    ($backend:ident, $rows:expr, $kinds:expr) => {{
        let mut out = Vec::with_capacity($rows.len());
        for row in &$rows {
            let mut values = Vec::with_capacity($kinds.len());
            for (index, kind) in $kinds.iter().enumerate() {
                values.push($crate::value::decode_rows!(@cell $backend, row, index, *kind));
            }
            out.push(values);
        }
        out
    }};
    (@cell postgres, $row:expr, $index:expr, $kind:expr) => {{
        use sqlx::Row;
        use $crate::value::{ColumnKind as K, SqlValue as V};
        let null = V::Null($kind);
        match $kind {
            K::Bool => $row.try_get::<Option<bool>, _>($index)?.map_or(null, V::Bool),
            K::SmallInt => $row.try_get::<Option<i16>, _>($index)?.map_or(null, V::SmallInt),
            K::Int => $row.try_get::<Option<i32>, _>($index)?.map_or(null, V::Int),
            K::BigInt => $row.try_get::<Option<i64>, _>($index)?.map_or(null, V::BigInt),
            K::Double => $row.try_get::<Option<f64>, _>($index)?.map_or(null, V::Double),
            K::Decimal => {
                $row.try_get::<Option<rust_decimal::Decimal>, _>($index)?.map_or(null, V::Decimal)
            }
            K::Text => $row.try_get::<Option<String>, _>($index)?.map_or(null, V::Text),
            K::Date => $row.try_get::<Option<time::Date>, _>($index)?.map_or(null, V::Date),
            K::Time => $row.try_get::<Option<time::Time>, _>($index)?.map_or(null, V::Time),
            K::DateTime => {
                $row.try_get::<Option<time::OffsetDateTime>, _>($index)?.map_or(null, V::DateTime)
            }
            K::Json => $row
                .try_get::<Option<sqlx::types::Json<serde_json::Value>>, _>($index)?
                .map_or(null, |json| V::Json(json.0)),
        }
    }};
    (@cell mysql, $row:expr, $index:expr, $kind:expr) => {{
        use sqlx::Row;
        use $crate::value::{ColumnKind as K, SqlValue as V};
        let null = V::Null($kind);
        match $kind {
            K::Bool => $row.try_get::<Option<bool>, _>($index)?.map_or(null, V::Bool),
            K::SmallInt => $row.try_get::<Option<i16>, _>($index)?.map_or(null, V::SmallInt),
            K::Int => $row.try_get::<Option<i32>, _>($index)?.map_or(null, V::Int),
            K::BigInt => $row.try_get::<Option<i64>, _>($index)?.map_or(null, V::BigInt),
            K::Double => $row.try_get::<Option<f64>, _>($index)?.map_or(null, V::Double),
            K::Decimal => {
                $row.try_get::<Option<rust_decimal::Decimal>, _>($index)?.map_or(null, V::Decimal)
            }
            K::Text => $row.try_get::<Option<String>, _>($index)?.map_or(null, V::Text),
            K::Date => $row.try_get::<Option<time::Date>, _>($index)?.map_or(null, V::Date),
            K::Time => $row.try_get::<Option<time::Time>, _>($index)?.map_or(null, V::Time),
            K::DateTime => {
                $row.try_get::<Option<time::OffsetDateTime>, _>($index)?.map_or(null, V::DateTime)
            }
            // MySQL reports JSON; MariaDB reports LONGTEXT. `Json` accepts both.
            K::Json => $row
                .try_get::<Option<sqlx::types::Json<serde_json::Value>>, _>($index)?
                .map_or(null, |json| V::Json(json.0)),
        }
    }};
    (@cell sqlite, $row:expr, $index:expr, $kind:expr) => {{
        use sqlx::Row;
        use $crate::value::{ColumnKind as K, SqlValue as V};
        let null = V::Null($kind);
        let corrupt = |what: &str, text: &str| {
            sqlx::Error::Decode(format!("column {} holds an invalid {what}: `{text}`", $index).into())
        };
        match $kind {
            K::Bool => $row.try_get::<Option<bool>, _>($index)?.map_or(null, V::Bool),
            K::SmallInt => match $row.try_get::<Option<i64>, _>($index)? {
                Some(value) => V::SmallInt(i16::try_from(value).map_err(|_| corrupt("smallint", &value.to_string()))?),
                None => null,
            },
            K::Int => match $row.try_get::<Option<i64>, _>($index)? {
                Some(value) => V::Int(i32::try_from(value).map_err(|_| corrupt("integer", &value.to_string()))?),
                None => null,
            },
            K::BigInt => $row.try_get::<Option<i64>, _>($index)?.map_or(null, V::BigInt),
            K::Double => $row.try_get::<Option<f64>, _>($index)?.map_or(null, V::Double),
            K::Text => $row.try_get::<Option<String>, _>($index)?.map_or(null, V::Text),
            K::Decimal | K::Date | K::Time | K::DateTime | K::Json => {
                match $row.try_get::<Option<String>, _>($index)? {
                    None => null,
                    Some(text) => match $kind {
                        K::Decimal => V::Decimal(text.parse().map_err(|_| corrupt("decimal", &text))?),
                        K::Date => V::Date(
                            time::Date::parse(&text, $crate::value::DATE_FORMAT)
                                .map_err(|_| corrupt("date", &text))?,
                        ),
                        K::Time => V::Time(
                            time::Time::parse(&text, $crate::value::TIME_FORMAT)
                                .map_err(|_| corrupt("time", &text))?,
                        ),
                        K::DateTime => V::DateTime(
                            $crate::value::parse_sqlite_datetime(&text)
                                .ok_or_else(|| corrupt("datetime", &text))?,
                        ),
                        _ => V::Json(serde_json::from_str(&text).map_err(|_| corrupt("json", &text))?),
                    },
                }
            }
        }
    }};
}
pub(crate) use decode_rows;

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn formats_datetimes_in_utc_with_millis() {
        let value = datetime!(2026-09-24 12:30:05.123456 +02:00);
        assert_eq!(format_datetime(value), "2026-09-24T10:30:05.123Z");
        assert_eq!(parse_sqlite_datetime("2026-09-24T10:30:05.123Z"), Some(truncate_millis(value)));
    }

    #[test]
    fn truncates_to_millis() {
        let value = datetime!(2026-09-24 10:30:05.123999 UTC);
        assert_eq!(truncate_millis(value), datetime!(2026-09-24 10:30:05.123 UTC));
    }
}
