use std::path::PathBuf;
use std::sync::Arc;

use rust_decimal::Decimal;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value as Json, json};
use time::OffsetDateTime;
use verdin_content::events::{FileEventKind, FileListener};
use verdin_content::media::FileRecord;
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind, Database, DbError, SqlValue};
use verdin_migrate::system::{FILES, FOLDERS};
use verdin_query::sql::SqlBuilder;
use verdin_schema::MediaType;

#[path = "import.rs"]
pub mod import;

use crate::config::UploadConfig;
use crate::image::{analyse, dimensions, resizable};
use crate::mime::{detect_mime, extension_of};
use crate::storage::Storage;

const MAX_NAME: usize = 255;
const MAX_TEXT: usize = 10_000;
const MAX_PAGE_SIZE: u64 = 100;

#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    #[error("{0}")]
    Validation(String),
    #[error("not found")]
    NotFound,
    #[error("the file exceeds the {0} MB limit")]
    TooLarge(u64),
    #[error("storage error: {0}")]
    Storage(String),
    #[error(transparent)]
    Db(#[from] DbError),
}

impl From<object_store::Error> for UploadError {
    fn from(error: object_store::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

type Result<T> = std::result::Result<T, UploadError>;

/// An uploaded file waiting on disk (the HTTP layer streams it to a temporary file).
#[derive(Debug)]
pub struct IncomingFile {
    pub path: PathBuf,
    /// The client's file name.
    pub name: String,
    pub size: u64,
}

/// Editable metadata (Strapi's `fileInfo`). Absent fields are kept, `null` clears.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct FileInfo {
    pub name: Option<String>,
    #[serde(deserialize_with = "some")]
    pub alternative_text: Option<Option<String>>,
    #[serde(deserialize_with = "some")]
    pub caption: Option<Option<String>>,
    /// Folder id; `null` is the root.
    #[serde(deserialize_with = "some")]
    pub folder: Option<Option<i64>>,
    /// `{ "x": 0..1, "y": 0..1 }`.
    #[serde(deserialize_with = "some")]
    pub focal_point: Option<Option<Json>>,
}

fn some<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileSort {
    #[default]
    CreatedAtDesc,
    CreatedAtAsc,
    NameAsc,
    NameDesc,
    UpdatedAtDesc,
    SizeDesc,
}

impl FileSort {
    fn sql(self) -> (&'static str, &'static str) {
        match self {
            Self::CreatedAtDesc => ("created_at", "DESC"),
            Self::CreatedAtAsc => ("created_at", "ASC"),
            Self::NameAsc => ("name", "ASC"),
            Self::NameDesc => ("name", "DESC"),
            Self::UpdatedAtDesc => ("updated_at", "DESC"),
            Self::SizeDesc => ("size", "DESC"),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct FileQuery {
    /// `None`: every folder. `Some(None)`: the root only. `Some(Some(id))`: that folder.
    pub folder: Option<Option<i64>>,
    pub search: Option<String>,
    /// Empty: any type.
    pub types: Vec<MediaType>,
    pub ids: Option<Vec<i64>>,
    pub sort: FileSort,
    pub page: u64,
    pub page_size: u64,
}

#[derive(Debug, Clone)]
pub struct FileList {
    pub files: Vec<FileRecord>,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub document_id: String,
    pub name: String,
    pub path_id: i64,
    pub path: String,
    pub parent: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// Direct children, filled by listings.
    pub children_count: i64,
    pub files_count: i64,
}

#[derive(Debug, Clone)]
pub struct UploadService {
    db: Database,
    storage: Storage,
    config: Arc<UploadConfig>,
    listeners: Listeners,
}

#[derive(Clone, Default)]
struct Listeners(Vec<Arc<dyn FileListener>>);

impl std::fmt::Debug for Listeners {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} listener(s)", self.0.len())
    }
}

impl UploadService {
    pub fn new(db: Database, storage: Storage, config: UploadConfig) -> Self {
        Self { db, storage, config: Arc::new(config), listeners: Listeners::default() }
    }

    /// Announces file changes to `listener` (webhooks).
    pub fn with_listener(mut self, listener: Arc<dyn FileListener>) -> Self {
        self.listeners.0.push(listener);
        self
    }

