//! Review workflows (the `review` feature): content types move their entries through
//! ordered stages. Some roles may be the only ones allowed to move entries into a stage,
//! entries can be assigned to an admin, and publishing can require a stage.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use verdin_content::DocumentService;
use verdin_content::events::{
    BoxFuture, DocumentEvent, DocumentHook, DocumentListener, EventKind, HookAction, HookContext,
};
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::{DOCUMENT_STAGES, WORKFLOW_STAGES, WORKFLOWS};

use crate::error::ApiError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    pub id: i64,
    pub name: String,
    pub color: String,
    /// Role codes allowed to move entries into this stage (empty: anyone who may update).
    pub roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: i64,
    pub name: String,
    pub content_types: Vec<String>,
    /// Entries must be in this stage to be published.
    pub publish_stage_id: Option<i64>,
    pub stages: Vec<Stage>,
}

impl Workflow {
    pub fn stage(&self, id: i64) -> Option<&Stage> {
        self.stages.iter().find(|stage| stage.id == id)
    }
}

/// A workflow as the admin sends it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowInput {
    pub name: String,
    #[serde(default)]
    pub content_types: Vec<String>,
    pub stages: Vec<StageInput>,
    /// The name of the stage required to publish.
    #[serde(default)]
    pub publish_stage: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageInput {
    /// Existing stages keep their id (and their entries).
    #[serde(default)]
    pub id: Option<i64>,
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub roles: Vec<String>,
}

fn default_color() -> String {
    "#4945ff".into()
}

/// Where one entry stands.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryStage {
    pub uid: String,
    pub document_id: String,
    /// Empty for types that are not localized.
    pub locale: String,
    pub stage_id: i64,
    pub assignee_id: Option<i64>,
    pub updated_at: Option<String>,
    pub updated_by: Option<i64>,
}

#[derive(Clone)]
pub struct Review {
    inner: Arc<Inner>,
}

struct Inner {
    db: Database,
    workflows: RwLock<Vec<Workflow>>,
    /// The `review` feature switch: off, entries get no stage and publishing is free.
    enabled: AtomicBool,
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn internal(error: DbError) -> ApiError {
    ApiError::Internal(error.to_string())
}

fn strings(value: V) -> Vec<String> {
    match value {
        V::Json(value) => serde_json::from_value(value).unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn valid_color(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Review {
    pub fn new(db: Database) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                workflows: RwLock::new(Vec::new()),
                enabled: AtomicBool::new(true),
            }),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::Relaxed);
    }

