//! Raw attribute → typed [`Attribute`], checking every self-contained rule.
//! Cross-references (targets, inverses, components) are checked in `validate`.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::model::{Attribute, AttributeKind, MediaType, RelationKind};
use crate::raw::RawAttribute;

/// Every `varchar` column is `varchar(255)`: MySQL counts `varchar` bytes against its
/// 65,535-byte row limit, so longer strings belong in `text`.
pub const VARCHAR_LENGTH: u32 = 255;
pub const MAX_DECIMAL_PRECISION: u8 = 38;
pub const DEFAULT_DECIMAL_PRECISION: u8 = 10;
pub const DEFAULT_DECIMAL_SCALE: u8 = 2;

/// Errors are `(path suffix, message)` pairs, e.g. `("maxLength", "must be ≤ 255")`.
pub type Issues = Vec<(String, String)>;

fn allowed_options(ty: &str) -> Option<&'static [&'static str]> {
    Some(match ty {
        "string" => &["default", "unique", "minLength", "maxLength", "regex"],
        "email" => &["default", "unique", "minLength", "maxLength"],
        "text" | "richtext" => &["default", "minLength", "maxLength"],
        "uid" => &["default", "targetField", "minLength", "maxLength", "regex"],
        "integer" | "biginteger" | "float" => &["default", "unique", "min", "max"],
        "decimal" => &["default", "unique", "min", "max", "precision", "scale"],
        "boolean" | "json" => &["default"],
        "blocks" => &[],
        "date" | "time" | "datetime" => &["default", "unique"],
        "enumeration" => &["default", "enum"],
        "relation" => &["relation", "target", "inversedBy", "mappedBy"],
        "component" => &["component", "repeatable", "min", "max"],
        "dynamiczone" => &["components", "min", "max"],
        "media" => &["multiple", "allowedTypes"],
        _ => return None,
    })
}