    async fn emit(&self, kind: FileEventKind, file: &FileRecord) {
        for listener in &self.listeners.0 {
            listener.file_changed(kind, file).await;
        }
    }

    pub fn storage(&self) -> &Storage {
        &self.storage
    }

    pub fn config(&self) -> &UploadConfig {
        &self.config
    }

    // ------------------------------------------------------------- files

    /// Stores a file and its formats, then records it.
    pub async fn upload(
        &self,
        file: IncomingFile,
        info: FileInfo,
        actor: Option<i64>,
    ) -> Result<FileRecord> {
        if file.size > self.config.max_file_size {
            return Err(UploadError::TooLarge(self.config.max_file_size / 1_000_000));
        }
        let original = clean_name(info.name.as_deref().unwrap_or(&file.name));
        if original.is_empty() {
            return Err(UploadError::Validation("the file needs a name".into()));
        }
        let folder = match info.folder.flatten() {
            Some(id) => Some(self.folder(id).await?),
            None => None,
        };
        let path = file.path.clone();
        let file_name = file.name.clone();
        let mime = tokio::task::spawn_blocking(move || detect_mime(&path, &file_name))
            .await
            .map_err(|error| UploadError::Storage(error.to_string()))?;
        let mut ext = extension_of(&original);
        if ext.is_empty() {
            ext = extension_of(&file.name);
        }
        let hash = format!("{}_{}", slug(stem(&original)), random_suffix());

        // Image metadata and formats (CPU bound).
        let analysis = {
            let path = file.path.clone();
            let mime = mime.clone();
            let config = self.config.clone();
            tokio::task::spawn_blocking(move || match resizable(&mime) {
                Some(format) => analyse(
                    &path,
                    format,
                    &config.breakpoints,
                    config.max_image_megapixels,
                    config.responsive_formats,
                )
                .map(|analysis| (Some((analysis.width, analysis.height)), analysis.formats)),
                None if mime.starts_with("image/") => Some((dimensions(&path), Vec::new())),
                None => None,
            })
            .await
            .map_err(|error| UploadError::Storage(error.to_string()))?
        };
        let (size_px, generated) = analysis.unwrap_or((None, Vec::new()));

        let object = format!("{hash}{ext}");
        let mut stored = vec![object.clone()];
        let result = async {
            self.storage.put_file(&object, &file.path, &mime).await?;
            let mut formats = Map::new();
            for format in &generated {
                let format_hash = format!("{}_{hash}", format.name);
                let key = format!("{format_hash}{ext}");
                let bytes = format.bytes.len();
                self.storage.put_bytes(&key, format.bytes.clone(), &mime).await?;
                stored.push(key.clone());
                formats.insert(
                    format.name.clone(),
                    json!({
                        "name": format!("{}_{original}", format.name),
                        "hash": format_hash,
                        "ext": ext,
                        "mime": mime,
                        "path": null,
                        "width": format.width,
                        "height": format.height,
                        "size": kilobytes(bytes as u64),
                        "sizeInBytes": bytes,
                        "url": self.storage.url(&key),
                    }),
                );
            }
            let now = now();
            let document_id = ulid::Ulid::generate().to_string().to_lowercase();
            let mut insert = SqlBuilder::new(self.db.flavor());
            let values: Vec<(&str, SqlValue)> = vec![
                ("document_id", SqlValue::Text(document_id)),
                ("name", SqlValue::Text(original.clone())),
                ("alternative_text", optional_text(info.alternative_text.clone().flatten())),
                ("caption", optional_text(info.caption.clone().flatten())),
                ("width", optional_int(size_px.map(|(width, _)| width))),
                ("height", optional_int(size_px.map(|(_, height)| height))),
                (
                    "focal_point",
                    optional_json(check_focal_point(info.focal_point.clone().flatten())?),
                ),
                (
                    "formats",
                    if formats.is_empty() {
                        SqlValue::Null(ColumnKind::Json)
                    } else {
                        SqlValue::Json(Json::Object(formats))
                    },
                ),
                ("hash", SqlValue::Text(hash.clone())),
                ("ext", SqlValue::Text(ext.clone())),
                ("mime", SqlValue::Text(mime.clone())),
                ("size", SqlValue::Decimal(kilobytes_decimal(file.size))),
                ("url", SqlValue::Text(self.storage.url(&object))),
                ("preview_url", SqlValue::Null(ColumnKind::Text)),
                ("provider", SqlValue::Text(self.storage.provider().into())),
                ("provider_metadata", SqlValue::Null(ColumnKind::Json)),
                ("folder_id", optional_i64(folder.as_ref().map(|folder| folder.id))),
                (
                    "folder_path",
                    SqlValue::Text(
                        folder.as_ref().map_or("/".into(), |folder| folder.path.clone()),
                    ),
                ),
                ("created_by", optional_i64(actor)),
                ("updated_by", optional_i64(actor)),
                ("created_at", SqlValue::DateTime(now)),
                ("updated_at", SqlValue::DateTime(now)),
            ];
            write_insert(&mut insert, FILES, values);
            let id = self.db.queries().insert_returning_id(&insert.sql, &insert.params).await?;
            Ok::<i64, UploadError>(id)
        }
        .await;
        match result {
            Ok(id) => {
                let file = self.find(id).await?.ok_or(UploadError::NotFound)?;
                self.emit(FileEventKind::Created, &file).await;
                Ok(file)
            }
            Err(error) => {
                for key in &stored {
                    if let Err(cleanup) = self.storage.delete(key).await {
                        tracing::warn!(%key, error = %cleanup, "could not remove an orphan upload");
                    }
                }
                Err(error)
            }
        }
    }

