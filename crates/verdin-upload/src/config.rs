use std::path::PathBuf;

use serde::Deserialize;

/// `[upload]` in `verdin.toml`.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct UploadConfig {
    pub provider: ProviderConfig,
    /// Largest accepted file, in bytes.
    pub max_file_size: u64,
    /// Generate responsive formats for raster images.
    pub responsive_formats: bool,
    /// Formats wider than the image are skipped (Strapi's `breakpoints`).
    pub breakpoints: Vec<Breakpoint>,
    /// Decoding limit against decompression bombs, in megapixels.
    pub max_image_megapixels: u32,
}

impl Default for UploadConfig {
    fn default() -> Self {
        Self {
            provider: ProviderConfig::default(),
            max_file_size: 200 * 1024 * 1024,
            responsive_formats: true,
            breakpoints: vec![
                Breakpoint { name: "large".into(), width: 1000 },
                Breakpoint { name: "medium".into(), width: 750 },
                Breakpoint { name: "small".into(), width: 500 },
            ],
            max_image_megapixels: 100,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Breakpoint {
    pub name: String,
    pub width: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "name", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ProviderConfig {
    /// Files under `dir` (relative to the project), served by Verdin at `/uploads`.
    Local {
        #[serde(default = "default_dir")]
        dir: PathBuf,
    },
    /// Any S3-compatible service (AWS, Cloudflare R2, MinIO, Backblaze B2…). Credentials
    /// come from the standard `AWS_*` environment variables.
    S3 {
        bucket: String,
        region: Option<String>,
        /// Custom endpoint for non-AWS services, e.g. `https://<account>.r2.cloudflarestorage.com`.
        endpoint: Option<String>,
        /// Public base URL of the bucket or its CDN; files are linked as `{public_url}/{key}`.
        public_url: String,
        /// Key prefix inside the bucket.
        #[serde(default)]
        prefix: String,
        /// Path-style requests (MinIO and most self-hosted services).
        #[serde(default)]
        path_style: bool,
    },
}

fn default_dir() -> PathBuf {
    PathBuf::from("public/uploads")
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self::Local { dir: default_dir() }
    }
}
