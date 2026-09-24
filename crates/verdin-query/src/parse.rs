//! Query-string tree → validated [`Query`] (docs/architecture.md §12.2).

use indexmap::IndexMap;
use rust_decimal::Decimal;
use verdin_db::{ColumnKind, SqlValue};

use crate::QueryError;
use crate::ast::*;
use crate::fields::{Field, FieldCategory, TypeFields};
use crate::params::Node;
use crate::temporal::{parse_date, parse_datetime, parse_time};

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub default_page_size: u64,
    pub max_page_size: u64,
    pub max_conditions: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { default_page_size: 25, max_page_size: 100, max_conditions: 100 }
    }
}

const KNOWN_PARAMETERS: &[&str] =
    &["filters", "sort", "fields", "populate", "pagination", "status", "locale"];

pub fn parse(
    root: &IndexMap<String, Node>,
    fields: &TypeFields,
    limits: &Limits,
) -> Result<Query, QueryError> {
    for key in root.keys() {
        if !KNOWN_PARAMETERS.contains(&key.as_str()) {
            return Err(QueryError::new(format!("invalid query parameter `{key}`")));
        }
    }

    let mut conditions = 0;
    let filters = root
        .get("filters")
        .map(|node| {
            let map =
                node.as_map().ok_or_else(|| QueryError::new("`filters` must be an object"))?;
            parse_filter_map(map, fields, &mut conditions, limits)
        })
        .transpose()?;

    Ok(Query {
        filters,
        sort: root
            .get("sort")
            .map(|node| parse_sort(node, fields))
            .transpose()?
            .unwrap_or_default(),
        fields: root.get("fields").map(|node| parse_fields(node, fields)).transpose()?,
        populate: root
            .get("populate")
            .map(|node| parse_populate(node, fields))
            .transpose()?
            .unwrap_or_default(),
        pagination: parse_pagination(root.get("pagination"), limits)?,
        status: match root.get("status").map(|node| node.as_leaf()) {
            None => Status::Published,
            Some(Some("published")) => Status::Published,
            Some(Some("draft")) => Status::Draft,
            Some(_) => return Err(QueryError::new("`status` must be `published` or `draft`")),
        },
    })
}

fn parse_filter_map(
    map: &IndexMap<String, Node>,
    fields: &TypeFields,
    conditions: &mut usize,
    limits: &Limits,
) -> Result<Filter, QueryError> {
    let mut all = Vec::with_capacity(map.len());
    for (key, node) in map {
        let filter = match key.as_str() {
            "$and" | "$or" => {
                let items =
                    node.as_list().filter(|items| items.iter().all(|item| item.as_map().is_some()));
                let items = items.ok_or_else(|| {
                    QueryError::new(format!("`{key}` must be a list of filter objects"))
                })?;
                let children = items
                    .into_iter()
                    .map(|item| {
                        parse_filter_map(
                            item.as_map().expect("checked"),
                            fields,
                            conditions,
                            limits,
                        )
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if key == "$and" { Filter::And(children) } else { Filter::Or(children) }
            }
            "$not" => {
                let map = node
                    .as_map()
                    .ok_or_else(|| QueryError::new("`$not` must be a filter object"))?;
                Filter::Not(Box::new(parse_filter_map(map, fields, conditions, limits)?))
            }
            name if name.starts_with('$') => {
                return Err(QueryError::new(format!(
                    "invalid filter operator `{name}` at the top level"
                )));
            }
            name => parse_field_filter(name, node, fields, conditions, limits)?,
        };
        all.push(filter);
    }
    Ok(if all.len() == 1 { all.pop().expect("one") } else { Filter::And(all) })
}

fn parse_field_filter(
    name: &str,
    node: &Node,
    fields: &TypeFields,
    conditions: &mut usize,
    limits: &Limits,
) -> Result<Filter, QueryError> {
    let field = fields
        .get(name)
        .ok_or_else(|| QueryError::new(format!("invalid key `{name}` in filters")))?;
    match field.category {
        FieldCategory::Scalar if !field.is_private() => {}
        FieldCategory::Relation | FieldCategory::Nested if !field.is_private() => {
            return Err(QueryError::new(format!(
                "filtering on nested fields of `{name}` is not supported yet"
            )));
        }
        _ => return Err(QueryError::new(format!("invalid key `{name}` in filters"))),
    }

    let operators: Vec<(&str, &Node)> = match node {
        Node::Leaf(_) => vec![("$eq", node)],
        Node::Map(map) => map.iter().map(|(key, value)| (key.as_str(), value)).collect(),
    };
    let mut filters = Vec::with_capacity(operators.len());
    for (op_name, operand) in operators {
        *conditions += 1;
        if *conditions > limits.max_conditions {
            return Err(QueryError::new(format!(
                "more than {} filter conditions",
                limits.max_conditions
            )));
        }
        let op = Op::parse(op_name).ok_or_else(|| {
            if op_name.starts_with('$') {
                QueryError::new(format!("invalid filter operator `{op_name}` on `{name}`"))
            } else {
                QueryError::new(format!("`{name}` has no nested field `{op_name}`"))
            }
        })?;
        filters.push(Filter::Condition(parse_condition(field, op, op_name, operand)?));
    }
    Ok(if filters.len() == 1 { filters.pop().expect("one") } else { Filter::And(filters) })
}

fn parse_condition(
    field: &Field,
    op: Op,
    op_name: &str,
    node: &Node,
) -> Result<Condition, QueryError> {
    let name = &field.api;
    let unsupported = || QueryError::new(format!("`{op_name}` cannot be used on `{name}`"));
    if field.kind == ColumnKind::Json && !matches!(op, Op::IsNull | Op::IsNotNull) {
        return Err(unsupported());
    }
    if (op.is_text_only() && !field.is_text())
        || (op.is_ordering() && field.kind == ColumnKind::Bool)
    {
        return Err(unsupported());
    }

    fn single<'a>(node: &'a Node, name: &str, op_name: &str) -> Result<&'a str, QueryError> {
        node.as_leaf()
            .ok_or_else(|| QueryError::new(format!("`{name}.{op_name}` expects a single value")))
    }
    let leaf = |node| single(node, name, op_name);
    let value = |text: &str| scalar_value(field, text);

    let operand = match op {
        Op::IsNull | Op::IsNotNull => {
            let flag = match leaf(node)? {
                "true" | "1" => true,
                "false" | "0" => false,
                other => {
                    return Err(QueryError::new(format!(
                        "`{name}.{op_name}` expects true or false, got `{other}`"
                    )));
                }
            };
            let op = if flag == (op == Op::IsNull) { Op::IsNull } else { Op::IsNotNull };
            return Ok(Condition {
                column: field.column.clone(),
                kind: field.kind,
                op,
                operand: Operand::None,
            });
        }
        Op::In | Op::NotIn => {
            let items = node
                .as_list()
                .ok_or_else(|| QueryError::new(format!("`{name}.{op_name}` expects a list")))?;
            Operand::List(
                items.into_iter().map(|item| value(leaf(item)?)).collect::<Result<_, _>>()?,
            )
        }
        Op::Between => {
            let items = node.as_list().filter(|items| items.len() == 2);
            let items = items
                .ok_or_else(|| QueryError::new(format!("`{name}.$between` expects two values")))?;
            Operand::Pair(value(leaf(items[0])?)?, value(leaf(items[1])?)?)
        }
        _ => Operand::Value(value(leaf(node)?)?),
    };
    Ok(Condition { column: field.column.clone(), kind: field.kind, op, operand })
}

