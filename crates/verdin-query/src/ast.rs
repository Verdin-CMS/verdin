//! Validated query AST. Every column name in it comes from the schema.

use verdin_db::{ColumnKind, SqlValue};

#[derive(Debug, Clone, PartialEq)]
pub struct Query {
    pub filters: Option<Filter>,
    pub sort: Vec<Sort>,
    /// API names of the scalar fields to return; `None` means all of them.
    pub fields: Option<Vec<String>>,
    /// API names of the components / dynamic zones to include.
    pub populate: Vec<String>,
    pub pagination: Pagination,
    pub status: Status,
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct Condition {
    pub column: String,
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
