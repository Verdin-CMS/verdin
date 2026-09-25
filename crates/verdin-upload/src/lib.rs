//! The media library (docs/architecture.md §8.7): files and folders in `vd_files` /
//! `vd_folders`, bytes in a storage provider (local directory or S3-compatible), and
//! responsive image formats generated on upload.

mod config;
mod image;
mod mime;
mod service;
mod storage;

pub use config::{Breakpoint, ProviderConfig, UploadConfig};
pub use mime::{detect_mime, is_inline_safe};
pub use service::import::{ImportedFile, ImportedObject};
pub use service::{
    FileInfo, FileList, FileQuery, FileSort, Folder, IncomingFile, UploadError, UploadService,
};
pub use storage::Storage;
pub use verdin_content::media::FileRecord;
