//! Content history support: whole-document snapshots, and turning a snapshot back into
//! write data for the current schema.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value as Json};
use verdin_query::{PageMode, Pagination, Populate, Query, Status};
use verdin_schema::{Attribute, AttributeKind};

use crate::refs::{self, Target};
use crate::service::missing_documents;
use crate::{DocumentService, Result};

/// Fields every document has, never written back.
const SYSTEM_FIELDS: &[&str] = &[
    "id",
    "documentId",
    "createdAt",
    "updatedAt",
    "publishedAt",
    "locale",
    "createdBy",
    "updatedBy",
];

/// A value restored without some of its references (their targets are gone).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dropped {
    pub field: String,
    pub count: usize,
}

fn populated(attribute: &Attribute) -> bool {
    matches!(
        attribute.kind,
        AttributeKind::Relation { .. }
            | AttributeKind::Media { .. }
            | AttributeKind::Component { .. }
            | AttributeKind::DynamicZone { .. }
    )
}

impl DocumentService {
    /// The document with every relation, media field, component and dynamic zone
    /// populated one level deep (`None` if that version does not exist).
    pub async fn snapshot(
        &self,
        uid: &str,
        document_id: &str,
        status: Status,
    ) -> Result<Option<Json>> {
        let model = self.registry().get(uid)?;
        let populate = model
            .content_type
            .attributes
            .iter()
            .filter(|(_, attribute)| populated(attribute))
            .map(|(name, _)| Populate { field: name.clone(), query: None })
            .collect();
        let query = Query {
            filters: None,
            sort: Vec::new(),
            fields: None,
            populate,
            pagination: Pagination {
                mode: PageMode::Offset { start: 0, limit: 1 },
                with_count: false,
            },
            status,
        };
        self.find_one(uid, document_id, &query).await
    }

    /// Write data restoring `snapshot` with the current schema: fields that no longer
    /// exist are skipped, and references to documents or files that were deleted since are
    /// dropped (and reported). Fields written from the other side of a relation are left
    /// as they are.
    pub async fn restorable(&self, uid: &str, snapshot: &Json) -> Result<(Json, Vec<Dropped>)> {
        let model = self.registry().get(uid)?;
        let schema = &self.registry().schema;
        let Some(source) = snapshot.as_object() else {
            return Ok((Json::Object(Map::new()), Vec::new()));
        };
        let mut data = Map::new();
        // Documents and files the data refers to, checked in one pass below.
        let mut documents: HashMap<String, HashSet<String>> = HashMap::new();
        let mut files: HashSet<i64> = HashSet::new();
        for (name, attribute) in &model.content_type.attributes {
            if SYSTEM_FIELDS.contains(&name.as_str()) {
                continue;
            }
            let Some(value) = source.get(name) else { continue };
            let value = match &attribute.kind {
                AttributeKind::Relation { mapped_by: Some(_), .. } => continue,
                AttributeKind::Relation { relation, target, .. } => {
                    let ids = document_ids(value);
                    documents.entry(target.clone()).or_default().extend(ids.iter().cloned());
                    if relation.is_to_many() {
                        Json::Array(ids.into_iter().map(Json::String).collect())
                    } else {
                        ids.into_iter().next().map_or(Json::Null, Json::String)
                    }
                }
                AttributeKind::Media { multiple, .. } => {
                    let ids = file_ids(value);
                    files.extend(ids.iter().copied());
                    if *multiple {
                        Json::Array(ids.into_iter().map(Json::from).collect())
                    } else {
                        ids.into_iter().next().map_or(Json::Null, Json::from)
                    }
                }
                AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. } => {
                    let mut value = value.clone();
                    strip_component_ids(&mut value);
                    refs::rewrite(
                        schema,
                        &attribute.kind,
                        &mut value,
                        &mut |attribute, target, value| {
                            let many = many(attribute);
                            match target {
                                Target::Documents { uid } => {
                                    let ids = document_ids(value);
                                    documents
                                        .entry(uid.clone())
                                        .or_default()
                                        .extend(ids.iter().cloned());
                                    shape(ids.into_iter().map(Json::String).collect(), many)
                                }
                                Target::Files { .. } => {
                                    let ids = file_ids(value);
                                    files.extend(ids.iter().copied());
                                    shape(ids.into_iter().map(Json::from).collect(), many)
                                }
                            }
                        },
                    );
                    value
                }
                _ => value.clone(),
            };
            data.insert(name.clone(), value);
        }

