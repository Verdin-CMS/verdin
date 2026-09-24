//! Validated query AST. Every column name in it comes from the schema.

use verdin_db::{ColumnKind, SqlValue};

#[derive(Debug, Clone, PartialEq)]
pub struct Query {
    pub filters: Option<Filter>,
    pub sort: Vec<Sort>,
    /// API names of the scalar fields to return; `None` means all of them.
    pub fields: Option<Vec<String>>,
    /// Components, dynamic zones and relations to include.
    pub populate: Vec<Populate>,
    pub pagination: Pagination,
    pub status: Status,
}

/// One populated field. `query` shapes populated relations; components and dynamic
/// zones are always returned whole.
#[derive(Debug, Clone, PartialEq)]
pub struct Populate {
    pub field: String,
    pub query: Option<SubQuery>,
}

/// Options of a populated relation (`populate[category][fields][0]=name`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SubQuery {
    pub fields: Option<Vec<String>>,
    pub populate: Vec<Populate>,
    pub filters: Option<Filter>,
    pub sort: Vec<Sort>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Status {
    #[default]
    Published,
    Draft,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Published => "published",
            Status::Draft => "draft",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sort {
    pub column: String,
    pub descending: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageMode {
    /// `pagination[page]` / `pagination[pageSize]`
    Page { page: u64, page_size: u64 },
    /// `pagination[start]` / `pagination[limit]`
    Offset { start: u64, limit: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pagination {
    pub mode: PageMode,
    pub with_count: bool,
}

impl Pagination {
    pub fn offset(&self) -> u64 {
        match self.mode {
            PageMode::Page { page, page_size } => (page - 1) * page_size,
            PageMode::Offset { start, .. } => start,
        }
    }

    pub fn limit(&self) -> u64 {
        match self.mode {
            PageMode::Page { page_size, .. } => page_size,
            PageMode::Offset { limit, .. } => limit,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Filter {
    And(Vec<Filter>),
    Or(Vec<Filter>),
    Not(Box<Filter>),
    Condition(Condition),
    Relation(RelationFilter),
    /// Rows a user has marked in a per-user table (e.g. documents they have seen).
    Marked(MarkFilter),
}

/// `EXISTS (SELECT 1 FROM {table} m WHERE m.user_id = ? AND m.content_type = ?
/// AND m.document_id = row.document_id)`. Built by the server, never parsed from a request.
#[derive(Debug, Clone, PartialEq)]
pub struct MarkFilter {
    pub table: String,
    pub user_id: i64,
    pub content_type: String,
}

/// `filters[category][name][$eq]=x` (with `inner`) or `filters[category][$null]=true`.
#[derive(Debug, Clone, PartialEq)]
pub struct RelationFilter {
    pub link_table: String,
    /// Whether the filtered type stores the links (else it is the `mappedBy` side).
    pub owner: bool,
    pub target_table: String,
    pub target_draft_and_publish: bool,
    /// `true` for "has no related document matching".
    pub negate: bool,
    pub inner: Option<Box<Filter>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Condition {
    pub column: String,
    /// Path inside a JSON column (fields of non-repeatable components); empty for plain columns.
    pub path: Vec<String>,
    pub kind: ColumnKind,
    pub op: Op,
    pub operand: Operand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Eq,
    Eqi,
    Ne,
    Nei,
    Lt,
    Lte,
    Gt,
    Gte,
    In,
    NotIn,
    Contains,
    NotContains,
    Containsi,
    NotContainsi,
    StartsWith,
    StartsWithi,
    EndsWith,
    EndsWithi,
    IsNull,
    IsNotNull,
    Between,
}

impl Op {
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "$eq" => Op::Eq,
            "$eqi" => Op::Eqi,
            "$ne" => Op::Ne,
            "$nei" => Op::Nei,
            "$lt" => Op::Lt,
            "$lte" => Op::Lte,
            "$gt" => Op::Gt,
            "$gte" => Op::Gte,
            "$in" => Op::In,
            "$notIn" => Op::NotIn,
            "$contains" => Op::Contains,
            "$notContains" => Op::NotContains,
            "$containsi" => Op::Containsi,
            "$notContainsi" => Op::NotContainsi,
            "$startsWith" => Op::StartsWith,
            "$startsWithi" => Op::StartsWithi,
            "$endsWith" => Op::EndsWith,
            "$endsWithi" => Op::EndsWithi,
            "$null" => Op::IsNull,
            "$notNull" => Op::IsNotNull,
            "$between" => Op::Between,
            _ => return None,
        })
    }

    /// Operators that only make sense on text.
    pub fn is_text_only(self) -> bool {
        matches!(
            self,
            Op::Eqi
                | Op::Nei
                | Op::Contains
                | Op::NotContains
                | Op::Containsi
                | Op::NotContainsi
                | Op::StartsWith
                | Op::StartsWithi
                | Op::EndsWith
                | Op::EndsWithi
        )
    }

    pub fn is_ordering(self) -> bool {
        matches!(self, Op::Lt | Op::Lte | Op::Gt | Op::Gte | Op::Between)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Operand {
    None,
    Value(SqlValue),
    List(Vec<SqlValue>),
    Pair(SqlValue, SqlValue),
}
