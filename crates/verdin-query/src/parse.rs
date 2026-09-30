//! Query-string tree → validated [`Query`] (https://verdin-cms.github.io/verdin/api/rest/).

use indexmap::IndexMap;
use rust_decimal::Decimal;
use verdin_db::{ColumnKind, SqlValue};
use verdin_schema::AttributeKind;

use crate::QueryError;
use crate::ast::*;
use crate::fields::{Catalog, Field, FieldCategory, LOCALIZATIONS, TypeFields};
use crate::params::Node;
use crate::temporal::{parse_date, parse_datetime, parse_time};

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub default_page_size: u64,
    pub max_page_size: u64,
    pub max_conditions: usize,
    pub max_populate_depth: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            default_page_size: 25,
            max_page_size: 100,
            max_conditions: 100,
            max_populate_depth: 5,
        }
    }
}

const KNOWN_PARAMETERS: &[&str] = &[
    "filters",
    "sort",
    "fields",
    "populate",
    "pagination",
    "status",
    "locale",
    "hasPublishedVersion",
    "_q",
];

/// Longest `_q`, in characters.
const MAX_SEARCH: usize = 200;
const SUB_QUERY_PARAMETERS: &[&str] = &["fields", "populate", "filters", "sort", "count"];

struct Parser<'a> {
    catalog: &'a Catalog,
    limits: &'a Limits,
    conditions: usize,
}

pub fn parse(
    root: &IndexMap<String, Node>,
    fields: &TypeFields,
    catalog: &Catalog,
    limits: &Limits,
) -> Result<Query, QueryError> {
    for key in root.keys() {
        if !KNOWN_PARAMETERS.contains(&key.as_str()) {
            return Err(QueryError::new(format!("invalid query parameter `{key}`")));
        }
    }
    let mut parser = Parser { catalog, limits, conditions: 0 };
    let mut filters = root.get("filters").map(|node| parser.filters(node, fields)).transpose()?;
    if let Some(node) = root.get("hasPublishedVersion") {
        let published = match node.as_leaf() {
            Some("true") => true,
            Some("false") => false,
            _ => return Err(QueryError::new("`hasPublishedVersion` is `true` or `false`")),
        };
        if !fields.draft_and_publish {
            return Err(QueryError::new(format!("`{}` has no draft and publish", fields.uid)));
        }
        let has = Filter::HasPublished { table: fields.table.clone(), published };
        filters = Some(match filters {
            Some(existing) => Filter::And(vec![existing, has]),
            None => has,
        });
    }

    Ok(Query {
        filters,
        sort: root
            .get("sort")
            .map(|node| parse_sort(node, fields, catalog))
            .transpose()?
            .unwrap_or_default(),
        fields: root.get("fields").map(|node| parse_fields(node, fields)).transpose()?,
        populate: root
            .get("populate")
            .map(|node| parser.populate(node, fields, 1))
            .transpose()?
            .unwrap_or_default(),
        pagination: parse_pagination(root.get("pagination"), limits)?,
        status: match root.get("status").map(|node| node.as_leaf()) {
            None => Status::Published,
            Some(Some("published")) => Status::Published,
            Some(Some("draft")) => Status::Draft,
            Some(_) => return Err(QueryError::new("`status` must be `published` or `draft`")),
        },
        denied: catalog.denied_types(),
        search: match root.get("_q").map(|node| node.as_leaf()) {
            None => None,
            Some(Some(text)) if text.chars().count() > MAX_SEARCH => {
                return Err(QueryError::new(format!("`_q` is at most {MAX_SEARCH} characters")));
            }
            Some(Some(text)) => Some(text.trim().to_owned()).filter(|text| !text.is_empty()),
            Some(None) => return Err(QueryError::new("`_q` must be a string")),
        },
    })
}

