//! Files and folders brought in by importers (`verdin import strapi`), kept as they were:
//! names, hashes, formats, folders and dates.

use std::path::PathBuf;

use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use serde_json::{Map, Value as Json};
use time::OffsetDateTime;
use verdin_db::SqlValue;
use verdin_migrate::system::{FILES, FOLDERS};
use verdin_query::sql::SqlBuilder;

use super::{
    Result, UploadError, UploadService, now, optional_i64, optional_json, optional_text,
    write_insert,
};
use crate::FileRecord;

/// A stored object to upload: its key (`{hash}{ext}`), local path and MIME type.
#[derive(Debug, Clone)]
pub struct ImportedObject {
    pub key: String,
    pub path: PathBuf,
    pub mime: String,
}

#[derive(Debug, Clone)]
pub struct ImportedFile {
    pub name: String,
    pub alternative_text: Option<String>,
    pub caption: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub focal_point: Option<Json>,
    /// Formats by name (`thumbnail`, `small`…), each with `hash` and `ext`; their `url`
    /// is rewritten for this storage.
    pub formats: Option<Map<String, Json>>,
    pub hash: String,
    pub ext: String,
    pub mime: String,
    /// Kilobytes, like Strapi.
    pub size: f64,
    pub folder_id: Option<i64>,
    pub folder_path: String,
    pub created_at: Option<OffsetDateTime>,
    pub updated_at: Option<OffsetDateTime>,
    /// The main object first, then the formats'.
    pub objects: Vec<ImportedObject>,
}

impl UploadService {
    /// Stores the objects of a file and records it.
    pub async fn import_file(&self, file: ImportedFile) -> Result<FileRecord> {
        for object in &file.objects {
            self.storage
                .put_file(&object.key, &object.path, &object.mime)
                .await
                .map_err(|error| UploadError::Storage(error.to_string()))?;
        }
        let main = format!("{}{}", file.hash, file.ext);
        let formats = file.formats.map(|formats| {
            Json::Object(
                formats
                    .into_iter()
                    .map(|(name, mut format)| {
                        let key = format!(
                            "{}{}",
                            format["hash"].as_str().unwrap_or_default(),
                            format["ext"].as_str().unwrap_or_default()
                        );
                        format["url"] = Json::String(self.storage.url(&key));
                        (name, format)
                    })
                    .collect(),
            )
        });
        let created = file.created_at.unwrap_or_else(now);
        let int = |value: Option<i64>| {
            value.map_or(SqlValue::Null(verdin_db::ColumnKind::Int), |value| {
                SqlValue::Int(i32::try_from(value).unwrap_or(i32::MAX))
            })
        };
        let mut insert = SqlBuilder::new(self.db.flavor());
        write_insert(
            &mut insert,
            FILES,
            vec![
                ("document_id", SqlValue::Text(ulid::Ulid::generate().to_string().to_lowercase())),
                ("name", SqlValue::Text(file.name)),
                ("alternative_text", optional_text(file.alternative_text)),
                ("caption", optional_text(file.caption)),
                ("width", int(file.width)),
                ("height", int(file.height)),
                ("focal_point", optional_json(file.focal_point)),
                ("formats", optional_json(formats)),
                ("hash", SqlValue::Text(file.hash)),
                ("ext", SqlValue::Text(file.ext)),
                ("mime", SqlValue::Text(file.mime)),
                (
                    "size",
                    SqlValue::Decimal(Decimal::from_f64(file.size).unwrap_or_default().round_dp(2)),
                ),
                ("url", SqlValue::Text(self.storage.url(&main))),
                ("preview_url", SqlValue::Null(verdin_db::ColumnKind::Text)),
                ("provider", SqlValue::Text(self.storage.provider().into())),
                ("provider_metadata", SqlValue::Null(verdin_db::ColumnKind::Json)),
                ("folder_id", optional_i64(file.folder_id)),
                ("folder_path", SqlValue::Text(file.folder_path)),
                ("created_by", optional_i64(None)),
                ("updated_by", optional_i64(None)),
                ("created_at", SqlValue::DateTime(created)),
                ("updated_at", SqlValue::DateTime(file.updated_at.unwrap_or(created))),
            ],
        );
        let id = self.db.queries().insert_returning_id(&insert.sql, &insert.params).await?;
        self.find(id).await?.ok_or(UploadError::NotFound)
    }

    /// Records a folder with its Strapi `pathId` and `path` (`/1/4`), returning its id.
    pub async fn import_folder(
        &self,
        name: &str,
        path_id: i64,
        path: &str,
        parent: Option<i64>,
    ) -> Result<i64> {
        let now = now();
        let mut insert = SqlBuilder::new(self.db.flavor());
        write_insert(
            &mut insert,
            FOLDERS,
            vec![
                ("document_id", SqlValue::Text(ulid::Ulid::generate().to_string().to_lowercase())),
                ("name", SqlValue::Text(name.into())),
                ("path_id", SqlValue::Int(i32::try_from(path_id).unwrap_or(i32::MAX))),
                ("path", SqlValue::Text(path.into())),
                ("parent_id", optional_i64(parent)),
                ("created_by", optional_i64(None)),
                ("created_at", SqlValue::DateTime(now)),
                ("updated_at", SqlValue::DateTime(now)),
            ],
        );
        Ok(self.db.queries().insert_returning_id(&insert.sql, &insert.params).await?)
    }
}