    pub async fn find(&self, id: i64) -> Result<Option<FileRecord>> {
        let list = self
            .list(&FileQuery { ids: Some(vec![id]), page: 1, page_size: 1, ..Default::default() })
            .await?;
        Ok(list.files.into_iter().next())
    }

    pub async fn list(&self, query: &FileQuery) -> Result<FileList> {
        let mut filter = SqlBuilder::new(self.db.flavor());
        filter.push(" WHERE 1 = 1");
        if let Some(ids) = &query.ids {
            if ids.is_empty() {
                return Ok(FileList { files: Vec::new(), total: 0 });
            }
            filter.push(" AND ").ident("id").push(" IN (");
            for (index, id) in ids.iter().enumerate() {
                if index > 0 {
                    filter.push(", ");
                }
                filter.param(SqlValue::BigInt(*id));
            }
            filter.push(")");
        }
        match query.folder {
            None => {}
            Some(None) => {
                filter.push(" AND ").ident("folder_id").push(" IS NULL");
            }
            Some(Some(id)) => {
                filter.push(" AND ").ident("folder_id").push(" = ").param(SqlValue::BigInt(id));
            }
        }
        if let Some(search) = query.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let pattern = format!("%{}%", escape_like(&search.to_lowercase()));
            filter
                .push(" AND (LOWER(")
                .ident("name")
                .push(") LIKE ")
                .param(SqlValue::Text(pattern.clone()));
            filter.push(" ESCAPE '!' OR LOWER(").ident("alternative_text").push(") LIKE ");
            filter.param(SqlValue::Text(pattern)).push(" ESCAPE '!')");
        }
        if !query.types.is_empty() {
            filter.push(" AND (");
            for (index, ty) in query.types.iter().enumerate() {
                if index > 0 {
                    filter.push(" OR ");
                }
                match ty {
                    MediaType::Files => {
                        filter.push("NOT (");
                        for (position, prefix) in
                            ["image/%", "video/%", "audio/%"].iter().enumerate()
                        {
                            if position > 0 {
                                filter.push(" OR ");
                            }
                            filter
                                .ident("mime")
                                .push(" LIKE ")
                                .param(SqlValue::Text((*prefix).into()));
                        }
                        filter.push(")");
                    }
                    other => {
                        let prefix = match other {
                            MediaType::Images => "image/%",
                            MediaType::Videos => "video/%",
                            _ => "audio/%",
                        };
                        filter.ident("mime").push(" LIKE ").param(SqlValue::Text(prefix.into()));
                    }
                }
            }
            filter.push(")");
        }

        let mut count = SqlBuilder::new(self.db.flavor());
        count.push("SELECT COUNT(*) FROM ").ident(FILES);
        count.push(&filter.sql);
        count.params.extend(filter.params.clone());
        let total = self
            .db
            .queries()
            .fetch_all(&count.sql, &count.params, &[ColumnKind::BigInt])
            .await?
            .first()
            .and_then(|row| row[0].as_i64())
            .unwrap_or_default();