/// Strapi's `_q` without a search index: documents where a text field (not private)
/// contains `text`, ignoring case.
pub fn search_filter(fields: &TypeFields, text: &str) -> Option<Filter> {
    let conditions: Vec<Filter> = fields
        .iter()
        .filter(|field| {
            field.category == FieldCategory::Scalar
                && field.attribute.as_ref().is_some_and(|attribute| {
                    !attribute.private && !matches!(attribute.kind, AttributeKind::Password { .. })
                })
                && field.is_text()
        })
        .map(|field| {
            Filter::Condition(Condition {
                column: field.column.clone(),
                path: Vec::new(),
                kind: field.kind,
                op: Op::Containsi,
                operand: Operand::Value(SqlValue::Text(text.to_owned())),
            })
        })
        .collect();
    (!conditions.is_empty()).then_some(Filter::Or(conditions))
}

impl Parser<'_> {
    fn filters(&mut self, node: &Node, fields: &TypeFields) -> Result<Filter, QueryError> {
        let map = node.as_map().ok_or_else(|| QueryError::new("`filters` must be an object"))?;
        self.filter_map(map, fields)
    }

    fn filter_map(
        &mut self,
        map: &IndexMap<String, Node>,
        fields: &TypeFields,
    ) -> Result<Filter, QueryError> {
        let mut all = Vec::with_capacity(map.len());
        for (key, node) in map {
            let filter = match key.as_str() {
                "$and" | "$or" => {
                    let items = node
                        .as_list()
                        .filter(|items| items.iter().all(|item| item.as_map().is_some()))
                        .ok_or_else(|| {
                            QueryError::new(format!("`{key}` must be a list of filter objects"))
                        })?;
                    let children = items
                        .into_iter()
                        .map(|item| self.filter_map(item.as_map().expect("checked"), fields))
                        .collect::<Result<Vec<_>, _>>()?;
                    if key == "$and" { Filter::And(children) } else { Filter::Or(children) }
                }
                "$not" => {
                    let map = node
                        .as_map()
                        .ok_or_else(|| QueryError::new("`$not` must be a filter object"))?;
                    Filter::Not(Box::new(self.filter_map(map, fields)?))
                }
                name if name.starts_with('$') => {
                    return Err(QueryError::new(format!(
                        "invalid filter operator `{name}` at the top level"
                    )));
                }
                name => self.field_filter(name, node, fields)?,
            };
            all.push(filter);
        }
        Ok(if all.len() == 1 { all.pop().expect("one") } else { Filter::And(all) })
    }

    fn field_filter(
        &mut self,
        name: &str,
        node: &Node,
        fields: &TypeFields,
    ) -> Result<Filter, QueryError> {
        let field = fields
            .get(name)
            .filter(|field| !field.is_private())
            .ok_or_else(|| QueryError::new(format!("invalid key `{name}` in filters")))?;
        match field.category {
            FieldCategory::Scalar => {}
            FieldCategory::Relation => return self.relation_filter(field, node),
            FieldCategory::Media => {
                return Err(QueryError::new(format!(
                    "filtering on media fields (`{name}`) is not supported yet"
                )));
            }
            FieldCategory::Morph => {
                return Err(QueryError::new(format!(
                    "filtering on polymorphic relations (`{name}`) is not supported"
                )));
            }
            FieldCategory::Nested => {
                return match field.attribute.as_ref().map(|attribute| &attribute.kind) {
                    Some(AttributeKind::Component { component, repeatable: false, .. }) => {
                        self.component_filter(&field.column, Vec::new(), component, name, node)
                    }
                    // Some item matches: `filters[links][url][$contains]=…`.
                    Some(AttributeKind::Component { component, repeatable: true, .. }) => {
                        let inner =
                            self.component_filter("value", Vec::new(), component, name, node)?;
                        Ok(Filter::Items { column: field.column.clone(), inner: Box::new(inner) })
                    }
                    // Dynamic zones, by component: `filters[blocks][__component][$eq]=blocks.hero`.
                    Some(AttributeKind::DynamicZone { .. }) => {
                        let inner = self.zone_filter(name, node)?;
                        Ok(Filter::Items { column: field.column.clone(), inner: Box::new(inner) })
                    }
                    _ => Err(QueryError::new(format!("cannot filter on `{name}`"))),
                };
            }
        }
        self.operator_filters(field, Vec::new(), node)
    }

    /// `filters[seo][metaTitle][$eq]=…`: fields of a non-repeatable component, stored in the
    /// JSON column `column` at `path`.
    fn component_filter(
        &mut self,
        column: &str,
        path: Vec<String>,
        component: &str,
        display: &str,
        node: &Node,
    ) -> Result<Filter, QueryError> {
        let map = node.as_map().ok_or_else(|| {
            QueryError::new(format!(
                "filter `{display}` by its fields, e.g. `filters[{display}][field][$eq]=…`"
            ))
        })?;
        let attributes = self.catalog.component(component).expect("validated schema").clone();
        let mut filters = Vec::with_capacity(map.len());
        for (key, value) in map {
            let child_display = format!("{display}.{key}");
            let attribute =
                attributes.get(key).filter(|attribute| !attribute.private).ok_or_else(|| {
                    QueryError::new(format!("invalid key `{child_display}` in filters"))
                })?;
            let mut child_path = path.clone();
            child_path.push(key.clone());
            let filter = match &attribute.kind {
                AttributeKind::Component { component, repeatable: false, .. } => {
                    self.component_filter(column, child_path, component, &child_display, value)?
                }
                kind => {
                    let (column_kind, category) = crate::fields::attribute_kind(kind);
                    if category != FieldCategory::Scalar || column_kind == ColumnKind::Json {
                        return Err(QueryError::new(format!("cannot filter on `{child_display}`")));
                    }
                    let field = Field {
                        api: child_display,
                        column: column.to_owned(),
                        kind: column_kind,
                        category,
                        attribute: Some(attribute.clone()),
                        relation: None,
                        media: None,
                        morph: None,
                    };
                    self.operator_filters(&field, child_path, value)?
                }
            };
            filters.push(filter);
        }
        Ok(if filters.len() == 1 { filters.pop().expect("one") } else { Filter::And(filters) })
    }

    /// The items of a dynamic zone can be filtered by `__component` only (their fields
    /// depend on the component).
    fn zone_filter(&mut self, display: &str, node: &Node) -> Result<Filter, QueryError> {
        let map = node
            .as_map()
            .ok_or_else(|| QueryError::new(format!("filter `{display}` by `__component`")))?;
        let mut filters = Vec::with_capacity(map.len());
        for (key, value) in map {
            if key != "__component" {
                return Err(QueryError::new(format!(
                    "dynamic zones are filtered by `__component` only (got `{display}.{key}`)"
                )));
            }
            let field = Field {
                api: format!("{display}.__component"),
                column: "value".into(),
                kind: ColumnKind::Text,
                category: FieldCategory::Scalar,
                attribute: None,
                relation: None,
                media: None,
                morph: None,
            };
            filters.push(self.operator_filters(&field, vec!["__component".into()], value)?);
        }
        Ok(if filters.len() == 1 { filters.pop().expect("one") } else { Filter::And(filters) })
    }

    fn operator_filters(
        &mut self,
        field: &Field,
        path: Vec<String>,
        node: &Node,
    ) -> Result<Filter, QueryError> {
        let name = &field.api;
        let operators: Vec<(&str, &Node)> = match node {
            Node::Leaf(_) => vec![("$eq", node)],
            Node::Map(map) => map.iter().map(|(key, value)| (key.as_str(), value)).collect(),
        };
        let mut filters = Vec::with_capacity(operators.len());
        for (op_name, operand) in operators {
            self.count_condition()?;
            let op = Op::parse(op_name).ok_or_else(|| {
                if op_name.starts_with('$') {
                    QueryError::new(format!("invalid filter operator `{op_name}` on `{name}`"))
                } else {
                    QueryError::new(format!("`{name}` has no nested field `{op_name}`"))
                }
            })?;
            let mut condition = parse_condition(field, op, op_name, operand)?;
            if !path.is_empty() {
                condition.operand = json_operand(condition.operand);
                condition.path = path.clone();
            }
            filters.push(Filter::Condition(condition));
        }
        Ok(if filters.len() == 1 { filters.pop().expect("one") } else { Filter::And(filters) })
    }

    /// `filters[category][name][$eq]=x`, `filters[category][$null]=true`.
    fn relation_filter(&mut self, field: &Field, node: &Node) -> Result<Filter, QueryError> {
        let name = &field.api;
        let relation = field.relation.as_ref().expect("relation fields carry relation info");
        if self.catalog.denies(&relation.target) {
            return Err(QueryError::new(format!("cannot filter by `{name}`")));
        }
        let target = self.catalog.get(&relation.target).expect("validated schema");
        let map = node.as_map().ok_or_else(|| {
            QueryError::new(format!(
                "filter `{name}` by its fields, e.g. `filters[{name}][documentId][$eq]=…`"
            ))
        })?;
        self.count_condition()?;

        let mut negate = None;
        let mut inner = IndexMap::new();
        for (key, value) in map {
            match key.as_str() {
                "$null" | "$notNull" => {
                    let flag = match value.as_leaf() {
                        Some("true" | "1") => true,
                        Some("false" | "0") => false,
                        _ => {
                            return Err(QueryError::new(format!(
                                "`{name}.{key}` expects true or false"
                            )));
                        }
                    };
                    negate = Some(flag == (key == "$null"));
                }
                _ => {
                    inner.insert(key.clone(), value.clone());
                }
            }
        }
        let relation_filter = |negate: bool, inner: Option<Filter>| {
            Filter::Relation(RelationFilter {
                link_table: relation.link_table.clone(),
                owner: relation.owner,
                target_table: relation.target_table.clone(),
                target_draft_and_publish: relation.target_draft_and_publish,
                target_localized: relation.target_localized,
                negate,
                inner: inner.map(Box::new),
            })
        };
        let inner = if inner.is_empty() { None } else { Some(self.filter_map(&inner, target)?) };
        Ok(match (negate, inner) {
            (None, inner) => relation_filter(false, inner),
            (Some(negate), None) => relation_filter(negate, None),
            (Some(negate), Some(inner)) => Filter::And(vec![
                relation_filter(negate, None),
                relation_filter(false, Some(inner)),
            ]),
        })
    }

    fn count_condition(&mut self) -> Result<(), QueryError> {
        self.conditions += 1;
        if self.conditions > self.limits.max_conditions {
            return Err(QueryError::new(format!(
                "more than {} filter conditions",
                self.limits.max_conditions
            )));
        }
        Ok(())
    }

    fn populate(
        &mut self,
        node: &Node,
        fields: &TypeFields,
        depth: usize,
    ) -> Result<Vec<Populate>, QueryError> {
        if depth > self.limits.max_populate_depth {
            return Err(QueryError::new(format!(
                "populate is nested deeper than {} levels",
                self.limits.max_populate_depth
            )));
        }
        let catalog = self.catalog;
        let populatable = |field: &&Field| {
            field.category != FieldCategory::Scalar
                && !field.is_private()
                && field.relation.as_ref().is_none_or(|relation| !catalog.denies(&relation.target))
        };

        // The caller sees only some fields of the type: localizations select those.
        let limited_localizations = || {
            catalog
                .limits(&fields.uid)
                .then(|| SubQuery { fields: Some(fields.visible_scalars()), ..Default::default() })
        };
        let entries: Vec<(String, Option<&Node>)> = match node {
            Node::Leaf(text) if text == "*" => {
                let mut populate: Vec<Populate> = fields
                    .attributes()
                    .filter(populatable)
                    .map(|field| Populate { field: field.api.clone(), query: None })
                    .collect();
                if fields.has_localizations() {
                    populate.push(Populate {
                        field: LOCALIZATIONS.into(),
                        query: limited_localizations(),
                    });
                }
                return Ok(populate);
            }
            Node::Leaf(text) => text
                .split(',')
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(|name| (name.to_owned(), None))
                .collect(),
            Node::Map(map) => match node.as_list() {
                Some(items) => items
                    .into_iter()
                    .map(|item| {
                        item.as_leaf().map(|name| (name.to_owned(), None)).ok_or_else(|| {
                            QueryError::new("`populate` entries must be field names")
                        })
                    })
                    .collect::<Result<_, _>>()?,
                None => map
                    .iter()
                    .filter(|(_, value)| !matches!(value.as_leaf(), Some("false")))
                    .map(|(name, value)| (name.clone(), value.as_map().map(|_| value)))
                    .collect(),
            },
        };

        let mut populate: Vec<Populate> = Vec::new();
        for (name, options) in entries {
            if name == LOCALIZATIONS && fields.has_localizations() {
                // The other locale versions of the same document: same type, same options
                // as a to-many relation to it.
                let query = match options {
                    Some(options) => {
                        let mut query = self.sub_query(options, fields, depth)?;
                        if query.fields.is_none() && self.catalog.limits(&fields.uid) {
                            query.fields = Some(fields.visible_scalars());
                        }
                        Some(query)
                    }
                    None => limited_localizations(),
                };
                if !populate.iter().any(|existing| existing.field == name) {
                    populate.push(Populate { field: name, query });
                }
                continue;
            }
            let field = fields
                .get(&name)
                .filter(populatable)
                .ok_or_else(|| QueryError::new(format!("invalid key `{name}` in populate")))?;
            let limited = field
                .relation
                .as_ref()
                .filter(|relation| self.catalog.limits(&relation.target))
                .map(|relation| self.catalog.get(&relation.target).expect("validated schema"));
            let query = match (field.category, options) {
                // The caller sees only some fields of the target: select those.
                (FieldCategory::Relation, None) if limited.is_some() => Some(SubQuery {
                    fields: limited.map(TypeFields::visible_scalars),
                    ..Default::default()
                }),
                (FieldCategory::Relation, Some(options)) => {
                    let relation = field.relation.as_ref().expect("relation info");
                    let target = self.catalog.get(&relation.target).expect("validated schema");
                    let mut query = self.sub_query(options, target, depth)?;
                    if query.fields.is_none() && self.catalog.limits(&relation.target) {
                        query.fields = Some(target.visible_scalars());
                    }
                    if query.count && !relation.to_many {
                        return Err(QueryError::new(format!(
                            "`count` needs a to-many relation (`{name}` is to-one)"
                        )));
                    }
                    Some(query)
                }
                // Polymorphic targets have different fields: `count` only (`on` is accepted
                // and ignored, like for dynamic zones).
                (FieldCategory::Morph, Some(options)) => {
                    let map = options.as_map().expect("maps");
                    if let Some(key) =
                        map.keys().find(|key| !matches!(key.as_str(), "count" | "on"))
                    {
                        return Err(QueryError::new(format!(
                            "invalid key `{key}` in populate options of `{name}` (polymorphic)"
                        )));
                    }
                    let count = match map.get("count").map(|node| node.as_leaf()) {
                        None | Some(Some("false")) => false,
                        Some(Some("true")) => true,
                        Some(_) => return Err(QueryError::new("`count` is `true` or `false`")),
                    };
                    Some(SubQuery { count, ..Default::default() })
                }
                // Components are stored whole; their populate options are accepted and ignored.
                _ => None,
            };
            if !populate.iter().any(|existing| existing.field == name) {
                populate.push(Populate { field: name, query });
            }
        }
        Ok(populate)
    }

    fn sub_query(
        &mut self,
        node: &Node,
        target: &TypeFields,
        depth: usize,
    ) -> Result<SubQuery, QueryError> {
        let map = node.as_map().expect("caller passes maps");
        for key in map.keys() {
            if !SUB_QUERY_PARAMETERS.contains(&key.as_str()) {
                return Err(QueryError::new(format!("invalid key `{key}` in populate options")));
            }
        }
        Ok(SubQuery {
            fields: map.get("fields").map(|node| parse_fields(node, target)).transpose()?,
            populate: map
                .get("populate")
                .map(|node| self.populate(node, target, depth + 1))
                .transpose()?
                .unwrap_or_default(),
            filters: map.get("filters").map(|node| self.filters(node, target)).transpose()?,
            sort: map
                .get("sort")
                .map(|node| parse_sort(node, target, self.catalog))
                .transpose()?
                .unwrap_or_default(),
            count: match map.get("count").map(|node| node.as_leaf()) {
                None | Some(Some("false")) => false,
                Some(Some("true")) => true,
                Some(_) => return Err(QueryError::new("`count` is `true` or `false`")),
            },
        })
    }
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
                path: Vec::new(),
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
    Ok(Condition { column: field.column.clone(), path: Vec::new(), kind: field.kind, op, operand })
}

