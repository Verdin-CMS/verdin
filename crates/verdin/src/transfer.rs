//! `verdin export` and `verdin import verdin`: a whole project in one `.tar.gz` — its
//! schema files, locales, media folders and files (with their stored objects), and every
//! version of every entry with its relations and media. Admin accounts, API tokens and
//! settings are not included.
//!
//! Layout: `manifest.json`, `schema/…`, `locales.json`, `folders.json`, `files.jsonl`,
//! `assets/{hash}{ext}`, `entries/{uid}.jsonl` (one [`ExportedVersion`] per line).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use verdin_content::{DocumentService, ExportedVersion, ImportedVersion, Registry};
use verdin_db::{Database, SqlValue as V};
use verdin_migrate::system::LOCALES;
use verdin_migrate::{ApplyOptions, Renames, Risk};
use verdin_schema::Schema;
use verdin_upload::{FileQuery, UploadService};

const FORMAT: &str = "verdin-export";
const VERSION: u64 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    version: u64,
    verdin: String,
    created_at: String,
    /// Content type uid → versions exported.
    entries: std::collections::BTreeMap<String, usize>,
    files: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedFolder {
    id: i64,
    name: String,
    path_id: i64,
    path: String,
    parent: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedFile {
    id: i64,
    #[serde(default)]
    document_id: Option<String>,
    name: String,
    alternative_text: Option<String>,
    caption: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    focal_point: Option<Value>,
    formats: Option<Value>,
    hash: String,
    ext: String,
    mime: String,
    size: f64,
    folder_id: Option<i64>,
    folder_path: String,
    created_at: Option<String>,
    updated_at: Option<String>,
}

impl ExportedFile {
    /// `{hash}{ext}` of the file and of its formats.
    fn keys(&self) -> Vec<String> {
        let mut keys = vec![format!("{}{}", self.hash, self.ext)];
        if let Some(Value::Object(formats)) = &self.formats {
            for format in formats.values() {
                if let (Some(hash), Some(ext)) = (format["hash"].as_str(), format["ext"].as_str()) {
                    keys.push(format!("{hash}{ext}"));
                }
            }
        }
        keys
    }
}

/// `api::article` → `api__article` (a file name).
fn file_name(uid: &str) -> String {
    uid.replace("::", "__").replace(['/', '\\'], "_")
}

fn safe_key(key: &str) -> bool {
    !key.is_empty() && !key.contains('/') && !key.contains('\\') && !key.starts_with('.')
}

#[derive(Debug, Default)]
pub struct Summary {
    pub versions: usize,
    pub documents: usize,
    pub files: usize,
    pub folders: usize,
    pub locales: usize,
}

fn append(builder: &mut tar::Builder<impl Write>, path: &str, bytes: &[u8]) -> Result<()> {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(time::OffsetDateTime::now_utc().unix_timestamp().max(0) as u64);
    header.set_cksum();
    builder.append_data(&mut header, path, bytes).with_context(|| format!("writing {path}"))
}

/// Writes the project's content to `output` (`.tar.gz`).
pub async fn export(
    schema_dir: &Path,
    db: &Database,
    upload: &UploadService,
    output: &Path,
    with_media: bool,
) -> Result<Summary> {
    let schema = Schema::load_dir(schema_dir).map_err(|errors| anyhow::anyhow!("{errors}"))?;
    let service = DocumentService::new(db.clone(), Registry::new(schema), Default::default());
    let file =
        std::fs::File::create(output).with_context(|| format!("creating {}", output.display()))?;
    let mut builder =
        tar::Builder::new(flate2::write::GzEncoder::new(file, flate2::Compression::default()));
    let mut summary = Summary::default();

    // Schema files.
    for entry in walkdir(schema_dir)? {
        let relative =
            entry.strip_prefix(schema_dir).expect("inside").to_string_lossy().replace('\\', "/");
        let bytes =
            std::fs::read(&entry).with_context(|| format!("reading {}", entry.display()))?;
        append(&mut builder, &format!("schema/{relative}"), &bytes)?;
    }

    let locales = verdin_api::i18n::load_locales(db).await?;
    summary.locales = locales.locales.len();
    let locales_json = json!({
        "default": locales.default,
        "locales": locales.locales.iter().map(|locale| json!({ "code": locale.code, "name": locale.name })).collect::<Vec<_>>(),
    });
    append(&mut builder, "locales.json", locales_json.to_string().as_bytes())?;

    let mut files_jsonl = Vec::new();
    if with_media {
        let folders: Vec<ExportedFolder> = upload
            .all_folders()
            .await?
            .into_iter()
            .map(|folder| ExportedFolder {
                id: folder.id,
                name: folder.name,
                path_id: folder.path_id,
                path: folder.path,
                parent: folder.parent,
            })
            .collect();
        summary.folders = folders.len();
        append(&mut builder, "folders.json", serde_json::to_string(&folders)?.as_bytes())?;
        let mut page = 1;
        loop {
            let list = upload
                .list(&FileQuery { folder: None, page, page_size: 200, ..Default::default() })
                .await?;
            if list.files.is_empty() {
                break;
            }
            for record in &list.files {
                let exported = ExportedFile {
                    id: record.id,
                    document_id: Some(record.document_id.clone()),
                    name: record.name.clone(),
                    alternative_text: record.alternative_text.clone(),
                    caption: record.caption.clone(),
                    width: record.width,
                    height: record.height,
                    focal_point: record.focal_point.clone(),
                    formats: record.formats.clone(),
                    hash: record.hash.clone(),
                    ext: record.ext.clone(),
                    mime: record.mime.clone(),
                    size: record.size.to_string().parse().unwrap_or_default(),
                    folder_id: record.folder_id,
                    folder_path: record.folder_path.clone(),
                    created_at: record.created_at.map(verdin_db::value::format_datetime),
                    updated_at: record.updated_at.map(verdin_db::value::format_datetime),
                };
                for key in exported.keys() {
                    match upload.storage().get(&key).await {
                        Ok(bytes) => append(&mut builder, &format!("assets/{key}"), &bytes)?,
                        Err(error) => {
                            tracing::warn!(%key, %error, "a stored object is missing; skipped")
                        }
                    }
                }
                serde_json::to_writer(&mut files_jsonl, &exported)?;
                files_jsonl.push(b'\n');
                summary.files += 1;
            }
            page += 1;
        }
    }
    append(&mut builder, "files.jsonl", &files_jsonl)?;

    let mut counts = std::collections::BTreeMap::new();
    let uids: Vec<String> =
        service.registry().types().map(|model| model.content_type.uid.clone()).collect();
    for uid in uids {
        let versions = service.export_versions(&uid).await?;
        let mut lines = Vec::new();
        let mut documents = std::collections::HashSet::new();
        for version in &versions {
            documents.insert(version.document_id.clone());
            let mut version = version.clone();
            if !with_media {
                version.media.clear();
            }
            serde_json::to_writer(&mut lines, &version)?;
            lines.push(b'\n');
        }
        summary.versions += versions.len();
        summary.documents += documents.len();
        counts.insert(uid.clone(), versions.len());
        append(&mut builder, &format!("entries/{}.jsonl", file_name(&uid)), &lines)?;
    }

    let manifest = Manifest {
        format: FORMAT.into(),
        version: VERSION,
        verdin: env!("CARGO_PKG_VERSION").into(),
        created_at: verdin_db::value::format_datetime(time::OffsetDateTime::now_utc()),
        entries: counts,
        files: summary.files,
    };
    append(&mut builder, "manifest.json", serde_json::to_string_pretty(&manifest)?.as_bytes())?;
    builder.into_inner()?.finish()?.flush()?;
    Ok(summary)
}

fn walkdir(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    if !dir.exists() {
        return Ok(found);
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in
            std::fs::read_dir(&current).with_context(|| format!("reading {}", current.display()))?
        {
            let path = entry?.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "json") {
                found.push(path);
            }
        }
    }
    found.sort();
    Ok(found)
}

