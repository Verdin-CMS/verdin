//! Where file bytes live: a local directory or an S3-compatible bucket, both through
//! `object_store`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use object_store::aws::AmazonS3Builder;
use object_store::buffered::BufWriter;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use object_store::{Attribute, Attributes, ObjectStore, ObjectStoreExt};
use tokio::io::AsyncWriteExt;

use crate::config::ProviderConfig;

/// Multipart chunk size for large uploads.
const PART_SIZE: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Storage {
    store: Arc<dyn ObjectStore>,
    /// `local` or `aws-s3` (Strapi's provider names).
    provider: &'static str,
    /// Files are linked as `{public_base}/{key}`.
    public_base: String,
    prefix: String,
    /// The local directory, for serving it (`None` for remote providers).
    local_dir: Option<PathBuf>,
}

impl Storage {
    /// `root` resolves relative local directories.
    pub fn new(config: &ProviderConfig, root: &Path) -> Result<Self, object_store::Error> {
        Ok(match config {
            ProviderConfig::Local { dir } => {
                let dir = root.join(dir);
                std::fs::create_dir_all(&dir).map_err(|error| object_store::Error::Generic {
                    store: "local",
                    source: Box::new(error),
                })?;
                Self {
                    store: Arc::new(LocalFileSystem::new_with_prefix(&dir)?),
                    provider: "local",
                    public_base: "/uploads".into(),
                    prefix: String::new(),
                    local_dir: Some(dir),
                }
            }
            ProviderConfig::S3 { bucket, region, endpoint, public_url, prefix, path_style } => {
                let mut builder = AmazonS3Builder::from_env().with_bucket_name(bucket);
                if let Some(region) = region {
                    builder = builder.with_region(region);
                }
                if let Some(endpoint) = endpoint {
                    builder = builder
                        .with_endpoint(endpoint)
                        .with_allow_http(endpoint.starts_with("http://"));
                }
                builder = builder.with_virtual_hosted_style_request(!path_style);
                Self {
                    store: Arc::new(builder.build()?),
                    provider: "aws-s3",
                    public_base: public_url.trim_end_matches('/').to_owned(),
                    prefix: prefix.trim_matches('/').to_owned(),
                    local_dir: None,
                }
            }
        })
    }

    /// Storage over any `object_store` (tests use the in-memory store).
    pub fn with_store(
        store: Arc<dyn ObjectStore>,
        provider: &'static str,
        public_base: &str,
    ) -> Self {
        Self {
            store,
            provider,
            public_base: public_base.trim_end_matches('/').to_owned(),
            prefix: String::new(),
            local_dir: None,
        }
    }

    pub fn provider(&self) -> &'static str {
        self.provider
    }

    /// `scheme://host[:port]` of a remote store's public URL (for the admin's CSP).
    pub fn public_origin(&self) -> Option<String> {
        if self.local_dir.is_some() {
            return None;
        }
        let (scheme, rest) = self.public_base.split_once("://")?;
        let host = rest.split('/').next().filter(|host| !host.is_empty())?;
        let safe = host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
        (matches!(scheme, "http" | "https") && safe).then(|| format!("{scheme}://{host}"))
    }

    pub fn local_dir(&self) -> Option<&Path> {
        self.local_dir.as_deref()
    }

    fn key(&self, name: &str) -> ObjectPath {
        if self.prefix.is_empty() {
            ObjectPath::from(name)
        } else {
            ObjectPath::from(format!("{}/{name}", self.prefix))
        }
    }

    /// Public URL of an object.
    pub fn url(&self, name: &str) -> String {
        let key = self.key(name);
        format!("{}/{key}", self.public_base)
    }

    /// Uploads a local file, streaming it in parts.
    pub async fn put_file(
        &self,
        name: &str,
        path: &Path,
        mime: &str,
    ) -> Result<(), object_store::Error> {
        let mut file = tokio::fs::File::open(path).await.map_err(io_error)?;
        let mut writer = BufWriter::with_capacity(self.store.clone(), self.key(name), PART_SIZE)
            .with_attributes(self.attributes(mime));
        tokio::io::copy(&mut file, &mut writer).await.map_err(io_error)?;
        writer.shutdown().await.map_err(io_error)?;
        Ok(())
    }

    pub async fn put_bytes(
        &self,
        name: &str,
        bytes: Vec<u8>,
        mime: &str,
    ) -> Result<(), object_store::Error> {
        let options =
            object_store::PutOptions { attributes: attributes(mime), ..Default::default() };
        self.store.put_opts(&self.key(name), bytes.into(), options).await?;
        Ok(())
    }

    /// Deletes an object; a missing object is not an error.
    pub async fn delete(&self, name: &str) -> Result<(), object_store::Error> {
        match self.store.delete(&self.key(name)).await {
            Ok(()) | Err(object_store::Error::NotFound { .. }) => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Object metadata for remote stores (the local filesystem store takes none: Verdin
    /// sets those headers when serving `/uploads`).
    fn attributes(&self, mime: &str) -> Attributes {
        if self.local_dir.is_some() { Attributes::new() } else { attributes(mime) }
    }

    pub async fn get(&self, name: &str) -> Result<bytes::Bytes, object_store::Error> {
        self.store.get(&self.key(name)).await?.bytes().await
    }
}

fn attributes(mime: &str) -> Attributes {
    let mut attributes = Attributes::new();
    attributes.insert(Attribute::ContentType, mime.to_owned().into());
    // Keys contain a random hash: they never change content.
    attributes.insert(Attribute::CacheControl, "public, max-age=31536000, immutable".into());
    // Buckets serve objects as they are: never let HTML or SVG run on their domain.
    if crate::mime::is_active(mime) {
        attributes.insert(Attribute::ContentDisposition, "attachment".into());
    }
    attributes
}

fn io_error(error: std::io::Error) -> object_store::Error {
    object_store::Error::Generic { store: "upload", source: Box::new(error) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_origins() {
        let store = Arc::new(object_store::memory::InMemory::new());
        let origin =
            |base: &str| Storage::with_store(store.clone(), "aws-s3", base).public_origin();
        assert_eq!(
            origin("https://cdn.example.com/media/"),
            Some("https://cdn.example.com".into())
        );
        assert_eq!(origin("http://localhost:9000/verdin"), Some("http://localhost:9000".into()));
        assert_eq!(origin("https://evil.com; script-src *"), None);
        assert_eq!(origin("/uploads"), None);
    }
}