        let page_size = query.page_size.clamp(1, MAX_PAGE_SIZE);
        let page = query.page.max(1);
        let (column, direction) = query.sort.sql();
        let mut select = SqlBuilder::new(self.db.flavor());
        select.push("SELECT ");
        FileRecord::select_list(&mut select, None);
        select.push(" FROM ").ident(FILES);
        select.push(&filter.sql);
        select.params.extend(filter.params);
        select.push(" ORDER BY ").ident(column).push(&format!(" {direction}, "));
        select.ident("id").push(&format!(" {direction}"));
        select.push(" LIMIT ").param(SqlValue::BigInt(page_size as i64));
        select.push(" OFFSET ").param(SqlValue::BigInt(((page - 1) * page_size) as i64));
        let rows =
            self.db.queries().fetch_all(&select.sql, &select.params, &FileRecord::kinds()).await?;
        Ok(FileList {
            files: rows.into_iter().map(FileRecord::from_row).collect(),
            total: u64::try_from(total).unwrap_or_default(),
        })
    }

    /// Changes metadata and/or moves the file to another folder.
    pub async fn update(&self, id: i64, info: FileInfo, actor: Option<i64>) -> Result<FileRecord> {
        let current = self.find(id).await?.ok_or(UploadError::NotFound)?;
        let mut assignments: Vec<(&str, SqlValue)> =
            vec![("updated_at", SqlValue::DateTime(now())), ("updated_by", optional_i64(actor))];
        if let Some(name) = &info.name {
            let name = clean_name(name);
            if name.is_empty() {
                return Err(UploadError::Validation("name cannot be empty".into()));
            }
            assignments.push(("name", SqlValue::Text(name)));
        }
        if let Some(text) = info.alternative_text.clone() {
            assignments.push(("alternative_text", optional_text(text)));
        }
        if let Some(text) = info.caption.clone() {
            assignments.push(("caption", optional_text(text)));
        }
        if let Some(point) = info.focal_point.clone() {
            assignments.push(("focal_point", optional_json(check_focal_point(point)?)));
        }
        if let Some(folder) = info.folder {
            let folder = match folder {
                Some(id) => Some(self.folder(id).await?),
                None => None,
            };
            assignments.push(("folder_id", optional_i64(folder.as_ref().map(|f| f.id))));
            assignments.push((
                "folder_path",
                SqlValue::Text(folder.map_or("/".into(), |folder| folder.path)),
            ));
        }
        let mut update = SqlBuilder::new(self.db.flavor());
        update.push("UPDATE ").ident(FILES).push(" SET ");
        for (index, (column, value)) in assignments.into_iter().enumerate() {
            if index > 0 {
                update.push(", ");
            }
            update.ident(column).push(" = ").param(value);
        }
        update.push(" WHERE ").ident("id").push(" = ").param(SqlValue::BigInt(current.id));
        self.db.queries().execute(&update.sql, &update.params).await?;
        let file = self.find(id).await?.ok_or(UploadError::NotFound)?;
        self.emit(FileEventKind::Updated, &file).await;
        Ok(file)
    }

    /// Deletes the file, its formats and every link to it.
    pub async fn delete(&self, id: i64) -> Result<FileRecord> {
        let file = self.find(id).await?.ok_or(UploadError::NotFound)?;
        self.db
            .queries()
            .execute(&format!("DELETE FROM {FILES} WHERE id = ?"), &[SqlValue::BigInt(id)])
            .await?;
        self.remove_objects(&file).await;
        self.emit(FileEventKind::Deleted, &file).await;
        Ok(file)
    }

    async fn remove_objects(&self, file: &FileRecord) {
        let mut keys = vec![format!("{}{}", file.hash, file.ext)];
        if let Some(Json::Object(formats)) = &file.formats {
            for format in formats.values() {
                if let (Some(hash), Some(ext)) = (format["hash"].as_str(), format["ext"].as_str()) {
                    keys.push(format!("{hash}{ext}"));
                }
            }
        }
        for key in keys {
            if let Err(error) = self.storage.delete(&key).await {
                tracing::warn!(%key, %error, "could not delete a stored file");
            }
        }
    }

