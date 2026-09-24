//! MIME types come from the file's bytes, not from the client.

use std::path::Path;

/// The file's MIME type: magic bytes first, then SVG sniffing, then the extension.
pub fn detect_mime(path: &Path, original_name: &str) -> String {
    if let Ok(Some(kind)) = infer::get_from_path(path) {
        let mime = kind.mime_type();
        if !(mime.ends_with("/xml") && looks_like_svg(path)) {
            return mime.to_owned();
        }
    }
    let extension = extension_of(original_name);
    if looks_like_svg(path) {
        return "image/svg+xml".into();
    }
    match mime_guess::from_ext(extension.trim_start_matches('.')).first() {
        // Never trust the name for types browsers render actively.
        Some(guess) if !is_active(guess.essence_str()) => guess.essence_str().to_owned(),
        _ => "application/octet-stream".into(),
    }
}

/// Lowercase extension with the dot (`.jpg`), or empty.
pub(crate) fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| ext.len() <= 16 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|ext| format!(".{}", ext.to_ascii_lowercase()))
        .unwrap_or_default()
}

fn looks_like_svg(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else { return false };
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
    let head = head.trim_start_matches('\u{feff}').trim_start();
    head.starts_with("<svg") || (head.starts_with("<?xml") && head.contains("<svg"))
}

/// Types a browser would render as a page (scripts included).
pub(crate) fn is_active(mime: &str) -> bool {
    matches!(mime, "text/html" | "application/xhtml+xml" | "image/svg+xml" | "text/xml")
}

/// Whether a file may be shown inline from the uploads origin. Anything else is served as
/// an attachment; SVG is inline but sandboxed by the server's CSP header.
pub fn is_inline_safe(mime: &str) -> bool {
    let top = mime.split('/').next().unwrap_or_default();
    matches!(top, "image" | "video" | "audio") || mime == "application/pdf" || mime == "text/plain"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detect(bytes: &[u8], name: &str) -> String {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), bytes).unwrap();
        detect_mime(file.path(), name)
    }

    #[test]
    fn trusts_bytes_over_names() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        assert_eq!(detect(&png, "photo.jpg"), "image/png");
        assert_eq!(detect(b"<?xml version=\"1.0\"?><svg/>", "x.txt"), "image/svg+xml");
        assert_eq!(detect(b"<html><script>", "page.html"), "text/html");
        assert_eq!(detect(b"plain words", "page.html"), "application/octet-stream");
        assert_eq!(detect(b"hello", "notes.txt"), "text/plain");
        assert_eq!(detect(b"a,b", "data.csv"), "text/csv");
        assert_eq!(extension_of("Photo.JPEG"), ".jpeg");
        assert_eq!(extension_of("weird.name.<script>"), "");
    }
}
