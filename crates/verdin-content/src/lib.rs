//! Document Service: the single internal API for reading and writing content
//! (docs/architecture.md §11).

mod blocks;
pub mod events;
mod history;
mod input;
pub mod media;
mod output;
mod refs;
mod service;

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value as Json;
use verdin_db::DbError;
use verdin_query::{Catalog, TypeFields};
use verdin_schema::{AttributeKind, ContentType, Schema};

pub use history::Dropped;
pub use output::OutputOptions;
pub use service::{DocumentService, Page, PageMeta, WriteOptions, slugify};

/// One validation problem, in Strapi's `details.errors[]` format.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Issue {
    pub path: Vec<Json>,
    pub message: String,
    pub name: &'static str,
}

impl Issue {
    pub fn new(path: Vec<Json>, message: impl Into<String>) -> Self {
        Self { path, message: message.into(), name: "ValidationError" }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ContentError {
    #[error("unknown content type `{0}`")]
    UnknownType(String),
    #[error("Not Found")]
    NotFound,
    #[error("{}", summarize(.0))]
    Validation(Vec<Issue>),
    #[error("{0}")]
    BadRequest(String),
    #[error(transparent)]
    Db(#[from] DbError),
}

fn summarize(issues: &[Issue]) -> String {
    match issues {
        [] => "Validation error".into(),
        [issue] => issue.message.clone(),
        [first, rest @ ..] => format!("{} (and {} more errors)", first.message, rest.len()),
    }
}

pub type Result<T> = std::result::Result<T, ContentError>;

/// Everything the service needs to know about one content type.
#[derive(Debug)]
pub struct TypeModel {
    pub content_type: ContentType,
    pub fields: TypeFields,
    /// Unique index name → attribute name, to report unique violations.
    unique_indexes: HashMap<String, String>,
    /// Column name → attribute name.
    columns: HashMap<String, String>,
}

impl TypeModel {
    fn new(content_type: &ContentType, schema: &Schema) -> Self {
        let fields = TypeFields::new(content_type, schema);
        let mut unique_indexes = HashMap::new();
        let mut columns = HashMap::new();
        for (name, attribute) in &content_type.attributes {
            if matches!(attribute.kind, AttributeKind::Relation { .. }) {
                continue;
            }
            let column = verdin_schema::Attribute::column_name(name);
            if attribute.kind.is_unique() {
                let index =
                    verdin_migrate::index_name(&content_type.collection_name, &column, "uq");
                unique_indexes.insert(index, name.clone());
            }
            columns.insert(column, name.clone());
        }
        Self { content_type: content_type.clone(), fields, unique_indexes, columns }
    }

    pub fn uid(&self) -> &str {
        &self.content_type.uid
    }

    pub fn table(&self) -> &str {
        &self.content_type.collection_name
    }

    pub fn draft_and_publish(&self) -> bool {
        self.content_type.draft_and_publish
    }

    /// Maps a unique-constraint violation to a validation issue on the attribute.
    fn unique_issue(&self, error: &DbError) -> Option<Issue> {
        let attribute = match error.unique_violation()? {
            verdin_db::UniqueViolation::Index(index) => self.unique_indexes.get(&index)?.clone(),
            verdin_db::UniqueViolation::Columns(columns) => {
                let column = columns.first()?.rsplit('.').next()?.to_owned();
                self.columns.get(&column)?.clone()
            }
        };
        Some(Issue::new(vec![Json::from(attribute)], "This attribute must be unique"))
    }
}

/// Content types by uid, derived once from the schema.
#[derive(Debug, Clone)]
pub struct Registry {
    pub schema: Arc<Schema>,
    types: Arc<HashMap<String, Arc<TypeModel>>>,
    catalog: Arc<Catalog>,
    /// Target uid → link tables pointing at documents of that type.
    incoming: Arc<HashMap<String, Vec<String>>>,
}

impl Registry {
    pub fn new(schema: Schema) -> Self {
        let types: HashMap<_, _> = schema
            .content_types
            .values()
            .map(|content_type| {
                (content_type.uid.clone(), Arc::new(TypeModel::new(content_type, &schema)))
            })
            .collect();
        let mut incoming: HashMap<String, Vec<String>> = HashMap::new();
        for model in types.values() {
            for relation in model.fields.iter().filter_map(|field| field.relation.as_ref()) {
                if relation.owner {
                    incoming
                        .entry(relation.target.clone())
                        .or_default()
                        .push(relation.link_table.clone());
                }
            }
        }
        let catalog = Catalog::new(&schema);
        Self {
            schema: Arc::new(schema),
            types: Arc::new(types),
            catalog: Arc::new(catalog),
            incoming: Arc::new(incoming),
        }
    }

    pub fn get(&self, uid: &str) -> Result<&Arc<TypeModel>> {
        self.types.get(uid).ok_or_else(|| ContentError::UnknownType(uid.to_owned()))
    }

    pub fn types(&self) -> impl Iterator<Item = &Arc<TypeModel>> {
        self.types.values()
    }

    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    /// Link tables whose targets are documents of `uid`.
    pub fn incoming_links(&self, uid: &str) -> &[String] {
        self.incoming.get(uid).map_or(&[], Vec::as_slice)
    }
}