pub fn convert_attribute(raw: RawAttribute) -> Result<Attribute, Issues> {
    let mut issues = Issues::new();

    let Some(allowed) = allowed_options(&raw.ty) else {
        issues.push(("type".into(), format!("unknown attribute type `{}`", raw.ty)));
        return Err(issues);
    };
    for option in raw.present_options() {
        if !allowed.contains(&option) {
            issues.push((option.into(), format!("option not supported by type `{}`", raw.ty)));
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }

    let unique = raw.unique.unwrap_or(false);
    let kind = match raw.ty.as_str() {
        "string" => {
            check_lengths(&raw, true, &mut issues);
            check_regex(raw.regex.as_deref(), &mut issues);
            AttributeKind::String {
                min_length: raw.min_length,
                max_length: raw.max_length,
                regex: raw.regex.clone(),
                unique,
            }
        }
        "email" => {
            check_lengths(&raw, true, &mut issues);
            AttributeKind::Email { min_length: raw.min_length, max_length: raw.max_length, unique }
        }
        "text" => {
            check_lengths(&raw, false, &mut issues);
            AttributeKind::Text { min_length: raw.min_length, max_length: raw.max_length }
        }
        "richtext" => {
            check_lengths(&raw, false, &mut issues);
            AttributeKind::RichText { min_length: raw.min_length, max_length: raw.max_length }
        }
        "uid" => {
            check_lengths(&raw, true, &mut issues);
            check_regex(raw.regex.as_deref(), &mut issues);
            AttributeKind::Uid {
                target_field: raw.target_field.clone(),
                min_length: raw.min_length,
                max_length: raw.max_length,
                regex: raw.regex.clone(),
            }
        }
        "integer" | "biginteger" => {
            let min = integer_bound(raw.min.as_ref(), "min", &mut issues);
            let max = integer_bound(raw.max.as_ref(), "max", &mut issues);
            if let (Some(min), Some(max)) = (min, max)
                && min > max
            {
                issues.push(("min".into(), "must be ≤ max".into()));
            }
            if raw.ty == "integer" {
                AttributeKind::Integer { min, max, unique }
            } else {
                AttributeKind::BigInteger { min, max, unique }
            }
        }
        "float" | "decimal" => {
            let min = float_bound(raw.min.as_ref(), "min", &mut issues);
            let max = float_bound(raw.max.as_ref(), "max", &mut issues);
            if let (Some(min), Some(max)) = (min, max)
                && min > max
            {
                issues.push(("min".into(), "must be ≤ max".into()));
            }
            if raw.ty == "float" {
                AttributeKind::Float { min, max, unique }
            } else {
                let precision = raw.precision.unwrap_or(DEFAULT_DECIMAL_PRECISION);
                let scale = raw.scale.unwrap_or(DEFAULT_DECIMAL_SCALE);
                if !(1..=MAX_DECIMAL_PRECISION).contains(&precision) {
                    issues.push((
                        "precision".into(),
                        format!("must be between 1 and {MAX_DECIMAL_PRECISION}"),
                    ));
                }
                if scale > precision {
                    issues.push(("scale".into(), "must be ≤ precision".into()));
                }
                AttributeKind::Decimal { precision, scale, min, max, unique }
            }
        }
        "boolean" => AttributeKind::Boolean,
        "date" => AttributeKind::Date { unique },
        "time" => AttributeKind::Time { unique },
        "datetime" => AttributeKind::DateTime { unique },
        "json" => AttributeKind::Json,
        "blocks" => AttributeKind::Blocks,
        "enumeration" => {
            let values = raw.enum_values.clone().unwrap_or_default();
            if values.is_empty() {
                issues.push(("enum".into(), "must list at least one value".into()));
            }
            for (index, value) in values.iter().enumerate() {
                if value.is_empty() || value.chars().count() > VARCHAR_LENGTH as usize {
                    issues.push((
                        format!("enum[{index}]"),
                        format!("must be 1 to {VARCHAR_LENGTH} characters"),
                    ));
                }
                if values[..index].contains(value) {
                    issues.push((format!("enum[{index}]"), format!("duplicate value `{value}`")));
                }
            }
            AttributeKind::Enumeration { values }
        }
        "relation" => {
            let relation = match raw.relation.as_deref() {
                None => {
                    issues.push(("relation".into(), "is required".into()));
                    RelationKind::OneWay
                }
                Some(value) => RelationKind::parse(value).unwrap_or_else(|| {
                    issues.push(("relation".into(), format!("unknown relation kind `{value}`")));
                    RelationKind::OneWay
                }),
            };
            let target = match raw.target.as_deref() {
                None => {
                    issues.push(("target".into(), "is required".into()));
                    String::new()
                }
                Some(value) => normalize_content_type_uid(value).unwrap_or_else(|| {
                    issues.push((
                        "target".into(),
                        format!(
                            "`{value}` is not a content type (use `article` or `api::article`)"
                        ),
                    ));
                    String::new()
                }),
            };
            if raw.inversed_by.is_some() && raw.mapped_by.is_some() {
                issues.push(("mappedBy".into(), "cannot be combined with inversedBy".into()));
            }
            if relation.inverse().is_none()
                && (raw.inversed_by.is_some() || raw.mapped_by.is_some())
            {
                issues.push((
                    "relation".into(),
                    format!(
                        "`{}` relations are one-way: remove inversedBy/mappedBy",
                        relation.as_str()
                    ),
                ));
            }
            AttributeKind::Relation {
                relation,
                target,
                inversed_by: raw.inversed_by.clone(),
                mapped_by: raw.mapped_by.clone(),
            }
        }
        "component" => {
            let repeatable = raw.repeatable.unwrap_or(false);
            let (min, max) = count_bounds(&raw, &mut issues);
            if !repeatable && (min.is_some() || max.is_some()) {
                issues.push(("min".into(), "min/max only apply to repeatable components".into()));
            }
            let component = raw.component.clone().unwrap_or_else(|| {
                issues.push(("component".into(), "is required".into()));
                String::new()
            });
            AttributeKind::Component { component, repeatable, min, max }
        }
        "dynamiczone" => {
            let (min, max) = count_bounds(&raw, &mut issues);
            let components = raw.components.clone().unwrap_or_default();
            if components.is_empty() {
                issues.push(("components".into(), "must list at least one component".into()));
            }
            for (index, uid) in components.iter().enumerate() {
                if components[..index].contains(uid) {
                    issues.push((format!("components[{index}]"), format!("duplicate `{uid}`")));
                }
            }
            AttributeKind::DynamicZone { components, min, max }
        }
        "media" => {
            let mut allowed_types = Vec::new();
            for (index, value) in raw.allowed_types.iter().flatten().enumerate() {
                match MediaType::parse(value) {
                    Some(ty) if !allowed_types.contains(&ty) => allowed_types.push(ty),
                    Some(_) => issues.push((format!("allowedTypes[{index}]"), "duplicate".into())),
                    None => issues.push((
                        format!("allowedTypes[{index}]"),
                        format!("`{value}` is not one of images, videos, audios, files"),
                    )),
                }
            }
            AttributeKind::Media { multiple: raw.multiple.unwrap_or(false), allowed_types }
        }
        _ => unreachable!("type checked by allowed_options"),
    };

    if let Some(default) = &raw.default {
        check_default(&kind, default, &mut issues);
    }

    if issues.is_empty() {
        Ok(Attribute {
            required: raw.required.unwrap_or(false),
            private: raw.private.unwrap_or(false),
            configurable: raw.configurable.unwrap_or(true),
            localized: crate::raw::RawPluginOptions::localized(&raw.plugin_options).unwrap_or(true),
            default: raw.default,
            kind,
        })
    } else {
        Err(issues)
    }
}

/// `article`, `api::article` and `api::article.article` all mean `api::article`.
pub fn normalize_content_type_uid(value: &str) -> Option<String> {
    let name = value.strip_prefix("api::").unwrap_or(value);
    let name = match name.split_once('.') {
        Some((left, right)) if left == right => left,
        Some(_) => return None,
        None => name,
    };
    crate::naming::is_kebab_name(name).then(|| format!("api::{name}"))
}

fn check_lengths(raw: &RawAttribute, varchar: bool, issues: &mut Issues) {
    if let (Some(min), Some(max)) = (raw.min_length, raw.max_length)
        && min > max
    {
        issues.push(("minLength".into(), "must be ≤ maxLength".into()));
    }
    if varchar && raw.max_length.is_some_and(|max| max > VARCHAR_LENGTH) {
        issues.push((
            "maxLength".into(),
            format!("must be ≤ {VARCHAR_LENGTH}; use a `text` attribute for longer values"),
        ));
    }
}

fn check_regex(pattern: Option<&str>, issues: &mut Issues) {
    if let Some(pattern) = pattern
        // JavaScript-like patterns (look-around, backreferences), as in Strapi.
        && let Err(error) = fancy_regex::Regex::new(pattern)
    {
        issues.push(("regex".into(), format!("invalid regular expression: {error}")));
    }
}

fn integer_bound(value: Option<&Value>, name: &str, issues: &mut Issues) -> Option<i64> {
    let value = value?;
    let bound = value.as_i64();
    if bound.is_none() {
        issues.push((name.into(), "must be an integer".into()));
    }
    bound
}

fn float_bound(value: Option<&Value>, name: &str, issues: &mut Issues) -> Option<f64> {
    let value = value?;
    let bound = value.as_f64();
    if bound.is_none() {
        issues.push((name.into(), "must be a number".into()));
    }
    bound
}

fn count_bounds(raw: &RawAttribute, issues: &mut Issues) -> (Option<u32>, Option<u32>) {
    let mut bound = |value: Option<&Value>, name: &str| {
        let value = value?;
        let bound = value.as_u64().and_then(|value| u32::try_from(value).ok());
        if bound.is_none() {
            issues.push((name.into(), "must be a non-negative integer".into()));
        }
        bound
    };
    let min = bound(raw.min.as_ref(), "min");
    let max = bound(raw.max.as_ref(), "max");
    if let (Some(min), Some(max)) = (min, max)
        && min > max
    {
        issues.push(("min".into(), "must be ≤ max".into()));
    }
    (min, max)
}

static DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap());
static TIME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$").unwrap());
static DATETIME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$").unwrap()
});