    // ----------------------------------------------------------- folders

    pub async fn folder(&self, id: i64) -> Result<Folder> {
        self.folders_where(" WHERE id = ?", vec![SqlValue::BigInt(id)])
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| UploadError::Validation(format!("folder {id} does not exist")))
    }

    /// Direct children of `parent` (`None`: the root), with their counts.
    pub async fn folders(&self, parent: Option<i64>) -> Result<Vec<Folder>> {
        let (filter, params) = match parent {
            Some(id) => (" WHERE parent_id = ?", vec![SqlValue::BigInt(id)]),
            None => (" WHERE parent_id IS NULL", Vec::new()),
        };
        let mut folders = self.folders_where(filter, params).await?;
        for folder in &mut folders {
            folder.children_count = self
                .count(&format!("SELECT COUNT(*) FROM {FOLDERS} WHERE parent_id = ?"), folder.id)
                .await?;
            folder.files_count = self
                .count(&format!("SELECT COUNT(*) FROM {FILES} WHERE folder_id = ?"), folder.id)
                .await?;
        }
        Ok(folders)
    }

    /// Every folder, for pickers (ordered by path).
    pub async fn all_folders(&self) -> Result<Vec<Folder>> {
        self.folders_where("", Vec::new()).await
    }

    async fn count(&self, sql: &str, id: i64) -> Result<i64> {
        Ok(self
            .db
            .queries()
            .fetch_all(sql, &[SqlValue::BigInt(id)], &[ColumnKind::BigInt])
            .await?
            .first()
            .and_then(|row| row[0].as_i64())
            .unwrap_or_default())
    }

