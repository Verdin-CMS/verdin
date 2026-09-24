//! Verdin content schema: parsing, validation and the in-memory model.
//!
//! Layout on disk:
//!
//! ```text
//! schema/
//! ├── content-types/<singularName>.json
//! └── components/<category>/<name>.json
//! ```
//!
//! `*.ui.json` files (admin layout metadata) are ignored here.

mod convert;
mod model;
pub mod naming;
mod raw;
mod validate;

use std::fmt;
use std::path::{Path, PathBuf};

pub use convert::{DEFAULT_DECIMAL_PRECISION, DEFAULT_DECIMAL_SCALE, VARCHAR_LENGTH};
pub use model::*;

/// One problem found while loading the schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaError {
    pub file: PathBuf,
    /// Location inside the file, e.g. `attributes.title.maxLength`. Empty for whole-file errors.
    pub path: String,
    pub message: String,
}

impl fmt::Display for SchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            write!(f, "{}: {}", self.file.display(), self.message)
        } else {
            write!(f, "{}: {}: {}", self.file.display(), self.path, self.message)
        }
    }
}

/// Every problem found while loading the schema (loading never stops at the first one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaErrors(pub Vec<SchemaError>);

impl fmt::Display for SchemaErrors {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "invalid schema ({} error{}):",
            self.0.len(),
            if self.0.len() == 1 { "" } else { "s" }
        )?;
        for error in &self.0 {
            writeln!(f, "  {error}")?;
        }
        Ok(())
    }
}

impl std::error::Error for SchemaErrors {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceKind {
    ContentType,
    Component { category: String },
}

/// A schema file's contents, decoupled from the filesystem.
#[derive(Debug, Clone)]
pub struct Source {
    pub path: PathBuf,
    pub kind: SourceKind,
    /// File stem: the content type's `singularName` or the component's name.
    pub name: String,
    pub text: String,
}

impl Source {
    pub fn content_type(name: &str, text: impl Into<String>) -> Self {
        Self {
            path: PathBuf::from(format!("content-types/{name}.json")),
            kind: SourceKind::ContentType,
            name: name.into(),
            text: text.into(),
        }
    }

    pub fn component(category: &str, name: &str, text: impl Into<String>) -> Self {
        Self {
            path: PathBuf::from(format!("components/{category}/{name}.json")),
            kind: SourceKind::Component { category: category.into() },
            name: name.into(),
            text: text.into(),
        }
    }
}

impl Schema {
    /// Loads every schema file under `root`. A missing directory is an empty schema.
    pub fn load_dir(root: &Path) -> Result<Self, SchemaErrors> {
        let mut sources = Vec::new();
        let mut errors = Vec::new();
        let mut read =
            |path: PathBuf, kind: SourceKind, name: String| match std::fs::read_to_string(&path) {
                Ok(text) => sources.push(Source { path, kind, name, text }),
                Err(error) => errors.push(SchemaError {
                    file: path,
                    path: String::new(),
                    message: format!("cannot read file: {error}"),
                }),
            };

        for (path, name) in json_files(&root.join("content-types")) {
            read(path, SourceKind::ContentType, name);
        }
        for category_dir in subdirectories(&root.join("components")) {
            let category = file_name(&category_dir);
            for (path, name) in json_files(&category_dir) {
                read(path, SourceKind::Component { category: category.clone() }, name);
            }
        }

        match Schema::parse(&sources) {
            Ok(schema) if errors.is_empty() => Ok(schema),
            Ok(_) => Err(SchemaErrors(errors)),
            Err(SchemaErrors(mut parse_errors)) => {
                errors.append(&mut parse_errors);
                Err(SchemaErrors(errors))
            }
        }
    }

    /// Parses and validates a set of sources.
    pub fn parse(sources: &[Source]) -> Result<Self, SchemaErrors> {
        validate::parse(sources)
    }

    pub fn content_type(&self, uid: &str) -> Option<&ContentType> {
        self.content_types.get(uid)
    }

    pub fn component(&self, uid: &str) -> Option<&Component> {
        self.components.get(uid)
    }
}

/// `(path, stem)` of every `*.json` (but not `*.ui.json`) file in `dir`, sorted.
fn json_files(dir: &Path) -> Vec<(PathBuf, String)> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter_map(|path| {
            let name = file_name(&path);
            let stem = name.strip_suffix(".json")?;
            (!stem.ends_with(".ui")).then(|| (path.clone(), stem.to_owned()))
        })
        .collect();
    files.sort();
    files
}

fn subdirectories(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut dirs: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}