/// Component values are stored as API JSON: dates, times and timestamps as their
/// canonical strings, which then compare correctly as text.
fn json_operand(operand: Operand) -> Operand {
    use verdin_db::value::{format_date, format_datetime, format_time};
    let text = |value: SqlValue| match value {
        SqlValue::Date(date) => SqlValue::Text(format_date(date)),
        SqlValue::Time(time) => SqlValue::Text(format_time(time)),
        SqlValue::DateTime(datetime) => SqlValue::Text(format_datetime(datetime)),
        other => other,
    };
    match operand {
        Operand::Value(value) => Operand::Value(text(value)),
        Operand::List(values) => Operand::List(values.into_iter().map(text).collect()),
        Operand::Pair(low, high) => Operand::Pair(text(low), text(high)),
        Operand::None => Operand::None,
    }
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

fn parse_sort(
    node: &Node,
    fields: &TypeFields,
    catalog: &Catalog,
) -> Result<Vec<Sort>, QueryError> {
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
            let cannot = || QueryError::new(format!("cannot sort by `{name}`"));
            if let Some((relation_name, target_name)) = name.split_once('.') {
                sort.push(
                    relation_sort(fields, catalog, relation_name, target_name, descending)
                        .ok_or_else(cannot)?,
                );
                continue;
            }
            let field = fields.get(name).filter(|field| field.is_sortable()).ok_or_else(cannot)?;
            let decimal = field.kind == ColumnKind::Decimal;
            sort.push(Sort { decimal, ..Sort::by(field.column.clone(), descending) });
        }
    }
    Ok(sort)
}

/// `author.name`: a scalar field of the target of a to-one relation.
fn relation_sort(
    fields: &TypeFields,
    catalog: &Catalog,
    relation_name: &str,
    target_name: &str,
    descending: bool,
) -> Option<Sort> {
    let field = fields.get(relation_name).filter(|field| !field.is_private())?;
    let relation = field.relation.as_ref().filter(|relation| !relation.to_many)?;
    if catalog.denies(&relation.target) {
        return None;
    }
    let target = catalog.get(&relation.target)?;
    let column = target.get(target_name).filter(|field| field.is_sortable())?;
    Some(Sort {
        column: column.column.clone(),
        descending,
        via: Some(SortVia {
            link_table: relation.link_table.clone(),
            owner: relation.owner,
            target_table: relation.target_table.clone(),
            target_draft_and_publish: relation.target_draft_and_publish,
            target_localized: relation.target_localized,
        }),
        decimal: column.kind == ColumnKind::Decimal,
    })
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