/// Converts a query-string value to the field's column type.
pub fn scalar_value(field: &Field, text: &str) -> Result<SqlValue, QueryError> {
    let invalid = |expected: &str| {
        QueryError::new(format!("`{}` expects {expected}, got `{text}`", field.api))
    };
    Ok(match field.kind {
        ColumnKind::Text => SqlValue::Text(text.to_owned()),
        ColumnKind::Int => SqlValue::Int(text.parse().map_err(|_| invalid("an integer"))?),
        ColumnKind::SmallInt => {
            SqlValue::SmallInt(text.parse().map_err(|_| invalid("an integer"))?)
        }
        ColumnKind::BigInt => SqlValue::BigInt(text.parse().map_err(|_| invalid("an integer"))?),
        ColumnKind::Double => SqlValue::Double(
            text.parse::<f64>()
                .ok()
                .filter(|value| value.is_finite())
                .ok_or_else(|| invalid("a number"))?,
        ),
        ColumnKind::Decimal => {
            SqlValue::Decimal(text.parse::<Decimal>().map_err(|_| invalid("a number"))?)
        }
        ColumnKind::Bool => SqlValue::Bool(match text {
            "true" | "1" => true,
            "false" | "0" => false,
            _ => return Err(invalid("true or false")),
        }),
        ColumnKind::Date => {
            SqlValue::Date(parse_date(text).ok_or_else(|| invalid("a date (YYYY-MM-DD)"))?)
        }
        ColumnKind::Time => {
            SqlValue::Time(parse_time(text).ok_or_else(|| invalid("a time (HH:MM:SS)"))?)
        }
        ColumnKind::DateTime => SqlValue::DateTime(
            parse_datetime(text).ok_or_else(|| invalid("an ISO 8601 timestamp"))?,
        ),
        ColumnKind::Json => return Err(invalid("no value")),
    })
}

fn parse_sort(node: &Node, fields: &TypeFields) -> Result<Vec<Sort>, QueryError> {
    let items =
        node.as_list().ok_or_else(|| QueryError::new("`sort` must be a value or a list"))?;
    let mut sort = Vec::new();
    for item in items {
        let text = item
            .as_leaf()
            .ok_or_else(|| QueryError::new("`sort` entries must be `field` or `field:asc|desc`"))?;
        for part in text.split(',').map(str::trim).filter(|part| !part.is_empty()) {
            let (name, direction) = part.split_once(':').unwrap_or((part, "asc"));
            let descending = match direction.to_ascii_lowercase().as_str() {
                "asc" => false,
                "desc" => true,
                _ => {
                    return Err(QueryError::new(format!(
                        "invalid sort direction `{direction}` (use asc or desc)"
                    )));
                }
            };
            let field = fields
                .get(name)
                .filter(|field| field.is_sortable())
                .ok_or_else(|| QueryError::new(format!("cannot sort by `{name}`")))?;
            sort.push(Sort { column: field.column.clone(), descending });
        }
    }
    Ok(sort)
}