fn check_default(kind: &AttributeKind, default: &Value, issues: &mut Issues) {
    let mut fail = |message: String| issues.push(("default".into(), message));
    match kind {
        AttributeKind::String { min_length, max_length, regex, .. }
        | AttributeKind::Uid { min_length, max_length, regex, .. } => {
            let Some(text) = default.as_str() else { return fail("must be a string".into()) };
            check_default_length(text, *min_length, *max_length, &mut fail);
            if let Some(pattern) = regex
                && let Ok(regex) = Regex::new(pattern)
                && !regex.is_match(text)
            {
                fail(format!("does not match regex `{pattern}`"));
            }
        }
        AttributeKind::Email { min_length, max_length, .. } => {
            let Some(text) = default.as_str() else { return fail("must be a string".into()) };
            check_default_length(text, *min_length, *max_length, &mut fail);
            if !text.contains('@') {
                fail("must be an email address".into());
            }
        }
        AttributeKind::Text { min_length, max_length }
        | AttributeKind::RichText { min_length, max_length } => {
            let Some(text) = default.as_str() else { return fail("must be a string".into()) };
            check_default_length(text, *min_length, *max_length, &mut fail);
        }
        AttributeKind::Integer { min, max, .. } | AttributeKind::BigInteger { min, max, .. } => {
            // biginteger values may be written as strings to survive JSON number precision.
            let value = default.as_i64().or_else(|| default.as_str()?.parse().ok());
            let Some(value) = value else { return fail("must be an integer".into()) };
            if min.is_some_and(|min| value < min) || max.is_some_and(|max| value > max) {
                fail("is outside min/max".into());
            }
        }
        AttributeKind::Float { min, max, .. } | AttributeKind::Decimal { min, max, .. } => {
            let Some(value) = default.as_f64() else { return fail("must be a number".into()) };
            if min.is_some_and(|min| value < min) || max.is_some_and(|max| value > max) {
                fail("is outside min/max".into());
            }
        }
        AttributeKind::Boolean => {
            if !default.is_boolean() {
                fail("must be a boolean".into());
            }
        }
        AttributeKind::Date { .. }
        | AttributeKind::Time { .. }
        | AttributeKind::DateTime { .. } => {
            let (regex, format) = match kind {
                AttributeKind::Date { .. } => (&*DATE, "YYYY-MM-DD"),
                AttributeKind::Time { .. } => (&*TIME, "HH:MM[:SS[.mmm]]"),
                _ => (&*DATETIME, "an RFC 3339 timestamp"),
            };
            if !default.as_str().is_some_and(|text| regex.is_match(text)) {
                fail(format!("must be {format}"));
            }
        }
        AttributeKind::Enumeration { values } => {
            if !default.as_str().is_some_and(|text| values.iter().any(|value| value == text)) {
                fail("must be one of the enum values".into());
            }
        }
        AttributeKind::Json => {}
        AttributeKind::Blocks => unreachable!("default rejected by allowed_options"),
        AttributeKind::Relation { .. }
        | AttributeKind::Media { .. }
        | AttributeKind::Component { .. }
        | AttributeKind::DynamicZone { .. } => unreachable!("default rejected by allowed_options"),
    }
}