    fn enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Relaxed)
    }

    fn db(&self) -> &Database {
        &self.inner.db
    }

    /// Reads the workflows from the database (at startup and after every change).
    pub async fn reload(&self) -> Result<(), DbError> {
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, name, content_types, publish_stage_id FROM {WORKFLOWS} ORDER BY id"
                ),
                &[],
                &[K::BigInt, K::Text, K::Json, K::BigInt],
            )
            .await?;
        let stages = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, workflow_id, name, color, roles FROM {WORKFLOW_STAGES} ORDER BY workflow_id, position, id"
                ),
                &[],
                &[K::BigInt, K::BigInt, K::Text, K::Text, K::Json],
            )
            .await?;
        let mut by_workflow: HashMap<i64, Vec<Stage>> = HashMap::new();
        for row in stages {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            let id = next().as_i64().unwrap_or_default();
            let workflow = next().as_i64().unwrap_or_default();
            let name = next().into_text().unwrap_or_default();
            let color = next().into_text().unwrap_or_default();
            let roles = strings(next());
            by_workflow.entry(workflow).or_default().push(Stage { id, name, color, roles });
        }
        let workflows = rows
            .into_iter()
            .map(|row| {
                let mut row = row.into_iter();
                let mut next = || row.next().unwrap_or(V::Null(K::Text));
                let id = next().as_i64().unwrap_or_default();
                Workflow {
                    id,
                    name: next().into_text().unwrap_or_default(),
                    content_types: strings(next()),
                    publish_stage_id: next().as_i64(),
                    stages: by_workflow.remove(&id).unwrap_or_default(),
                }
            })
            .collect();
        *self.inner.workflows.write().expect("workflows") = workflows;
        Ok(())
    }

    pub fn list(&self) -> Vec<Workflow> {
        self.inner.workflows.read().expect("workflows").clone()
    }

    pub fn get(&self, id: i64) -> Option<Workflow> {
        self.list().into_iter().find(|workflow| workflow.id == id)
    }

    /// The workflow a content type belongs to.
    pub fn workflow_for(&self, uid: &str) -> Option<Workflow> {
        self.list().into_iter().find(|workflow| workflow.content_types.iter().any(|u| u == uid))
    }

    fn validate(
        &self,
        id: Option<i64>,
        input: &WorkflowInput,
        known_types: &HashSet<String>,
    ) -> Result<(), ApiError> {
        let bad = |message: String| Err(ApiError::BadRequest(message));
        if input.name.trim().is_empty() || input.name.chars().count() > 255 {
            return bad("the name must have 1 to 255 characters".into());
        }
        if input.stages.is_empty() || input.stages.len() > 50 {
            return bad("a workflow needs 1 to 50 stages".into());
        }
        let mut names = HashSet::new();
        for stage in &input.stages {
            if stage.name.trim().is_empty() || stage.name.chars().count() > 255 {
                return bad("stage names must have 1 to 255 characters".into());
            }
            if !names.insert(stage.name.trim().to_lowercase()) {
                return bad(format!("the stage `{}` is listed twice", stage.name));
            }
            if !valid_color(&stage.color) {
                return bad(format!("stage colors are #rrggbb (got `{}`)", stage.color));
            }
        }
        if let Some(publish) = &input.publish_stage
            && !input.stages.iter().any(|stage| stage.name.trim() == publish.trim())
        {
            return bad(format!("the publish stage `{publish}` is not one of the stages"));
        }
        for uid in &input.content_types {
            if !known_types.contains(uid) {
                return bad(format!("unknown content type `{uid}`"));
            }
            if let Some(other) = self.workflow_for(uid).filter(|other| Some(other.id) != id) {
                return bad(format!("`{uid}` already uses the workflow `{}`", other.name));
            }
        }
        if let Some(id) = id {
            let workflow = self.get(id).ok_or(ApiError::NotFound)?;
            for stage in &input.stages {
                if let Some(stage_id) = stage.id
                    && workflow.stage(stage_id).is_none()
                {
                    return bad(format!("stage {stage_id} is not part of this workflow"));
                }
            }
        }
        Ok(())
    }

    /// Creates (`id` None) or replaces a workflow; returns its id. Entries in removed
    /// stages move to the first stage.
    pub async fn save(
        &self,
        id: Option<i64>,
        input: &WorkflowInput,
        known_types: &HashSet<String>,
    ) -> Result<i64, ApiError> {
        self.validate(id, input, known_types)?;
        let at = now();
        let mut tx = self.db().begin().await.map_err(internal)?;
        let types = V::Json(json!(input.content_types));
        let id = match id {
            Some(id) => {
                tx.execute(
                    &format!("UPDATE {WORKFLOWS} SET name = ?, content_types = ?, updated_at = ? WHERE id = ?"),
                    &[V::Text(input.name.trim().into()), types, V::DateTime(at), V::BigInt(id)],
                )
                .await
                .map_err(internal)?;
                id
            }
            None => tx
                .insert_returning_id(
                    &format!(
                        "INSERT INTO {WORKFLOWS} (name, content_types, publish_stage_id, created_at, updated_at) \
                         VALUES (?, ?, ?, ?, ?)"
                    ),
                    &[V::Text(input.name.trim().into()), types, V::Null(K::BigInt), V::DateTime(at), V::DateTime(at)],
                )
                .await
                .map_err(internal)?,
        };
        let mut kept = Vec::new();
        let mut publish_stage = None;
        for (position, stage) in input.stages.iter().enumerate() {
            let roles = V::Json(json!(stage.roles));
            let values = [
                V::Text(stage.name.trim().into()),
                V::Text(stage.color.clone()),
                V::Int(position as i32),
                roles,
            ];
            let stage_id = match stage.id {
                Some(stage_id) => {
                    let mut params = values.to_vec();
                    params.push(V::BigInt(stage_id));
                    tx.execute(
                        &format!(
                            "UPDATE {WORKFLOW_STAGES} SET name = ?, color = ?, position = ?, roles = ? WHERE id = ?"
                        ),
                        &params,
                    )
                    .await
                    .map_err(internal)?;
                    stage_id
                }
                None => {
                    let mut params = vec![V::BigInt(id)];
                    params.extend(values);
                    tx.insert_returning_id(
                        &format!(
                            "INSERT INTO {WORKFLOW_STAGES} (workflow_id, name, color, position, roles) VALUES (?, ?, ?, ?, ?)"
                        ),
                        &params,
                    )
                    .await
                    .map_err(internal)?
                }
            };
            if input.publish_stage.as_deref().map(str::trim) == Some(stage.name.trim()) {
                publish_stage = Some(stage_id);
            }
            kept.push(stage_id);
        }
        tx.execute(
            &format!("UPDATE {WORKFLOWS} SET publish_stage_id = ? WHERE id = ?"),
            &[publish_stage.map_or(V::Null(K::BigInt), V::BigInt), V::BigInt(id)],
        )
        .await
        .map_err(internal)?;
        // Removed stages: their entries go back to the first stage.
        let placeholders = vec!["?"; kept.len()].join(", ");
        let mut params = vec![V::BigInt(kept[0]), V::BigInt(id)];
        params.extend(kept.iter().map(|id| V::BigInt(*id)));
        tx.execute(
            &format!(
                "UPDATE {DOCUMENT_STAGES} SET stage_id = ? WHERE stage_id IN \
                 (SELECT id FROM {WORKFLOW_STAGES} WHERE workflow_id = ? AND id NOT IN ({placeholders}))"
            ),
            &params,
        )
        .await
        .map_err(internal)?;
        let mut params = vec![V::BigInt(id)];
        params.extend(kept.iter().map(|id| V::BigInt(*id)));
        tx.execute(
            &format!(
                "DELETE FROM {WORKFLOW_STAGES} WHERE workflow_id = ? AND id NOT IN ({placeholders})"
            ),
            &params,
        )
        .await
        .map_err(internal)?;
        // Types that left the workflow lose their stages.
        let types: Vec<String> =
            self.get(id).map(|previous| previous.content_types).unwrap_or_default();
        for uid in types.iter().filter(|uid| !input.content_types.contains(uid)) {
            tx.execute(
                &format!("DELETE FROM {DOCUMENT_STAGES} WHERE content_type = ?"),
                &[V::Text(uid.clone())],
            )
            .await
            .map_err(internal)?;
        }
        tx.commit().await.map_err(internal)?;
        self.reload().await.map_err(internal)?;
        Ok(id)
    }

    pub async fn delete(&self, id: i64) -> Result<bool, ApiError> {
        let mut tx = self.db().begin().await.map_err(internal)?;
        tx.execute(
            &format!(
                "DELETE FROM {DOCUMENT_STAGES} WHERE stage_id IN (SELECT id FROM {WORKFLOW_STAGES} WHERE workflow_id = ?)"
            ),
            &[V::BigInt(id)],
        )
        .await
        .map_err(internal)?;
        tx.execute(
            &format!("DELETE FROM {WORKFLOW_STAGES} WHERE workflow_id = ?"),
            &[V::BigInt(id)],
        )
        .await
        .map_err(internal)?;
        let deleted = tx
            .execute(&format!("DELETE FROM {WORKFLOWS} WHERE id = ?"), &[V::BigInt(id)])
            .await
            .map_err(internal)?;
        tx.commit().await.map_err(internal)?;
        self.reload().await.map_err(internal)?;
        Ok(deleted > 0)
    }

    fn decode(row: Vec<V>) -> EntryStage {
        let mut row = row.into_iter();
        let mut next = || row.next().unwrap_or(V::Null(K::Text));
        EntryStage {
            uid: next().into_text().unwrap_or_default(),
            document_id: next().into_text().unwrap_or_default(),
            locale: next().into_text().unwrap_or_default(),
            stage_id: next().as_i64().unwrap_or_default(),
            assignee_id: next().as_i64(),
            updated_at: match next() {
                V::DateTime(at) => Some(format_datetime(at)),
                _ => None,
            },
            updated_by: next().as_i64(),
        }
    }

    const COLUMNS: &'static str =
        "content_type, document_id, locale, stage_id, assignee_id, updated_at, updated_by";
    const KINDS: &'static [K] =
        &[K::Text, K::Text, K::Text, K::BigInt, K::BigInt, K::DateTime, K::BigInt];

    pub async fn entry(
        &self,
        uid: &str,
        document_id: &str,
        locale: &str,
    ) -> Result<Option<EntryStage>, DbError> {
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT {} FROM {DOCUMENT_STAGES} WHERE content_type = ? AND document_id = ? AND locale = ?",
                    Self::COLUMNS
                ),
                &[V::from(uid), V::from(document_id), V::from(locale)],
                Self::KINDS,
            )
            .await?;
        Ok(rows.into_iter().next().map(Self::decode))
    }

    /// Stages of several entries (list columns).
    pub async fn entries(
        &self,
        uid: &str,
        document_ids: &[String],
        locale: &str,
    ) -> Result<Vec<EntryStage>, DbError> {
        if document_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = vec!["?"; document_ids.len()].join(", ");
        let mut params = vec![V::from(uid), V::from(locale)];
        params.extend(document_ids.iter().map(|id| V::Text(id.clone())));
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT {} FROM {DOCUMENT_STAGES} WHERE content_type = ? AND locale = ? AND document_id IN ({placeholders})",
                    Self::COLUMNS
                ),
                &params,
                Self::KINDS,
            )
            .await?;
        Ok(rows.into_iter().map(Self::decode).collect())
    }

    /// Entries assigned to an admin, most recently changed first.
    pub async fn assigned_to(&self, user_id: i64) -> Result<Vec<EntryStage>, DbError> {
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT {} FROM {DOCUMENT_STAGES} WHERE assignee_id = ? ORDER BY updated_at DESC LIMIT 200",
                    Self::COLUMNS
                ),
                &[V::BigInt(user_id)],
                Self::KINDS,
            )
            .await?;
        Ok(rows.into_iter().map(Self::decode).collect())
    }

    /// Sets the stage and/or the assignee of an entry (`None`: unchanged; the assignee is
    /// `Some(None)` to clear it).
    pub async fn update_entry(
        &self,
        uid: &str,
        document_id: &str,
        locale: &str,
        stage_id: Option<i64>,
        assignee: Option<Option<i64>>,
        actor: Option<i64>,
    ) -> Result<EntryStage, ApiError> {
        let workflow = self.workflow_for(uid).ok_or(ApiError::NotFound)?;
        let current = self.entry(uid, document_id, locale).await.map_err(internal)?;
        let stage = stage_id
            .or(current.as_ref().map(|entry| entry.stage_id))
            .unwrap_or(workflow.stages[0].id);
        let assignee = assignee.unwrap_or(current.as_ref().and_then(|entry| entry.assignee_id));
        let at = V::DateTime(now());
        let actor = actor.map_or(V::Null(K::BigInt), V::BigInt);
        let assignee_value = assignee.map_or(V::Null(K::BigInt), V::BigInt);
        let key = [V::from(uid), V::from(document_id), V::from(locale)];
        if current.is_some() {
            let mut params = vec![V::BigInt(stage), assignee_value, at, actor];
            params.extend(key);
            self.db()
                .queries()
                .execute(
                    &format!(
                        "UPDATE {DOCUMENT_STAGES} SET stage_id = ?, assignee_id = ?, updated_at = ?, updated_by = ? \
                         WHERE content_type = ? AND document_id = ? AND locale = ?"
                    ),
                    &params,
                )
                .await
                .map_err(internal)?;
        } else {
            let mut params = key.to_vec();
            params.extend([V::BigInt(stage), assignee_value, at, actor]);
            self.db()
                .queries()
                .execute(
                    &format!(
                        "INSERT INTO {DOCUMENT_STAGES} ({}) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        Self::COLUMNS
                    ),
                    &params,
                )
                .await
                .map_err(internal)?;
        }
        self.entry(uid, document_id, locale).await.map_err(internal)?.ok_or(ApiError::NotFound)
    }

    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }

    pub fn hook(&self) -> Arc<dyn DocumentHook> {
        Arc::new(self.clone())
    }
}