        // Which references still exist.
        let mut tx = self.db().begin().await?;
        let mut missing_docs: HashMap<String, HashSet<String>> = HashMap::new();
        for (target, ids) in &documents {
            let Ok(target_model) = self.registry().get(target) else { continue };
            let ids: Vec<String> = ids.iter().cloned().collect();
            let missing = missing_documents(&mut tx, target_model.table(), &ids).await?;
            missing_docs.insert(target.clone(), missing.into_iter().collect());
        }
        let ids: Vec<i64> = files.iter().copied().collect();
        let existing_files = crate::media::file_mimes(&mut tx, &ids).await?;
        tx.rollback().await?;

        let mut dropped = Vec::new();
        for (name, attribute) in &model.content_type.attributes {
            let Some(value) = data.get_mut(name) else { continue };
            let count = std::cell::Cell::new(0usize);
            let keep_document = |target: &str, id: &Json| {
                let gone = id
                    .as_str()
                    .is_some_and(|id| missing_docs.get(target).is_some_and(|set| set.contains(id)));
                count.set(count.get() + usize::from(gone));
                !gone
            };
            match &attribute.kind {
                AttributeKind::Relation { target, .. } => {
                    prune(value, |id| keep_document(target, id))
                }
                AttributeKind::Media { .. } => prune(value, |id| {
                    let gone = id.as_i64().is_some_and(|id| !existing_files.contains_key(&id));
                    count.set(count.get() + usize::from(gone));
                    !gone
                }),
                AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. } => {
                    refs::rewrite(schema, &attribute.kind, value, &mut |_, target, value| {
                        let mut value = value.clone();
                        match target {
                            Target::Documents { uid } => {
                                prune(&mut value, |id| keep_document(uid, id))
                            }
                            Target::Files { .. } => prune(&mut value, |id| {
                                let gone =
                                    id.as_i64().is_some_and(|id| !existing_files.contains_key(&id));
                                count.set(count.get() + usize::from(gone));
                                !gone
                            }),
                        }
                        value
                    });
                }
                _ => {}
            }
            if count.get() > 0 {
                dropped.push(Dropped { field: name.clone(), count: count.get() });
            }
        }
        Ok((Json::Object(data), dropped))
    }
}

fn many(attribute: &Attribute) -> bool {
    match &attribute.kind {
        AttributeKind::Relation { relation, .. } => relation.is_to_many(),
        AttributeKind::Media { multiple, .. } => *multiple,
        _ => false,
    }
}

fn shape(items: Vec<Json>, many: bool) -> Json {
    if many { Json::Array(items) } else { items.into_iter().next().unwrap_or(Json::Null) }
}

/// Removes ids that `keep` refuses from a single or multiple reference value.
fn prune(value: &mut Json, mut keep: impl FnMut(&Json) -> bool) {
    match value {
        Json::Array(items) => items.retain(|item| keep(item)),
        Json::Null => {}
        single => {
            if !keep(single) {
                *single = Json::Null;
            }
        }
    }
}

/// `documentId`s of a populated (or already flat) relation value.
fn document_ids(value: &Json) -> Vec<String> {
    let one = |value: &Json| match value {
        Json::String(id) => Some(id.clone()),
        Json::Object(object) => object.get("documentId").and_then(Json::as_str).map(str::to_owned),
        _ => None,
    };
    match value {
        Json::Array(items) => items.iter().filter_map(one).collect(),
        other => one(other).into_iter().collect(),
    }
}

/// File ids of a populated (or already flat) media value.
fn file_ids(value: &Json) -> Vec<i64> {
    let one = |value: &Json| match value {
        Json::Number(number) => number.as_i64(),
        Json::Object(object) => object.get("id").and_then(Json::as_i64),
        _ => None,
    };
    match value {
        Json::Array(items) => items.iter().filter_map(one).collect(),
        other => one(other).into_iter().collect(),
    }
}

/// Component entries keep no `id`: restoring writes them as new entries.
fn strip_component_ids(value: &mut Json) {
    match value {
        Json::Array(items) => items.iter_mut().for_each(strip_component_ids),
        Json::Object(object) => {
            object.remove("id");
        }
        _ => {}
    }
}