fn check_default_length(
    text: &str,
    min: Option<u32>,
    max: Option<u32>,
    fail: &mut impl FnMut(String),
) {
    let length = u32::try_from(text.chars().count()).unwrap_or(u32::MAX);
    if min.is_some_and(|min| length < min) || max.is_some_and(|max| length > max) {
        fail("length is outside minLength/maxLength".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn convert(value: Value) -> Result<Attribute, Issues> {
        convert_attribute(serde_json::from_value(value).unwrap())
    }

    fn issue_paths(value: Value) -> Vec<String> {
        convert(value).unwrap_err().into_iter().map(|(path, _)| path).collect()
    }

    #[test]
    fn converts_string_with_options() {
        let attribute =
            convert(json!({ "type": "string", "required": true, "maxLength": 80, "unique": true }))
                .unwrap();
        assert!(attribute.required);
        assert!(attribute.kind.is_unique());
        assert_eq!(
            attribute.kind,
            AttributeKind::String {
                min_length: None,
                max_length: Some(80),
                regex: None,
                unique: true
            }
        );
    }

    #[test]
    fn rejects_options_of_other_types() {
        assert_eq!(issue_paths(json!({ "type": "boolean", "maxLength": 3 })), ["maxLength"]);
        assert_eq!(issue_paths(json!({ "type": "text", "unique": true })), ["unique"]);
        assert_eq!(
            issue_paths(
                json!({ "type": "relation", "relation": "oneWay", "target": "a", "default": 1 })
            ),
            ["default"]
        );
    }

    #[test]
    fn rejects_unknown_type() {
        assert_eq!(issue_paths(json!({ "type": "markdown" })), ["type"]);
    }

    #[test]
    fn converts_media() {
        let attribute = convert(
            json!({ "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }),
        )
        .unwrap();
        assert_eq!(
            attribute.kind,
            AttributeKind::Media {
                multiple: true,
                allowed_types: vec![MediaType::Images, MediaType::Videos]
            }
        );
        assert_eq!(
            issue_paths(
                json!({ "type": "media", "allowedTypes": ["pictures", "images", "images"] })
            ),
            ["allowedTypes[0]", "allowedTypes[2]"]
        );
        assert_eq!(issue_paths(json!({ "type": "media", "default": 1 })), ["default"]);
        assert!(!attribute.kind.has_column());
    }

    #[test]
    fn varchar_limit() {
        assert_eq!(issue_paths(json!({ "type": "string", "maxLength": 256 })), ["maxLength"]);
        assert!(convert(json!({ "type": "text", "maxLength": 10000 })).is_ok());
    }

    #[test]
    fn decimal_defaults_and_limits() {
        let attribute = convert(json!({ "type": "decimal" })).unwrap();
        assert!(matches!(attribute.kind, AttributeKind::Decimal { precision: 10, scale: 2, .. }));
        assert_eq!(issue_paths(json!({ "type": "decimal", "precision": 40 })), ["precision"]);
        assert_eq!(
            issue_paths(json!({ "type": "decimal", "precision": 4, "scale": 5 })),
            ["scale"]
        );
    }

    #[test]
    fn checks_defaults() {
        assert!(convert(json!({ "type": "integer", "default": 3, "min": 0 })).is_ok());
        assert_eq!(issue_paths(json!({ "type": "integer", "default": -1, "min": 0 })), ["default"]);
        assert_eq!(issue_paths(json!({ "type": "integer", "default": "x" })), ["default"]);
        assert!(convert(json!({ "type": "biginteger", "default": "9007199254740993" })).is_ok());
        assert_eq!(issue_paths(json!({ "type": "boolean", "default": "true" })), ["default"]);
        assert_eq!(
            issue_paths(json!({ "type": "enumeration", "enum": ["a"], "default": "b" })),
            ["default"]
        );
        assert!(convert(json!({ "type": "date", "default": "2026-09-24" })).is_ok());
        assert_eq!(issue_paths(json!({ "type": "date", "default": "24/09/2026" })), ["default"]);
        assert!(convert(json!({ "type": "datetime", "default": "2026-09-24T10:00:00Z" })).is_ok());
        assert_eq!(
            issue_paths(json!({ "type": "string", "regex": "^a", "default": "b" })),
            ["default"]
        );
    }

    #[test]
    fn enumeration_rules() {
        assert_eq!(issue_paths(json!({ "type": "enumeration", "enum": [] })), ["enum"]);
        assert_eq!(issue_paths(json!({ "type": "enumeration", "enum": ["a", "a"] })), ["enum[1]"]);
    }

    #[test]
    fn relation_rules() {
        let attribute = convert(json!({ "type": "relation", "relation": "manyToOne", "target": "api::category.category", "inversedBy": "articles" })).unwrap();
        assert!(
            matches!(attribute.kind, AttributeKind::Relation { ref target, .. } if target == "api::category")
        );
        assert_eq!(
            issue_paths(
                json!({ "type": "relation", "relation": "oneWay", "target": "a", "mappedBy": "b" })
            ),
            ["relation"]
        );
        assert_eq!(
            issue_paths(json!({ "type": "relation", "relation": "sideways", "target": "a" })),
            ["relation"]
        );
        assert_eq!(
            issue_paths(
                json!({ "type": "relation", "relation": "oneWay", "target": "plugin::upload.file" })
            ),
            ["target"]
        );
    }

    #[test]
    fn component_rules() {
        assert_eq!(
            issue_paths(json!({ "type": "component", "component": "a.b", "min": 1 })),
            ["min"]
        );
        assert!(
            convert(
                json!({ "type": "component", "component": "a.b", "repeatable": true, "max": 3 })
            )
            .is_ok()
        );
        assert_eq!(
            issue_paths(json!({ "type": "dynamiczone", "components": ["a.b", "a.b"] })),
            ["components[1]"]
        );
    }

    #[test]
    fn normalizes_content_type_uids() {
        assert_eq!(normalize_content_type_uid("article").as_deref(), Some("api::article"));
        assert_eq!(normalize_content_type_uid("api::article").as_deref(), Some("api::article"));
        assert_eq!(
            normalize_content_type_uid("api::article.article").as_deref(),
            Some("api::article")
        );
        assert_eq!(normalize_content_type_uid("api::article.post"), None);
        assert_eq!(normalize_content_type_uid("Article"), None);
    }
}