fn parse_at(value: &Option<String>) -> Option<time::OffsetDateTime> {
    value.as_deref().and_then(|at| {
        time::OffsetDateTime::parse(at, &time::format_description::well_known::Rfc3339).ok()
    })
}

/// Restores an export into this project: its schema files (refused over existing ones
/// unless `force`), then, after migrating, locales, folders, files and entries (refused
/// into types that already have entries unless `force`).
pub async fn import(
    archive: &Path,
    schema_dir: &Path,
    db: &Database,
    upload: &UploadService,
    force: bool,
) -> Result<Summary> {
    let dir = tempfile::tempdir().context("creating a temporary directory")?;
    let file =
        std::fs::File::open(archive).with_context(|| format!("opening {}", archive.display()))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    for entry in tar.entries().context("reading the archive")? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if path.components().any(|part| !matches!(part, std::path::Component::Normal(_))) {
            bail!("unsafe path in the archive: {}", path.display());
        }
        entry.unpack_in(dir.path())?;
    }
    let root = dir.path();
    let manifest: Manifest = serde_json::from_slice(
        &std::fs::read(root.join("manifest.json")).context("the archive has no manifest.json")?,
    )
    .context("reading manifest.json")?;
    if manifest.format != FORMAT || manifest.version > VERSION {
        bail!("not a Verdin export (or from a newer version: {})", manifest.verdin);
    }

    // Schema files.
    let exported_schema = root.join("schema");
    let files = walkdir(&exported_schema)?;
    for path in &files {
        let relative = path.strip_prefix(&exported_schema).expect("inside");
        let target = schema_dir.join(relative);
        if target.exists() && !force && std::fs::read(&target)? != std::fs::read(path)? {
            bail!("{} already exists and differs (use --force to overwrite)", target.display());
        }
    }
    for path in &files {
        let target = schema_dir.join(path.strip_prefix(&exported_schema).expect("inside"));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(path, &target).with_context(|| format!("writing {}", target.display()))?;
    }
    let schema = Schema::load_dir(schema_dir).map_err(|errors| anyhow::anyhow!("{errors}"))?;
    verdin_migrate::apply(
        db,
        &verdin_migrate::derive_model(&schema),
        &Renames::default(),
        ApplyOptions { allow: Risk::Safe },
    )
    .await
    .context("migrating the database to the exported schema")?;
    let registry = Registry::new(schema.clone());
    if !force {
        for uid in manifest.entries.keys() {
            let table = registry.get(uid)?.table().to_owned();
            if db
                .queries()
                .has_rows(&format!("SELECT 1 FROM {} LIMIT 1", db.flavor().quote(&table)), &[])
                .await?
            {
                bail!("{uid} already has entries (use --force to import anyway)");
            }
        }
    }
    let mut summary = Summary::default();

    // Locales: a new project takes the export's (default included); otherwise the
    // missing ones are added.
    let fresh = !db.queries().has_rows(&format!("SELECT 1 FROM {LOCALES}"), &[]).await?;
    let existing = if fresh {
        verdin_content::locales::LocaleSet { locales: Vec::new(), default: String::new() }
    } else {
        verdin_api::i18n::load_locales(db).await?
    };
    let locales: Value = serde_json::from_slice(&std::fs::read(root.join("locales.json"))?)?;
    let default = locales["default"].as_str().unwrap_or_default().to_owned();
    let now = verdin_db::value::truncate_millis(time::OffsetDateTime::now_utc());
    for locale in locales["locales"].as_array().into_iter().flatten() {
        let (Some(code), Some(name)) = (locale["code"].as_str(), locale["name"].as_str()) else {
            continue;
        };
        if !verdin_content::locales::valid_code(code)
            || existing.locales.iter().any(|l| l.code == code)
        {
            continue;
        }
        db.queries()
            .execute(
                &format!("INSERT INTO {LOCALES} (code, name, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"),
                &[
                    V::Text(code.into()),
                    V::Text(name.into()),
                    V::Bool(fresh && code == default),
                    V::DateTime(now),
                    V::DateTime(now),
                ],
            )
            .await?;
        summary.locales += 1;
    }
    let locales = verdin_content::locales::Locales::new(verdin_api::i18n::load_locales(db).await?);
    let service =
        DocumentService::new(db.clone(), registry, Default::default()).with_locales(locales);

    // Folders, parents first.
    let mut folder_ids: HashMap<i64, i64> = HashMap::new();
    if let Ok(bytes) = std::fs::read(root.join("folders.json")) {
        let mut folders: Vec<ExportedFolder> = serde_json::from_slice(&bytes)?;
        folders.sort_by_key(|folder| folder.path.matches('/').count());
        for folder in folders {
            let parent = folder.parent.and_then(|parent| folder_ids.get(&parent).copied());
            let id =
                upload.import_folder(&folder.name, folder.path_id, &folder.path, parent).await?;
            folder_ids.insert(folder.id, id);
            summary.folders += 1;
        }
    }

    // Files with their objects.
    let mut file_ids: HashMap<i64, i64> = HashMap::new();
    if let Ok(handle) = std::fs::File::open(root.join("files.jsonl")) {
        for line in BufReader::new(handle).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let file: ExportedFile = serde_json::from_str(&line).context("reading files.jsonl")?;
            let objects = file
                .keys()
                .into_iter()
                .filter(|key| safe_key(key) && root.join("assets").join(key).exists())
                .map(|key| verdin_upload::ImportedObject {
                    path: root.join("assets").join(&key),
                    mime: file.mime.clone(),
                    key,
                })
                .collect();
            let old = file.id;
            let record = upload
                .import_file(verdin_upload::ImportedFile {
                    document_id: file.document_id,
                    name: file.name,
                    alternative_text: file.alternative_text,
                    caption: file.caption,
                    width: file.width,
                    height: file.height,
                    focal_point: file.focal_point,
                    formats: file.formats.and_then(|formats| formats.as_object().cloned()),
                    hash: file.hash,
                    ext: file.ext,
                    mime: file.mime,
                    size: file.size,
                    folder_id: file.folder_id.and_then(|id| folder_ids.get(&id).copied()),
                    folder_path: file.folder_path,
                    created_at: parse_at(&file.created_at),
                    updated_at: parse_at(&file.updated_at),
                    objects,
                })
                .await?;
            file_ids.insert(old, record.id);
            summary.files += 1;
        }
    }

    // Entries: versions first, then their links (targets may come later in the file).
    let mut rows: Vec<(String, i64, ExportedVersion)> = Vec::new();
    for uid in manifest.entries.keys() {
        let path = root.join("entries").join(format!("{}.jsonl", file_name(uid)));
        let Ok(handle) = std::fs::File::open(&path) else { continue };
        let model = service.registry().get(uid)?;
        let mut documents = std::collections::HashSet::new();
        let mut reader = BufReader::new(handle);
        let mut text = String::new();
        reader.read_to_string(&mut text)?;
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let mut version: ExportedVersion = serde_json::from_str(line)
                .with_context(|| format!("reading {}", path.display()))?;
            verdin_content::remap_component_files(
                &schema,
                &model.content_type.attributes,
                &mut version.data,
                &file_ids,
            );
            let data = Value::Object(version.data.clone());
            let row = service
                .import_version(
                    uid,
                    &ImportedVersion {
                        document_id: &version.document_id,
                        locale: &version.locale,
                        published: version.published,
                        created_at: parse_at(&version.created_at),
                        updated_at: parse_at(&version.updated_at),
                        published_at: parse_at(&version.published_at),
                        data: &data,
                    },
                )
                .await
                .with_context(|| format!("{uid} {}", version.document_id))?;
            documents.insert(version.document_id.clone());
            summary.versions += 1;
            rows.push((uid.clone(), row, version));
        }
        summary.documents += documents.len();
    }
    for (uid, row, version) in &rows {
        for (field, targets) in &version.relations {
            let targets: Vec<String> = targets
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|id| id.as_str().map(str::to_owned))
                .collect();
            service.import_links(uid, field, *row, &targets).await?;
        }
        for (field, items) in &version.morph {
            let targets: Vec<(String, String)> = items
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    Some((
                        item["__type"].as_str()?.to_owned(),
                        item["documentId"].as_str()?.to_owned(),
                    ))
                })
                .collect();
            service.import_morph_links(uid, field, *row, &targets).await?;
        }
        for (field, files) in &version.media {
            let files: Vec<i64> = files
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|id| id.as_i64().and_then(|id| file_ids.get(&id).copied()))
                .collect();
            service.import_media(uid, field, *row, &files).await?;
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use verdin_content::WriteOptions;
    use verdin_query::{PageMode, Pagination, Populate, Query, Status};

    use super::*;

    struct Project {
        _dir: tempfile::TempDir,
        db: Database,
        upload: UploadService,
        schema_dir: PathBuf,
    }

    async fn project() -> Project {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::connect(
            &format!("sqlite://{}?mode=rwc", dir.path().join("data.db").display()),
            &Default::default(),
        )
        .await
        .unwrap();
        let storage =
            verdin_upload::Storage::new(&verdin_upload::ProviderConfig::default(), dir.path())
                .unwrap();
        let upload = UploadService::new(db.clone(), storage, Default::default());
        let schema_dir = dir.path().join("schema");
        Project { _dir: dir, db, upload, schema_dir }
    }

    fn write(dir: &Path, path: &str, value: Value) {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value.to_string()).unwrap();
    }

    fn query(status: Status) -> Query {
        Query {
            filters: None,
            sort: vec![verdin_query::Sort::by("title", false)],
            fields: None,
            populate: ["tags", "cover", "seo", "refs"]
                .iter()
                .map(|field| Populate { field: (*field).into(), query: None })
                .collect(),
            pagination: Pagination {
                mode: PageMode::Offset { start: 0, limit: 100 },
                with_count: false,
            },
            status,
            search: None,
            denied: Vec::new(),
        }
    }

    async fn service(project: &Project) -> DocumentService {
        let schema = Schema::load_dir(&project.schema_dir).unwrap();
        let locales = verdin_api::i18n::load_locales(&project.db).await.unwrap();
        DocumentService::new(project.db.clone(), Registry::new(schema), Default::default())
            .with_locales(verdin_content::locales::Locales::new(locales))
    }

    #[tokio::test]
    async fn export_and_import_round_trip() {
        let source = project().await;
        let localized = json!({ "i18n": { "localized": true } });
        write(
            &source.schema_dir,
            "content-types/article.json",
            json!({
                "kind": "collectionType", "singularName": "article", "pluralName": "articles", "displayName": "Article",
                "options": { "draftAndPublish": true }, "pluginOptions": localized,
                "attributes": {
                    "title": { "type": "string" },
                    "pin": { "type": "password" },
                    "tags": { "type": "relation", "relation": "manyToMany", "target": "api::tag.tag" },
                    "cover": { "type": "media" },
                    "seo": { "type": "component", "component": "shared.seo" },
                    "refs": { "type": "relation", "relation": "morphToMany" }
                }
            }),
        );
        write(
            &source.schema_dir,
            "content-types/tag.json",
            json!({
                "kind": "collectionType", "singularName": "tag", "pluralName": "tags", "displayName": "Tag",
                "attributes": { "label": { "type": "string" } }
            }),
        );
        write(
            &source.schema_dir,
            "components/shared/seo.json",
            json!({
                "displayName": "SEO", "attributes": { "image": { "type": "media" }, "related": { "type": "relation", "relation": "oneWay", "target": "api::tag.tag" } }
            }),
        );
        let schema = Schema::load_dir(&source.schema_dir).unwrap();
        verdin_migrate::apply(
            &source.db,
            &verdin_migrate::derive_model(&schema),
            &Renames::default(),
            ApplyOptions::default(),
        )
        .await
        .unwrap();
        verdin_api::i18n::load_locales(&source.db).await.unwrap();
        source
            .db
            .queries()
            .execute(
                &format!("INSERT INTO {LOCALES} (code, name, is_default, created_at, updated_at) VALUES ('fr', 'Français', false, ?, ?)"),
                &[V::DateTime(time::OffsetDateTime::now_utc()), V::DateTime(time::OffsetDateTime::now_utc())],
            )
            .await
            .unwrap();
        let service = service(&source).await;

        // Files: one in a folder.
        let folder = source.upload.create_folder("Photos", None, None).await.unwrap();
        // A 1×1 PNG.
        const PNG: &[u8] = &[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99,
            0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        let png = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(png.path(), PNG).unwrap();
        let incoming = || verdin_upload::IncomingFile {
            path: png.path().to_owned(),
            name: "sea.png".into(),
            size: std::fs::metadata(png.path()).unwrap().len(),
        };
        let info = verdin_upload::FileInfo { folder: Some(Some(folder.id)), ..Default::default() };
        let photo = source.upload.upload(incoming(), info, None).await.unwrap();
        let other = source.upload.upload(incoming(), Default::default(), None).await.unwrap();

        let publish = WriteOptions { publish: true, actor: None };
        let tag = service.create("api::tag", &json!({ "label": "rust" }), publish).await.unwrap();
        let data = json!({ "title": "Hello", "pin": "1234", "tags": [tag], "cover": photo.id,
                           "seo": { "image": other.id, "related": tag },
                           "refs": [{ "__type": "api::tag", "documentId": tag }] });
        let hello = service.create("api::article", &data, publish).await.unwrap();
        service
            .update(
                "api::article",
                &hello,
                &json!({ "title": "Hello (draft)" }),
                WriteOptions { publish: false, actor: None },
            )
            .await
            .unwrap();
        service
            .in_locale(Some("fr".into()))
            .update("api::article", &hello, &json!({ "title": "Bonjour" }), publish)
            .await
            .unwrap();

        let archive = source._dir.path().join("backup.tar.gz");
        let exported =
            export(&source.schema_dir, &source.db, &source.upload, &archive, true).await.unwrap();
        assert_eq!((exported.files, exported.folders), (2, 1));

        let target = project().await;
        let imported =
            import(&archive, &target.schema_dir, &target.db, &target.upload, false).await.unwrap();
        assert_eq!(imported.versions, exported.versions);
        assert_eq!(imported.documents, exported.documents);
        assert_eq!(imported.locales, 2, "en (the default) and fr");
        let restored = service_after_import(&target).await;

        for (status, locale) in
            [(Status::Published, None), (Status::Draft, None), (Status::Published, Some("fr"))]
        {
            let before = service
                .in_locale(locale.map(Into::into))
                .find_many("api::article", &query(status))
                .await
                .unwrap();
            let after = restored
                .in_locale(locale.map(Into::into))
                .find_many("api::article", &query(status))
                .await
                .unwrap();
            let strip = |documents: Vec<Value>| -> Vec<Value> {
                documents
                    .into_iter()
                    .map(|mut document| {
                        // Row and file ids are renumbered; everything else must match.
                        for (key, value) in document.as_object_mut().unwrap().iter_mut() {
                            if key == "id" {
                                *value = Value::Null;
                            }
                        }
                        without_ids(&mut document);
                        document
                    })
                    .collect()
            };
            assert_eq!(strip(after.documents), strip(before.documents), "{status:?} {locale:?}");
        }
        // Password hashes survive (not re-hashed).
        let hash = |db: &Database| {
            let db = db.clone();
            async move {
                db.queries()
                    .fetch_all(
                        "SELECT pin FROM articles WHERE pin IS NOT NULL ORDER BY id LIMIT 1",
                        &[],
                        &[verdin_db::ColumnKind::Text],
                    )
                    .await
                    .unwrap()[0][0]
                    .clone()
            }
        };
        assert_eq!(hash(&source.db).await, hash(&target.db).await);

        // Importing again is refused without --force.
        assert!(
            import(&archive, &target.schema_dir, &target.db, &target.upload, false).await.is_err()
        );
    }

    async fn service_after_import(project: &Project) -> DocumentService {
        service(project).await
    }

    /// Blanks numeric `id`s at any depth (rows and files are renumbered on import).
    fn without_ids(value: &mut Value) {
        match value {
            Value::Object(map) => {
                for (key, value) in map.iter_mut() {
                    if key == "id" && value.is_number() {
                        *value = Value::Null;
                    } else {
                        without_ids(value);
                    }
                }
            }
            Value::Array(items) => items.iter_mut().for_each(without_ids),
            _ => {}
        }
    }
}
