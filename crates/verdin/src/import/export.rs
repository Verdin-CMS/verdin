//! Reading a `strapi export` (Strapi's data transfer format): a directory, `.tar` or
//! `.tar.gz` holding `metadata.json`, `schemas/`, `entities/`, `links/` and `assets/`.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::{Map, Value as Json};

/// One database row of a content type (`{ type, id, data }`).
#[derive(Debug, Clone, Deserialize)]
pub struct Entity {
    #[serde(rename = "type")]
    pub uid: String,
    pub id: i64,
    #[serde(default)]
    pub data: Map<String, Json>,
}

/// One side of a link.
#[derive(Debug, Clone, Deserialize)]
pub struct End {
    #[serde(rename = "type")]
    pub uid: String,
    /// A row id (or, for joins on `document_id`, a document id).
    #[serde(rename = "ref")]
    pub reference: Json,
    pub field: Option<String>,
    pub pos: Option<f64>,
}

impl End {
    pub fn row(&self) -> Option<i64> {
        self.reference.as_i64().or_else(|| self.reference.as_str()?.parse().ok())
    }
}

/// A relation between two rows (`relation.basic`, `relation.circular`, `relation.morph`).
#[derive(Debug, Clone, Deserialize)]
pub struct Link {
    pub kind: String,
    pub relation: String,
    pub left: End,
    pub right: End,
}

pub struct Export {
    pub root: PathBuf,
    /// Keeps an extracted archive alive.
    _extracted: Option<tempfile::TempDir>,
    pub strapi_version: Option<String>,
    pub schemas: Vec<Json>,
    pub entities: Vec<Entity>,
    pub links: Vec<Link>,
}

impl Export {
    /// Opens an export directory or archive.
    pub fn open(path: &Path) -> Result<Self> {
        let (root, extracted) = if path.is_dir() {
            (path.to_owned(), None)
        } else {
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
            if name.ends_with(".enc") {
                bail!(
                    "{name} is encrypted: export again with `strapi export --no-encrypt` \
                     (or decrypt it first)"
                );
            }
            let dir = tempfile::tempdir().context("creating a temporary directory")?;
            extract(path, dir.path())?;
            (dir.path().to_owned(), Some(dir))
        };
        if !root.join("metadata.json").exists() && !root.join("schemas").exists() {
            bail!(
                "{} does not look like a Strapi export (no metadata.json or schemas/)",
                path.display()
            );
        }
        let strapi_version = std::fs::read(root.join("metadata.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Json>(&bytes).ok())
            .and_then(|metadata| metadata["strapi"]["version"].as_str().map(str::to_owned));
        let schemas = read_jsonl(&root, "schemas")?;
        let entities = read_jsonl(&root, "entities")?;
        let links = read_jsonl(&root, "links")?;
        Ok(Self { root, _extracted: extracted, strapi_version, schemas, entities, links })
    }

    /// The Strapi major version (4 or 5): from `metadata.json`, else from whether rows
    /// carry `documentId`.
    pub fn major(&self) -> u32 {
        if let Some(major) = self
            .strapi_version
            .as_deref()
            .and_then(|version| version.split('.').next()?.parse().ok())
        {
            return major;
        }
        if self.entities.iter().any(|entity| entity.data.contains_key("documentId")) {
            5
        } else {
            4
        }
    }

    /// An uploaded file of the export (`assets/uploads/<name>`), if present.
    pub fn asset(&self, name: &str) -> Option<PathBuf> {
        if name.contains('/') || name.contains("..") {
            return None;
        }
        let path = self.root.join("assets").join("uploads").join(name);
        path.is_file().then_some(path)
    }
}

fn extract(archive: &Path, into: &Path) -> Result<()> {
    let mut file =
        std::fs::File::open(archive).with_context(|| format!("opening {}", archive.display()))?;
    let mut magic = [0u8; 2];
    file.read_exact(&mut magic).with_context(|| format!("reading {}", archive.display()))?;
    drop(file);
    let file = std::fs::File::open(archive)?;
    let reader: Box<dyn Read> = if magic == [0x1f, 0x8b] {
        Box::new(flate2::read::GzDecoder::new(file))
    } else {
        Box::new(file)
    };
    // `unpack` refuses entries that would land outside `into`.
    tar::Archive::new(reader)
        .unpack(into)
        .with_context(|| format!("extracting {}", archive.display()))
}

/// Every line of `<stage>/<stage>_NNNNN.jsonl`, in file order.
fn read_jsonl<T: serde::de::DeserializeOwned>(root: &Path, stage: &str) -> Result<Vec<T>> {
    let dir = root.join(stage);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();
    files.sort();
    let mut out = Vec::new();
    for file in files {
        let reader = BufReader::new(
            std::fs::File::open(&file).with_context(|| format!("opening {}", file.display()))?,
        );
        for (index, line) in reader.lines().enumerate() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            out.push(serde_json::from_str(&line).with_context(|| {
                format!("{}:{}: not a valid {stage} line", file.display(), index + 1)
            })?);
        }
    }
    Ok(out)
}