impl DocumentListener for Review {
    fn notify<'a>(&'a self, event: &'a DocumentEvent, _: &'a DocumentService) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if !self.enabled() {
                return;
            }
            let locale = event.locale.clone().unwrap_or_default();
            let result = match event.kind {
                EventKind::Created => match self.workflow_for(&event.uid) {
                    Some(_) => self
                        .update_entry(&event.uid, &event.document_id, &locale, None, None, event.actor)
                        .await
                        .map(|_| ())
                        .map_err(|error| format!("{error:?}")),
                    None => Ok(()),
                },
                EventKind::Deleted => self
                    .db()
                    .queries()
                    .execute(
                        &format!(
                            "DELETE FROM {DOCUMENT_STAGES} WHERE content_type = ? AND document_id = ? AND locale = ?"
                        ),
                        &[V::from(event.uid.as_str()), V::from(event.document_id.as_str()), V::from(locale.as_str())],
                    )
                    .await
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
                _ => Ok(()),
            };
            if let Err(error) = result {
                tracing::warn!(%error, uid = %event.uid, "could not update the review stage");
            }
        })
    }
}

impl DocumentHook for Review {
    /// Publishing waits for the workflow's publish stage.
    fn before<'a>(
        &'a self,
        context: HookContext<'a>,
    ) -> BoxFuture<'a, Result<Option<serde_json::Value>, String>> {
        Box::pin(async move {
            if context.action != HookAction::Publish || !self.enabled() {
                return Ok(None);
            }
            let Some(workflow) = self.workflow_for(context.uid) else { return Ok(None) };
            let Some(required) = workflow.publish_stage_id else { return Ok(None) };
            let Some(document_id) = context.document_id else { return Ok(None) };
            let locale = context.locale.clone().unwrap_or_default();
            let entry = self
                .entry(context.uid, document_id, &locale)
                .await
                .map_err(|error| error.to_string())?;
            if entry.is_some_and(|entry| entry.stage_id == required) {
                return Ok(None);
            }
            let name = workflow.stage(required).map_or("?", |stage| stage.name.as_str());
            Err(format!("the entry must be in the review stage `{name}` to be published"))
        })
    }
}