    async fn folders_where(&self, filter: &str, params: Vec<SqlValue>) -> Result<Vec<Folder>> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, document_id, name, path_id, path, parent_id, created_at, updated_at \
                     FROM {FOLDERS}{filter} ORDER BY name, id"
                ),
                &params,
                &[
                    ColumnKind::BigInt,
                    ColumnKind::Text,
                    ColumnKind::Text,
                    ColumnKind::Int,
                    ColumnKind::Text,
                    ColumnKind::BigInt,
                    ColumnKind::DateTime,
                    ColumnKind::DateTime,
                ],
            )
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let mut row = row.into_iter();
                let mut next = || row.next().unwrap_or(SqlValue::Null(ColumnKind::Text));
                let datetime = |value: SqlValue| match value {
                    SqlValue::DateTime(at) => Some(format_datetime(at)),
                    _ => None,
                };
                Folder {
                    id: next().as_i64().unwrap_or_default(),
                    document_id: next().into_text().unwrap_or_default(),
                    name: next().into_text().unwrap_or_default(),
                    path_id: next().as_i64().unwrap_or_default(),
                    path: next().into_text().unwrap_or_default(),
                    parent: next().as_i64(),
                    created_at: datetime(next()),
                    updated_at: datetime(next()),
                    children_count: 0,
                    files_count: 0,
                }
            })
            .collect())
    }

    async fn ensure_unique_name(
        &self,
        name: &str,
        parent: Option<i64>,
        except: Option<i64>,
    ) -> Result<()> {
        let siblings = match parent {
            Some(id) => {
                self.folders_where(" WHERE parent_id = ?", vec![SqlValue::BigInt(id)]).await?
            }
            None => self.folders_where(" WHERE parent_id IS NULL", Vec::new()).await?,
        };
        if siblings
            .iter()
            .any(|folder| Some(folder.id) != except && folder.name.eq_ignore_ascii_case(name))
        {
            return Err(UploadError::Validation(format!(
                "a folder named `{name}` already exists here"
            )));
        }
        Ok(())
    }

    pub async fn create_folder(
        &self,
        name: &str,
        parent: Option<i64>,
        actor: Option<i64>,
    ) -> Result<Folder> {
        let name = clean_name(name);
        if name.is_empty() {
            return Err(UploadError::Validation("the folder needs a name".into()));
        }
        let parent_path = match parent {
            Some(id) => self.folder(id).await?.path,
            None => String::new(),
        };
        self.ensure_unique_name(&name, parent, None).await?;
        let mut tx = self.db.begin().await?;
        let next = tx
            .fetch_all(&format!("SELECT MAX(path_id) FROM {FOLDERS}"), &[], &[ColumnKind::Int])
            .await?
            .first()
            .and_then(|row| row[0].as_i64())
            .unwrap_or_default()
            + 1;
        let now = now();
        let mut insert = SqlBuilder::new(self.db.flavor());
        write_insert(
            &mut insert,
            FOLDERS,
            vec![
                ("document_id", SqlValue::Text(ulid::Ulid::generate().to_string().to_lowercase())),
                ("name", SqlValue::Text(name)),
                ("path_id", SqlValue::Int(i32::try_from(next).unwrap_or(i32::MAX))),
                ("path", SqlValue::Text(format!("{parent_path}/{next}"))),
                ("parent_id", optional_i64(parent)),
                ("created_by", optional_i64(actor)),
                ("created_at", SqlValue::DateTime(now)),
                ("updated_at", SqlValue::DateTime(now)),
            ],
        );
        let id = tx.insert_returning_id(&insert.sql, &insert.params).await?;
        tx.commit().await?;
        self.folder(id).await
    }

    /// Renames and/or moves a folder (with everything inside it).
    pub async fn update_folder(
        &self,
        id: i64,
        name: Option<&str>,
        parent: Option<Option<i64>>,
    ) -> Result<Folder> {
        let folder = self.folder(id).await?;
        let target_parent = parent.unwrap_or(folder.parent);
        let new_name = name.map(clean_name).unwrap_or_else(|| folder.name.clone());
        if new_name.is_empty() {
            return Err(UploadError::Validation("the folder needs a name".into()));
        }
        let parent_path = match target_parent {
            Some(parent_id) => {
                let parent = self.folder(parent_id).await?;
                if parent.path == folder.path
                    || parent.path.starts_with(&format!("{}/", folder.path))
                {
                    return Err(UploadError::Validation(
                        "a folder cannot move inside itself".into(),
                    ));
                }
                parent.path
            }
            None => String::new(),
        };
        self.ensure_unique_name(&new_name, target_parent, Some(id)).await?;
        let new_path = format!("{parent_path}/{}", folder.path_id);
        let mut tx = self.db.begin().await?;
        tx.execute(
            &format!("UPDATE {FOLDERS} SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?"),
            &[
                SqlValue::Text(new_name),
                optional_i64(target_parent),
                SqlValue::DateTime(now()),
                SqlValue::BigInt(id),
            ],
        )
        .await?;
        if new_path != folder.path {
            // Rewrite the path prefix of the folder, its descendants and their files.
            for (table, column) in [(FOLDERS, "path"), (FILES, "folder_path")] {
                let rows = tx
                    .fetch_all(
                        &format!(
                            "SELECT id, {column} FROM {table} WHERE {column} = ? OR {column} LIKE ?"
                        ),
                        &[
                            SqlValue::Text(folder.path.clone()),
                            SqlValue::Text(format!("{}/%", folder.path)),
                        ],
                        &[ColumnKind::BigInt, ColumnKind::Text],
                    )
                    .await?;
                for row in rows {
                    let old = row[1].as_text().unwrap_or_default();
                    let updated = format!("{new_path}{}", &old[folder.path.len()..]);
                    tx.execute(
                        &format!("UPDATE {table} SET {column} = ? WHERE id = ?"),
                        &[
                            SqlValue::Text(updated),
                            SqlValue::BigInt(row[0].as_i64().unwrap_or_default()),
                        ],
                    )
                    .await?;
                }
            }
        }
        tx.commit().await?;
        self.folder(id).await
    }

    /// Deletes a folder, its subfolders and every file inside them.
    pub async fn delete_folder(&self, id: i64) -> Result<Folder> {
        let folder = self.folder(id).await?;
        let prefix = format!("{}/%", folder.path);
        let files = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id FROM {FILES} WHERE folder_path = ? OR folder_path LIKE ?"),
                &[SqlValue::Text(folder.path.clone()), SqlValue::Text(prefix.clone())],
                &[ColumnKind::BigInt],
            )
            .await?;
        for row in files {
            if let Some(file_id) = row[0].as_i64() {
                self.delete(file_id).await?;
            }
        }
        self.db
            .queries()
            .execute(
                &format!("DELETE FROM {FOLDERS} WHERE path = ? OR path LIKE ?"),
                &[SqlValue::Text(folder.path.clone()), SqlValue::Text(prefix)],
            )
            .await?;
        Ok(folder)
    }
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn write_insert(out: &mut SqlBuilder, table: &str, values: Vec<(&str, SqlValue)>) {
    out.push("INSERT INTO ").ident(table).push(" (");
    for (index, (column, _)) in values.iter().enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.ident(column);
    }
    out.push(") VALUES (");
    for (index, (_, value)) in values.into_iter().enumerate() {
        if index > 0 {
            out.push(", ");
        }
        out.param(value);
    }
    out.push(")");
}

