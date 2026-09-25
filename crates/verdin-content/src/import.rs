//! Low-level writes for importers (`verdin import strapi`): versions, links and media
//! inserted as they are, without events, publishing rules or reference checks (the
//! importer maps every reference itself).

use serde_json::Value as Json;
use time::OffsetDateTime;
use verdin_db::{ColumnKind, SqlValue};

use super::{
    DRAFT, PUBLISHED, SqlBuilder, actor_value, db_error, now, replace_links, write_insert,
};
use crate::input::prepare;
use crate::{ContentError, DocumentService, Result};

/// One stored version of a document.
#[derive(Debug, Clone)]
pub struct ImportedVersion<'a> {
    pub document_id: &'a str,
    /// Empty for types that are not localized.
    pub locale: &'a str,
    /// The published version (else the draft; types without draft & publish only have
    /// published versions).
    pub published: bool,
    pub created_at: Option<OffsetDateTime>,
    pub updated_at: Option<OffsetDateTime>,
    pub published_at: Option<OffsetDateTime>,
    /// Attribute values in the content API's write format (components with their
    /// references already mapped); relations and media are imported separately.
    pub data: &'a Json,
}

impl DocumentService {
    /// Inserts one version and returns its row id.
    pub async fn import_version(&self, uid: &str, version: &ImportedVersion<'_>) -> Result<i64> {
        let model = self.registry().get(uid)?;
        let prepared = prepare(model, &self.registry().schema, version.data, true)
            .map_err(ContentError::Validation)?;
        let state = if version.published || !model.draft_and_publish() { PUBLISHED } else { DRAFT };
        let created = version.created_at.unwrap_or_else(now);
        let published_at = match (state, version.published_at) {
            (PUBLISHED, Some(at)) => SqlValue::DateTime(at),
            (PUBLISHED, None) => SqlValue::DateTime(version.updated_at.unwrap_or(created)),
            _ => SqlValue::Null(ColumnKind::DateTime),
        };
        let mut values: Vec<(String, SqlValue)> = vec![
            ("document_id".into(), SqlValue::Text(version.document_id.into())),
            ("locale".into(), SqlValue::Text(version.locale.into())),
            ("publication_state".into(), SqlValue::SmallInt(state)),
            ("published_at".into(), published_at),
            ("created_at".into(), SqlValue::DateTime(created)),
            ("updated_at".into(), SqlValue::DateTime(version.updated_at.unwrap_or(created))),
            ("created_by_id".into(), actor_value(None)),
            ("updated_by_id".into(), actor_value(None)),
        ];
        values.extend(prepared.columns);
        let mut insert = SqlBuilder::new(self.db().flavor());
        write_insert(&mut insert, model.table(), values);
        self.db()
            .queries()
            .insert_returning_id(&insert.sql, &insert.params)
            .await
            .map_err(|error| db_error(model, error))
    }

    /// Sets the links of relation `field` of a row, in order.
    pub async fn import_links(
        &self,
        uid: &str,
        field: &str,
        source_row: i64,
        targets: &[String],
    ) -> Result<()> {
        let model = self.registry().get(uid)?;
        let relation = model
            .fields
            .get(field)
            .and_then(|field| field.relation.as_ref())
            .filter(|relation| relation.owner)
            .ok_or_else(|| {
                ContentError::BadRequest(format!("`{field}` is not an owning relation"))
            })?;
        let mut tx = self.db().begin().await?;
        replace_links(&mut tx, &relation.link_table, source_row, targets).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Sets the files of media `field` of a row, in order.
    pub async fn import_media(
        &self,
        uid: &str,
        field: &str,
        source_row: i64,
        files: &[i64],
    ) -> Result<()> {
        let model = self.registry().get(uid)?;
        let info =
            model.fields.get(field).and_then(|field| field.media.as_ref()).ok_or_else(|| {
                ContentError::BadRequest(format!("`{field}` is not a media field"))
            })?;
        let mut tx = self.db().begin().await?;
        crate::media::replace_media(&mut tx, &info.link_table, source_row, files).await?;
        tx.commit().await?;
        Ok(())
    }
}