fn parse_fields(node: &Node, fields: &TypeFields) -> Result<Vec<String>, QueryError> {
    let items =
        node.as_list().ok_or_else(|| QueryError::new("`fields` must be a value or a list"))?;
    let mut selected = Vec::new();
    for item in items {
        let text = item
            .as_leaf()
            .ok_or_else(|| QueryError::new("`fields` entries must be field names"))?;
        for name in text.split(',').map(str::trim).filter(|name| !name.is_empty()) {
            let valid = fields.get(name).is_some_and(|field| {
                field.category == FieldCategory::Scalar && !field.is_private()
            });
            if !valid {
                return Err(QueryError::new(format!("invalid key `{name}` in fields")));
            }
            if !selected.iter().any(|existing| existing == name) {
                selected.push(name.to_owned());
            }
        }
    }
    Ok(selected)
}

fn parse_populate(node: &Node, fields: &TypeFields) -> Result<Vec<String>, QueryError> {
    let names: Vec<String> = match node {
        Node::Leaf(text) if text == "*" => {
            return Ok(fields
                .attributes()
                .filter(|field| field.category == FieldCategory::Nested && !field.is_private())
                .map(|field| field.api.clone())
                .collect());
        }
        Node::Leaf(text) => text
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .collect(),
        Node::Map(map) => match node.as_list() {
            Some(items) => items
                .into_iter()
                .map(|item| {
                    item.as_leaf()
                        .map(str::to_owned)
                        .ok_or_else(|| QueryError::new("`populate` entries must be field names"))
                })
                .collect::<Result<_, _>>()?,
            // Object form: `populate[seo]=true` or `populate[seo][fields]…` (options apply
            // to whole JSON-stored values, so they are accepted and ignored).
            None => map
                .iter()
                .filter(|(_, value)| !matches!(value.as_leaf(), Some("false")))
                .map(|(name, _)| name.clone())
                .collect(),
        },
    };

    let mut populate = Vec::new();
    for name in names {
        match fields.get(&name) {
            Some(field) if field.category == FieldCategory::Nested && !field.is_private() => {}
            Some(field) if field.category == FieldCategory::Relation && !field.is_private() => {
                return Err(QueryError::new(format!(
                    "populating relation `{name}` is not supported yet"
                )));
            }
            _ => return Err(QueryError::new(format!("invalid key `{name}` in populate"))),
        }
        if !populate.contains(&name) {
            populate.push(name);
        }
    }
    Ok(populate)
}

fn parse_pagination(node: Option<&Node>, limits: &Limits) -> Result<Pagination, QueryError> {
    let default = Pagination {
        mode: PageMode::Page { page: 1, page_size: limits.default_page_size },
        with_count: true,
    };
    let Some(node) = node else { return Ok(default) };
    let map = node.as_map().ok_or_else(|| QueryError::new("`pagination` must be an object"))?;

    let number = |key: &str, min: i64| -> Result<Option<i64>, QueryError> {
        map.get(key)
            .map(|node| {
                node.as_leaf()
                    .and_then(|text| text.parse::<i64>().ok())
                    .filter(|value| *value >= min)
                    .ok_or_else(|| {
                        QueryError::new(format!("`pagination[{key}]` must be an integer ≥ {min}"))
                    })
            })
            .transpose()
    };
    for key in map.keys() {
        if !["page", "pageSize", "start", "limit", "withCount"].contains(&key.as_str()) {
            return Err(QueryError::new(format!("invalid key `{key}` in pagination")));
        }
    }
    let with_count = match map.get("withCount").map(|node| node.as_leaf()) {
        None | Some(Some("true")) => true,
        Some(Some("false")) => false,
        Some(_) => return Err(QueryError::new("`pagination[withCount]` must be true or false")),
    };

    let page_based = map.contains_key("page") || map.contains_key("pageSize");
    let offset_based = map.contains_key("start") || map.contains_key("limit");
    let cap = |size: i64| (size as u64).min(limits.max_page_size);
    let mode = match (page_based, offset_based) {
        (true, true) => {
            return Err(QueryError::new("use either page/pageSize or start/limit, not both"));
        }
        (_, false) => PageMode::Page {
            page: number("page", 1)?.unwrap_or(1) as u64,
            page_size: number("pageSize", 1)?.map_or(limits.default_page_size, cap),
        },
        (false, true) => PageMode::Offset {
            start: number("start", 0)?.unwrap_or(0) as u64,
            // Strapi: `limit=-1` means "as many as allowed".
            limit: match number("limit", -1)? {
                None => limits.default_page_size,
                Some(-1) => limits.max_page_size,
                Some(0) => return Err(QueryError::new("`pagination[limit]` must be ≥ 1 or -1")),
                Some(limit) => cap(limit),
            },
        },
    };
    Ok(Pagination { mode, with_count })
}