/// File and folder names: no path separators or control characters, at most 255 chars.
fn clean_name(name: &str) -> String {
    let name = name.rsplit(['/', '\\']).next().unwrap_or_default();
    name.chars().filter(|c| !c.is_control()).take(MAX_NAME).collect::<String>().trim().to_owned()
}

fn stem(name: &str) -> &str {
    match name.rfind('.') {
        Some(0) | None => name,
        Some(index) => &name[..index],
    }
}

/// `My Photo (1)` → `my_photo_1`, at most 100 characters.
fn slug(text: &str) -> String {
    let slug = verdin_content::slugify(text).replace('-', "_");
    let slug: String = slug.chars().take(100).collect();
    if slug.is_empty() { "file".into() } else { slug }
}

fn random_suffix() -> String {
    let random = ulid::Ulid::generate().random();
    format!("{:010x}", random & 0xff_ffff_ffff)
}

fn kilobytes(bytes: u64) -> f64 {
    (bytes as f64 / 10.0).round() / 100.0
}

fn kilobytes_decimal(bytes: u64) -> Decimal {
    (Decimal::from(bytes) / Decimal::from(1000)).round_dp(2)
}

fn optional_text(text: Option<String>) -> SqlValue {
    match text.map(|text| text.chars().take(MAX_TEXT).collect::<String>()) {
        Some(text) => SqlValue::Text(text),
        None => SqlValue::Null(ColumnKind::Text),
    }
}

fn optional_int(value: Option<u32>) -> SqlValue {
    value.map_or(SqlValue::Null(ColumnKind::Int), |value| {
        SqlValue::Int(i32::try_from(value).unwrap_or(i32::MAX))
    })
}

fn optional_i64(value: Option<i64>) -> SqlValue {
    value.map_or(SqlValue::Null(ColumnKind::BigInt), SqlValue::BigInt)
}

fn optional_json(value: Option<Json>) -> SqlValue {
    value.map_or(SqlValue::Null(ColumnKind::Json), SqlValue::Json)
}

fn check_focal_point(point: Option<Json>) -> Result<Option<Json>> {
    let Some(point) = point else { return Ok(None) };
    let coordinate =
        |key: &str| point.get(key).and_then(Json::as_f64).filter(|v| (0.0..=1.0).contains(v));
    match (coordinate("x"), coordinate("y")) {
        (Some(x), Some(y)) => Ok(Some(json!({ "x": x, "y": y }))),
        _ => Err(UploadError::Validation("focalPoint needs x and y between 0 and 1".into())),
    }
}

fn escape_like(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '%' | '_' | '!') {
            out.push('!');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe() {
        assert_eq!(clean_name("../../etc/passwd"), "passwd");
        assert_eq!(clean_name("C:\\Users\\me\\photo.jpg"), "photo.jpg");
        assert_eq!(clean_name("a\u{0}b\nc.png"), "abc.png");
        assert_eq!(stem("photo.final.jpg"), "photo.final");
        assert_eq!(stem(".env"), ".env");
        assert_eq!(slug("Mi Foto (1)"), "mi_foto_1");
        assert_eq!(slug("日本"), "file");
        assert_eq!(random_suffix().len(), 10);
        assert_eq!(kilobytes(123_456), 123.46);
    }

    #[test]
    fn focal_points_are_fractions() {
        assert_eq!(
            check_focal_point(Some(json!({ "x": 0.5, "y": 1 }))).unwrap(),
            Some(json!({ "x": 0.5, "y": 1.0 }))
        );
        assert!(check_focal_point(Some(json!({ "x": 2, "y": 0 }))).is_err());
        assert_eq!(check_focal_point(None).unwrap(), None);
    }
}
