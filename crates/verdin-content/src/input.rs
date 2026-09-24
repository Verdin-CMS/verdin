//! API JSON → validated column values (docs/architecture.md §11).
//!
//! Writes validate types and constraints. `required` is checked separately, on the
//! complete document, when it becomes published ([`check_required`]).

use std::str::FromStr;
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;
use rust_decimal::Decimal;
use serde_json::{Map, Value as Json};
use verdin_db::SqlValue;
use verdin_query::RelationInfo;
use verdin_query::temporal::{parse_date, parse_datetime, parse_time};
use verdin_schema::{Attribute, AttributeKind, Schema};

use crate::output::{OutputOptions, value_to_json};
use crate::{Issue, TypeModel};

/// Strapi's default `uid` alphabet.
static UID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9\-_.~]*$").unwrap());
static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap());

/// A validated write to one owning relation attribute.
#[derive(Debug, Clone, PartialEq)]
pub struct RelationWrite {
    pub field: String,
    pub info: RelationInfo,
    pub op: RelationOp,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RelationOp {
    /// Replace every link (`[..]`, `"id"`, `null`, `{ set: [..] }`).
    Set(Vec<String>),
    /// `{ connect: [..], disconnect: [..] }`.
    Change { connect: Vec<Connect>, disconnect: Vec<String> },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Connect {
    pub document_id: String,
    pub position: Option<Position>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Position {
    Start,
    End,
    Before(String),
    After(String),
}

/// Column assignments and relation writes of one request.
#[derive(Debug, Default)]
pub struct Prepared {
    pub columns: Vec<(String, SqlValue)>,
    pub relations: Vec<RelationWrite>,
}

/// Validates `data` for a create (`is_create`) or a partial update. On create, attribute
/// defaults fill in missing values.
pub fn prepare(
    model: &TypeModel,
    schema: &Schema,
    data: &Json,
    is_create: bool,
) -> Result<Prepared, Vec<Issue>> {
    let Some(object) = data.as_object() else {
        return Err(vec![Issue::new(Vec::new(), "data must be an object")]);
    };
    let mut issues = Vec::new();
    let mut columns = Vec::new();
    let mut relations = Vec::new();

    for (key, value) in object {
        match model.content_type.attributes.get(key) {
            None => issues.push(Issue::new(vec![key.clone().into()], format!("Invalid key {key}"))),
            Some(Attribute {
                kind: AttributeKind::Relation { mapped_by: Some(owner), target, .. },
                ..
            }) => {
                issues.push(Issue::new(
                    vec![key.clone().into()],
                    format!(
                        "`{key}` is the inverse side of {target}.{owner}; write the relation there"
                    ),
                ));
            }
            Some(Attribute { kind: AttributeKind::Relation { .. }, .. }) => {
                let field = model.fields.get(key).expect("attribute field");
                let info = field.relation.clone().expect("relation info");
                match relation_op(value, info.to_many) {
                    Ok(op) => relations.push(RelationWrite { field: key.clone(), info, op }),
                    Err(message) => issues.push(Issue::new(vec![key.clone().into()], message)),
                }
            }
            Some(_) => {}
        }
    }

    for (name, attribute) in &model.content_type.attributes {
        if matches!(attribute.kind, AttributeKind::Relation { .. }) {
            continue;
        }
        let value = match object.get(name) {
            Some(value) => value.clone(),
            None if is_create => match &attribute.default {
                Some(default) => default.clone(),
                None => continue,
            },
            None => continue,
        };
        let path = vec![Json::from(name.as_str())];
        match convert(schema, &attribute.kind, &value, &path, true) {
            Ok(converted) => {
                let column = Attribute::column_name(name);
                let (kind, _) = verdin_query::attribute_kind(&attribute.kind);
                let value = match converted {
                    Converted::Sql(value) => value,
                    Converted::Json(Json::Null) => SqlValue::Null(kind),
                    Converted::Json(mut json) => {
                        assign_ids(schema, &attribute.kind, &mut json);
                        SqlValue::Json(json)
                    }
                };
                columns.push((column, value));
            }
            Err(mut found) => issues.append(&mut found),
        }
    }

    if issues.is_empty() { Ok(Prepared { columns, relations }) } else { Err(issues) }
}

/// Parses Strapi v5 relation input: `"id"`, `{ documentId }`, `[..]`, `null`, or
/// `{ connect, disconnect, set }` where `connect` items may carry a `position`.
fn relation_op(value: &Json, to_many: bool) -> Result<RelationOp, String> {
    fn id(value: &Json) -> Result<String, String> {
        let id = match value {
            Json::String(id) => Some(id.as_str()),
            Json::Object(object)
                if object.keys().all(|key| key == "documentId" || key == "position") =>
            {
                object.get("documentId").and_then(Json::as_str)
            }
            _ => None,
        };
        id.filter(|id| !id.is_empty()).map(str::to_owned).ok_or_else(|| {
            "relations take documentIds (strings) or `{ \"documentId\": … }`".to_owned()
        })
    }
    fn ids(value: &Json) -> Result<Vec<String>, String> {
        match value {
            Json::Array(items) => items.iter().map(id).collect(),
            other => Ok(vec![id(other)?]),
        }
    }
    let single = |count: usize| {
        if !to_many && count > 1 {
            Err("this relation links a single document".to_owned())
        } else {
            Ok(())
        }
    };

    let op = match value {
        Json::Null => RelationOp::Set(Vec::new()),
        Json::Object(object)
            if ["connect", "disconnect", "set"].iter().any(|key| object.contains_key(*key)) =>
        {
            if let Some(key) =
                object.keys().find(|key| !["connect", "disconnect", "set"].contains(&key.as_str()))
            {
                return Err(format!("invalid key `{key}` in relation input"));
            }
            if let Some(set) = object.get("set") {
                if object.contains_key("connect") || object.contains_key("disconnect") {
                    return Err("`set` cannot be combined with `connect` or `disconnect`".into());
                }
                RelationOp::Set(ids(set)?)
            } else {
                let disconnect = object.get("disconnect").map(ids).transpose()?.unwrap_or_default();
                let connect = match object.get("connect") {
                    None => Vec::new(),
                    Some(Json::Array(items)) => {
                        items.iter().map(connect_item).collect::<Result<_, _>>()?
                    }
                    Some(item) => vec![connect_item(item)?],
                };
                single(connect.len())?;
                RelationOp::Change { connect, disconnect }
            }
        }
        other => RelationOp::Set(ids(other)?),
    };
    if let RelationOp::Set(ids) = &op {
        single(ids.len())?;
    }
    Ok(op)
}

fn connect_item(value: &Json) -> Result<Connect, String> {
    let document_id = match value {
        Json::String(id) => id.clone(),
        Json::Object(object) => {
            if let Some(key) = object.keys().find(|key| *key != "documentId" && *key != "position")
            {
                return Err(format!("invalid key `{key}` in connect"));
            }
            object.get("documentId").and_then(Json::as_str).unwrap_or_default().to_owned()
        }
        _ => String::new(),
    };
    if document_id.is_empty() {
        return Err("connect items take a documentId".into());
    }
    let position = match value.get("position") {
        None => None,
        Some(Json::Object(position)) => {
            let reference = |key: &str| position.get(key).and_then(Json::as_str).map(str::to_owned);
            Some(if let Some(id) = reference("before") {
                Position::Before(id)
            } else if let Some(id) = reference("after") {
                Position::After(id)
            } else if position.get("start") == Some(&Json::Bool(true)) {
                Position::Start
            } else if position.get("end") == Some(&Json::Bool(true)) {
                Position::End
            } else {
                return Err(
                    "position must be { before }, { after }, { start: true } or { end: true }"
                        .into(),
                );
            })
        }
        Some(_) => return Err("position must be an object".into()),
    };
    Ok(Connect { document_id, position })
}

enum Converted {
    Sql(SqlValue),
    /// Components, dynamic zones and JSON attributes.
    Json(Json),
}

fn convert(
    schema: &Schema,
    kind: &AttributeKind,
    value: &Json,
    path: &[Json],
    new_items_get_defaults: bool,
) -> Result<Converted, Vec<Issue>> {
    let fail = |message: String| vec![Issue::new(path.to_vec(), message)];
    let (column_kind, _) = verdin_query::attribute_kind(kind);
    if value.is_null() {
        return Ok(match kind {
            AttributeKind::Json
            | AttributeKind::Component { .. }
            | AttributeKind::DynamicZone { .. } => Converted::Json(Json::Null),
            _ => Converted::Sql(SqlValue::Null(column_kind)),
        });
    }

    let value = match kind {
        AttributeKind::String { min_length, max_length, regex, .. } => {
            let text = expect_str(value).ok_or_else(|| fail("must be a string".into()))?;
            check_length(text, *min_length, *max_length).map_err(fail)?;
            if let Some(pattern) = regex
                && !Regex::new(pattern).is_ok_and(|regex| regex.is_match(text))
            {
                return Err(fail(format!("must match {pattern}")));
            }
            SqlValue::Text(text.to_owned())
        }
        AttributeKind::Email { min_length, max_length, .. } => {
            let text = expect_str(value).ok_or_else(|| fail("must be a string".into()))?;
            check_length(text, *min_length, *max_length).map_err(fail)?;
            if !EMAIL.is_match(text) {
                return Err(fail("must be a valid email".into()));
            }
            SqlValue::Text(text.to_owned())
        }
        AttributeKind::Text { min_length, max_length }
        | AttributeKind::RichText { min_length, max_length } => {
            let text = expect_str(value).ok_or_else(|| fail("must be a string".into()))?;
            check_length(text, *min_length, *max_length).map_err(fail)?;
            SqlValue::Text(text.to_owned())
        }
        AttributeKind::Uid { min_length, max_length, regex, .. } => {
            let text = expect_str(value).ok_or_else(|| fail("must be a string".into()))?;
            check_length(text, *min_length, *max_length).map_err(fail)?;
            let valid = match regex {
                Some(pattern) => Regex::new(pattern).is_ok_and(|regex| regex.is_match(text)),
                None => UID.is_match(text),
            };
            if !valid {
                return Err(fail(format!(
                    "must match {}",
                    regex.as_deref().unwrap_or(UID.as_str())
                )));
            }
            SqlValue::Text(text.to_owned())
        }
        AttributeKind::Enumeration { values } => {
            let text = expect_str(value).ok_or_else(|| fail("must be a string".into()))?;
            if !values.iter().any(|allowed| allowed == text) {
                return Err(fail(format!("must be one of: {}", values.join(", "))));
            }
            SqlValue::Text(text.to_owned())
        }
        AttributeKind::Integer { min, max, .. } => {
            let number = integer(value).and_then(|number| i32::try_from(number).ok());
            let number = number.ok_or_else(|| {
                fail("must be an integer between -2147483648 and 2147483647".into())
            })?;
            check_range(i64::from(number) as f64, min.map(|v| v as f64), max.map(|v| v as f64))
                .map_err(fail)?;
            SqlValue::Int(number)
        }
        AttributeKind::BigInteger { min, max, .. } => {
            let number = integer(value).ok_or_else(|| fail("must be an integer".into()))?;
            if min.is_some_and(|min| number < min) || max.is_some_and(|max| number > max) {
                return Err(fail(bounds_message(
                    min.map(|v| v.to_string()),
                    max.map(|v| v.to_string()),
                )));
            }
            SqlValue::BigInt(number)
        }
        AttributeKind::Float { min, max, .. } => {
            let number = value.as_f64().filter(|number| number.is_finite());
            let number = number.ok_or_else(|| fail("must be a number".into()))?;
            check_range(number, *min, *max).map_err(fail)?;
            SqlValue::Double(number)
        }
        AttributeKind::Decimal { precision, scale, min, max, .. } => {
            let parsed = match value {
                Json::Number(number) => Decimal::from_str(&number.to_string())
                    .or_else(|_| Decimal::from_scientific(&number.to_string()))
                    .ok(),
                Json::String(text) => Decimal::from_str(text.trim()).ok(),
                _ => None,
            };
            // Round half away from zero, like PostgreSQL and MySQL do on insert.
            let number =
                parsed.ok_or_else(|| fail("must be a number".into()))?.round_dp_with_strategy(
                    u32::from(*scale),
                    rust_decimal::RoundingStrategy::MidpointAwayFromZero,
                );
            let integer_digits = number.trunc().abs().to_string().trim_start_matches('0').len();
            if integer_digits > usize::from(precision - scale) {
                return Err(fail(format!(
                    "must have at most {} digits before the decimal point",
                    precision - scale
                )));
            }
            use rust_decimal::prelude::ToPrimitive;
            check_range(number.to_f64().unwrap_or_default(), *min, *max).map_err(fail)?;
            SqlValue::Decimal(number)
        }
        AttributeKind::Boolean => {
            SqlValue::Bool(value.as_bool().ok_or_else(|| fail("must be a boolean".into()))?)
        }
        AttributeKind::Date { .. } => {
            let date = expect_str(value).and_then(parse_date);
            SqlValue::Date(date.ok_or_else(|| fail("must be a date (YYYY-MM-DD)".into()))?)
        }
        AttributeKind::Time { .. } => {
            let time = expect_str(value).and_then(parse_time);
            SqlValue::Time(time.ok_or_else(|| fail("must be a time (HH:MM:SS.mmm)".into()))?)
        }
        AttributeKind::DateTime { .. } => {
            let datetime = expect_str(value).and_then(parse_datetime);
            SqlValue::DateTime(
                datetime.ok_or_else(|| fail("must be an ISO 8601 timestamp".into()))?,
            )
        }
        AttributeKind::Json => return Ok(Converted::Json(value.clone())),
        AttributeKind::Component { component, repeatable, min, max } => {
            let normalized = if *repeatable {
                let items =
                    value.as_array().ok_or_else(|| fail("must be a list of components".into()))?;
                check_count(items.len(), *min, *max).map_err(fail)?;
                let mut out = Vec::with_capacity(items.len());
                let mut issues = Vec::new();
                for (index, item) in items.iter().enumerate() {
                    let item_path = child_path(path, index);
                    match component_item(
                        schema,
                        component,
                        item,
                        &item_path,
                        None,
                        new_items_get_defaults,
                    ) {
                        Ok(item) => out.push(item),
                        Err(mut found) => issues.append(&mut found),
                    }
                }
                if !issues.is_empty() {
                    return Err(issues);
                }
                Json::Array(out)
            } else {
                component_item(schema, component, value, path, None, new_items_get_defaults)?
            };
            return Ok(Converted::Json(normalized));
        }
        AttributeKind::DynamicZone { components, min, max } => {
            let items =
                value.as_array().ok_or_else(|| fail("must be a list of components".into()))?;
            check_count(items.len(), *min, *max).map_err(fail)?;
            let mut out = Vec::with_capacity(items.len());
            let mut issues = Vec::new();
            for (index, item) in items.iter().enumerate() {
                let item_path = child_path(path, index);
                let uid = item.get("__component").and_then(Json::as_str);
                let Some(uid) = uid.filter(|uid| components.iter().any(|allowed| allowed == uid))
                else {
                    issues.push(Issue::new(
                        item_path,
                        format!("__component must be one of: {}", components.join(", ")),
                    ));
                    continue;
                };
                match component_item(
                    schema,
                    uid,
                    item,
                    &item_path,
                    Some(uid),
                    new_items_get_defaults,
                ) {
                    Ok(item) => out.push(item),
                    Err(mut found) => issues.append(&mut found),
                }
            }
            if !issues.is_empty() {
                return Err(issues);
            }
            return Ok(Converted::Json(Json::Array(out)));
        }
        AttributeKind::Relation { .. } => {
            return Err(fail("writing relations is not supported yet".into()));
        }
    };
    Ok(Converted::Sql(value))
}

/// Validates one component object and returns it in canonical form
/// (`id`, `__component` for dynamic zones, then attributes in schema order).
fn component_item(
    schema: &Schema,
    uid: &str,
    value: &Json,
    path: &[Json],
    dynamic_zone_uid: Option<&str>,
    new_items_get_defaults: bool,
) -> Result<Json, Vec<Issue>> {
    let Some(object) = value.as_object() else {
        return Err(vec![Issue::new(path.to_vec(), "must be an object")]);
    };
    let component = schema.component(uid).expect("validated schema references existing components");
    let mut issues = Vec::new();
    let mut out = Map::new();

    let id = match object.get("id") {
        None | Some(Json::Null) => None,
        Some(id) => match id.as_u64().filter(|id| *id > 0) {
            Some(id) => Some(id),
            None => {
                issues.push(Issue::new(child_path(path, "id"), "must be a positive integer"));
                None
            }
        },
    };
    if let Some(id) = id {
        out.insert("id".into(), Json::from(id));
    }
    if let Some(uid) = dynamic_zone_uid {
        out.insert("__component".into(), Json::from(uid));
    }

    for key in object.keys() {
        let allowed = key == "id" || (key == "__component" && dynamic_zone_uid.is_some());
        if !allowed && !component.attributes.contains_key(key) {
            issues.push(Issue::new(child_path(path, key.as_str()), format!("Invalid key {key}")));
        }
    }

    for (name, attribute) in &component.attributes {
        let value = match object.get(name) {
            Some(value) => value.clone(),
            None if id.is_none() && new_items_get_defaults => match &attribute.default {
                Some(default) => default.clone(),
                None => continue,
            },
            None => continue,
        };
        let attribute_path = child_path(path, name.as_str());
        if matches!(attribute.kind, AttributeKind::Relation { .. }) {
            issues.push(Issue::new(attribute_path, "writing relations is not supported yet"));
            continue;
        }
        match convert(schema, &attribute.kind, &value, &attribute_path, new_items_get_defaults) {
            Ok(Converted::Sql(value)) => {
                out.insert(
                    name.clone(),
                    value_to_json(Some(&attribute.kind), value, OutputOptions::default()),
                );
            }
            Ok(Converted::Json(json)) => {
                out.insert(name.clone(), json);
            }
            Err(mut found) => issues.append(&mut found),
        }
    }

    if issues.is_empty() { Ok(Json::Object(out)) } else { Err(issues) }
}

/// Gives every component item without an `id` one that is unique within the attribute
/// value (nested components included). Walks by schema, so `json` attributes inside
/// components are never mistaken for component items.
fn assign_ids(schema: &Schema, kind: &AttributeKind, value: &mut Json) {
    /// A component item and the attributes of its component.
    type Item<'a> = (&'a mut Map<String, Json>, &'a IndexMap<String, Attribute>);

    fn items<'a>(schema: &'a Schema, kind: &AttributeKind, value: &'a mut Json) -> Vec<Item<'a>> {
        let mut out = Vec::new();
        match (kind, value) {
            (AttributeKind::Component { component, .. }, Json::Object(object)) => {
                out.push((
                    object,
                    &schema.component(component).expect("validated schema").attributes,
                ));
            }
            (AttributeKind::Component { component, .. }, Json::Array(list)) => {
                let attributes = &schema.component(component).expect("validated schema").attributes;
                out.extend(
                    list.iter_mut()
                        .filter_map(Json::as_object_mut)
                        .map(|object| (object, attributes)),
                );
            }
            (AttributeKind::DynamicZone { .. }, Json::Array(list)) => {
                for object in list.iter_mut().filter_map(Json::as_object_mut) {
                    let uid = object.get("__component").and_then(Json::as_str).map(str::to_owned);
                    if let Some(component) = uid.and_then(|uid| schema.component(&uid)) {
                        out.push((object, &component.attributes));
                    }
                }
            }
            _ => {}
        }
        out
    }

    fn max_id(schema: &Schema, kind: &AttributeKind, value: &mut Json) -> u64 {
        let mut max = 0;
        for (object, attributes) in items(schema, kind, value) {
            max = max.max(object.get("id").and_then(Json::as_u64).unwrap_or(0));
            for (name, attribute) in attributes {
                if let Some(child) = object.get_mut(name) {
                    max = max.max(max_id(schema, &attribute.kind, child));
                }
            }
        }
        max
    }

    fn assign(schema: &Schema, kind: &AttributeKind, value: &mut Json, next: &mut u64) {
        for (object, attributes) in items(schema, kind, value) {
            if !object.contains_key("id") {
                *next += 1;
                // Keep `id` first for readability.
                let mut ordered = Map::new();
                ordered.insert("id".into(), Json::from(*next));
                ordered.extend(std::mem::take(object));
                *object = ordered;
            }
            for (name, attribute) in attributes {
                if let Some(child) = object.get_mut(name) {
                    assign(schema, &attribute.kind, child, next);
                }
            }
        }
    }

    let mut next = max_id(schema, kind, value);
    assign(schema, kind, value, &mut next);
}

/// `required` issues of a complete document (as returned by the internal full read),
/// including required attributes inside components and dynamic zones.
pub fn check_required(
    schema: &Schema,
    attributes: &IndexMap<String, Attribute>,
    document: &Json,
    path: &[Json],
) -> Vec<Issue> {
    let mut issues = Vec::new();
    for (name, attribute) in attributes {
        let value = document.get(name).unwrap_or(&Json::Null);
        let attribute_path = child_path(path, name.as_str());
        let missing = match value {
            Json::Null => true,
            Json::String(text) => text.is_empty(),
            Json::Array(items) => items.is_empty(),
            _ => false,
        };
        if attribute.required
            && missing
            && !matches!(attribute.kind, AttributeKind::Relation { .. })
        {
            issues.push(Issue::new(attribute_path.clone(), format!("{name} is a required field")));
            continue;
        }
        match (&attribute.kind, value) {
            (AttributeKind::Component { component, .. }, Json::Object(_)) => {
                let component = schema.component(component).expect("validated schema");
                issues.extend(check_required(
                    schema,
                    &component.attributes,
                    value,
                    &attribute_path,
                ));
            }
            (AttributeKind::Component { component, .. }, Json::Array(items)) => {
                let component = schema.component(component).expect("validated schema");
                for (index, item) in items.iter().enumerate() {
                    issues.extend(check_required(
                        schema,
                        &component.attributes,
                        item,
                        &child_path(&attribute_path, index),
                    ));
                }
            }
            (AttributeKind::DynamicZone { .. }, Json::Array(items)) => {
                for (index, item) in items.iter().enumerate() {
                    if let Some(component) = item
                        .get("__component")
                        .and_then(Json::as_str)
                        .and_then(|uid| schema.component(uid))
                    {
                        issues.extend(check_required(
                            schema,
                            &component.attributes,
                            item,
                            &child_path(&attribute_path, index),
                        ));
                    }
                }
            }
            _ => {}
        }
    }
    issues
}

fn child_path(path: &[Json], segment: impl Into<Json>) -> Vec<Json> {
    let mut child = path.to_vec();
    child.push(segment.into());
    child
}

fn expect_str(value: &Json) -> Option<&str> {
    value.as_str()
}

/// JSON integers, and integer strings (form submissions, bigintegers).
fn integer(value: &Json) -> Option<i64> {
    match value {
        Json::Number(number) => number.as_i64(),
        Json::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn check_length(text: &str, min: Option<u32>, max: Option<u32>) -> Result<(), String> {
    let length = text.chars().count();
    if let Some(min) = min
        && length < min as usize
    {
        return Err(format!("must be at least {min} characters"));
    }
    if let Some(max) = max
        && length > max as usize
    {
        return Err(format!("must be at most {max} characters"));
    }
    Ok(())
}

fn check_range(value: f64, min: Option<f64>, max: Option<f64>) -> Result<(), String> {
    if min.is_some_and(|min| value < min) || max.is_some_and(|max| value > max) {
        return Err(bounds_message(min.map(|v| v.to_string()), max.map(|v| v.to_string())));
    }
    Ok(())
}

fn bounds_message(min: Option<String>, max: Option<String>) -> String {
    match (min, max) {
        (Some(min), Some(max)) => format!("must be between {min} and {max}"),
        (Some(min), None) => format!("must be greater than or equal to {min}"),
        (None, Some(max)) => format!("must be less than or equal to {max}"),
        (None, None) => unreachable!("only called when a bound is violated"),
    }
}

fn check_count(count: usize, min: Option<u32>, max: Option<u32>) -> Result<(), String> {
    if let Some(min) = min
        && count < min as usize
    {
        return Err(format!("must contain at least {min} items"));
    }
    if let Some(max) = max
        && count > max as usize
    {
        return Err(format!("must contain at most {max} items"));
    }
    Ok(())
}
