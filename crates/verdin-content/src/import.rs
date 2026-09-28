//! Low-level writes for importers (`verdin import strapi`): versions, links and media
//! inserted as they are, without events, publishing rules or reference checks (the
//! importer maps every reference itself).

use serde_json::Value as Json;
use time::OffsetDateTime;
use verdin_db::{ColumnKind, SqlValue};

use super::{
    DRAFT, PUBLISHED, SqlBuilder, actor_value, db_error, now, replace_links, write_insert,
};
use crate::input::prepare_imported;
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
        let prepared = prepare_imported(model, &self.registry().schema, version.data)
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

/// One stored version, as `verdin export` writes it (see [`DocumentService::export_versions`]).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedVersion {
    pub document_id: String,
    /// Empty for types that are not localized.
    pub locale: String,
    pub published: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub published_at: Option<String>,
    /// Attribute values in the write format, private ones and password hashes included;
    /// components and dynamic zones as stored (their references unresolved).
    pub data: serde_json::Map<String, Json>,
    /// Owning relations: target `documentId`s in order.
    #[serde(default)]
    pub relations: serde_json::Map<String, Json>,
    /// Media fields: file ids (of the export) in order.
    #[serde(default)]
    pub media: serde_json::Map<String, Json>,
    /// Polymorphic owner attributes: `{ __type, documentId }` items in order.
    #[serde(default)]
    pub morph: serde_json::Map<String, Json>,
}

impl DocumentService {
    /// Every version of every document of `uid` (drafts, published versions, all
    /// locales), for backups.
    pub async fn export_versions(&self, uid: &str) -> Result<Vec<ExportedVersion>> {
        use verdin_query::FieldCategory;
        let model = self.registry().get(uid)?;
        let columns: Vec<&verdin_query::Field> = model
            .fields
            .attributes()
            .filter(|field| matches!(field.category, FieldCategory::Scalar | FieldCategory::Nested))
            .collect();
        let mut select = SqlBuilder::new(self.db().flavor());
        select.push("SELECT ");
        let system = [
            "id",
            "document_id",
            "locale",
            "publication_state",
            "created_at",
            "updated_at",
            "published_at",
        ];
        for (index, column) in system.iter().enumerate() {
            if index > 0 {
                select.push(", ");
            }
            select.ident(column);
        }
        for field in &columns {
            select.push(", ").ident(&field.column);
        }
        select.push(" FROM ").ident(model.table()).push(" ORDER BY ").ident("id");
        let mut kinds = vec![
            ColumnKind::BigInt,
            ColumnKind::Text,
            ColumnKind::Text,
            ColumnKind::SmallInt,
            ColumnKind::DateTime,
            ColumnKind::DateTime,
            ColumnKind::DateTime,
        ];
        kinds.extend(columns.iter().map(|field| field.kind));
        let rows = self.db().queries().fetch_all(&select.sql, &select.params, &kinds).await?;
        let exact = crate::OutputOptions { decimal_as_string: true };
        let at = |value: &SqlValue| match value {
            SqlValue::DateTime(at) => Some(verdin_db::value::format_datetime(*at)),
            _ => None,
        };
        let mut ids = Vec::with_capacity(rows.len());
        let mut versions = Vec::with_capacity(rows.len());
        for row in rows {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(SqlValue::Null(ColumnKind::Text));
            ids.push(next().as_i64().unwrap_or_default());
            let document_id = next().as_text().unwrap_or_default().to_owned();
            let locale = next().as_text().unwrap_or_default().to_owned();
            let published = next().as_i64() == Some(i64::from(PUBLISHED));
            let (created, updated, published_at) = (next(), next(), next());
            let mut data = serde_json::Map::new();
            for field in &columns {
                let kind = field.attribute.as_ref().map(|attribute| &attribute.kind);
                let value = crate::output::value_to_json(kind, next(), exact);
                if !value.is_null() {
                    data.insert(field.api.clone(), value);
                }
            }
            versions.push(ExportedVersion {
                document_id,
                locale,
                published,
                created_at: at(&created),
                updated_at: at(&updated),
                published_at: at(&published_at),
                data,
                relations: Default::default(),
                media: Default::default(),
                morph: Default::default(),
            });
        }
        let index: std::collections::HashMap<i64, usize> =
            ids.iter().enumerate().map(|(position, id)| (*id, position)).collect();
        for (row, links) in self.morph_exports(model, &ids).await? {
            versions[index[&row]].morph = links;
        }
        for field in model.fields.attributes() {
            if let Some(relation) = field.relation.as_ref().filter(|relation| relation.owner) {
                for (source, target) in self.links_of_sources(&relation.link_table, &ids).await? {
                    let version = &mut versions[index[&source]];
                    let list = version
                        .relations
                        .entry(field.api.clone())
                        .or_insert_with(|| Json::Array(Vec::new()));
                    if let Json::Array(items) = list {
                        items.push(Json::String(target));
                    }
                }
            }
            if let Some(info) = &field.media {
                for (source, files) in crate::media::files_of_sources(self.db(), info, &ids).await?
                {
                    let ids: Vec<Json> = files.iter().map(|file| Json::from(file.id)).collect();
                    versions[index[&source]].media.insert(field.api.clone(), Json::Array(ids));
                }
            }
        }
        Ok(versions)
    }
}

/// Renumbers the file ids stored inside the components and dynamic zones of `data`
/// (imports give files new ids); unknown ids are dropped.
pub fn remap_component_files(
    schema: &verdin_schema::Schema,
    attributes: &indexmap::IndexMap<String, verdin_schema::Attribute>,
    data: &mut serde_json::Map<String, Json>,
    files: &std::collections::HashMap<i64, i64>,
) {
    for (name, attribute) in attributes {
        if !matches!(
            attribute.kind,
            verdin_schema::AttributeKind::Component { .. }
                | verdin_schema::AttributeKind::DynamicZone { .. }
        ) {
            continue;
        }
        let Some(value) = data.get_mut(name) else { continue };
        crate::refs::rewrite(
            schema,
            &attribute.kind,
            value,
            &mut |_, target, stored| match target {
                crate::refs::Target::Files { .. } => {
                    let map = |value: &Json| {
                        value.as_i64().and_then(|id| files.get(&id)).map(|id| Json::from(*id))
                    };
                    match stored {
                        Json::Array(items) => Json::Array(items.iter().filter_map(map).collect()),
                        single => map(single).unwrap_or(Json::Null),
                    }
                }
                crate::refs::Target::Documents { .. } => stored.clone(),
            },
        );
    }
}
