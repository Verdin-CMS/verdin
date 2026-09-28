//! Image transformations for `/uploads/…?w=&h=&fit=&format=&q=` and `?preset=`: parsing
//! and signing the parameters, and rendering (focal-point aware crops).

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use hmac::{Hmac, KeyInit, Mac};
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// `[upload.transforms]` in `verdin.toml`.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TransformConfig {
    pub enabled: bool,
    /// Named transformations, always allowed: `?preset=thumb`.
    pub presets: BTreeMap<String, Transform>,
    /// Accept any `w`/`h`/`fit`/`format`/`q` without a signature. Every distinct URL is
    /// rendered and cached, so only for trusted networks.
    pub allow_arbitrary: bool,
    /// Largest output side, in pixels.
    pub max_size: u32,
    /// Rendered images, relative to the project (safe to delete at any time).
    pub cache_dir: PathBuf,
}

impl Default for TransformConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            presets: BTreeMap::new(),
            allow_arbitrary: false,
            max_size: 4096,
            cache_dir: PathBuf::from(".cache/transforms"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    /// Fill the box, cropping around the focal point.
    #[default]
    Cover,
    /// Fit inside the box, keeping the aspect ratio.
    Inside,
    /// Stretch to the box.
    Fill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Jpeg,
    Png,
    Webp,
}

impl OutputFormat {
    pub fn mime(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }

    fn of(format: ImageFormat) -> Self {
        match format {
            ImageFormat::Png => Self::Png,
            ImageFormat::WebP => Self::Webp,
            _ => Self::Jpeg,
        }
    }
}

/// One transformation. Without `w` and `h` the image keeps its size (a format change).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transform {
    pub w: Option<u32>,
    pub h: Option<u32>,
    #[serde(default)]
    pub fit: Fit,
    pub format: Option<OutputFormat>,
    /// JPEG quality, 1–100 (WebP output is lossless).
    pub q: Option<u8>,
}

/// Why a transformation request is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// Bad or unknown parameters.
    Invalid(String),
    /// Arbitrary parameters without a valid signature.
    Unsigned,
}

/// Query parameters that ask for a transformation.
pub const PARAMS: &[&str] = &["w", "h", "fit", "format", "q", "preset", "s"];

impl Transform {
    /// The canonical query (sorted, defaults dropped), which signatures cover.
    pub fn canonical(&self) -> String {
        let mut out = String::new();
        let mut add = |key: &str, value: String| {
            if !out.is_empty() {
                out.push('&');
            }
            let _ = write!(out, "{key}={value}");
        };
        if self.fit != Fit::Cover {
            add("fit", format!("{:?}", self.fit).to_lowercase());
        }
        if let Some(format) = self.format {
            add("format", format.extension().replace("jpg", "jpeg"));
        }
        if let Some(h) = self.h {
            add("h", h.to_string());
        }
        if let Some(q) = self.q {
            add("q", q.to_string());
        }
        if let Some(w) = self.w {
            add("w", w.to_string());
        }
        out
    }

    fn check(&self, max_size: u32) -> Result<(), Refusal> {
        for side in [self.w, self.h].into_iter().flatten() {
            if side == 0 || side > max_size {
                return Err(Refusal::Invalid(format!("sizes go from 1 to {max_size}")));
            }
        }
        if self.q.is_some_and(|q| q == 0 || q > 100) {
            return Err(Refusal::Invalid("q goes from 1 to 100".into()));
        }
        Ok(())
    }
}

/// The transformation `query` asks for on `path` (the file's name under `/uploads`), or
/// `None` when it asks for none.
pub fn requested(
    config: &TransformConfig,
    secret: Option<&str>,
    path: &str,
    query: &[(String, String)],
) -> Option<Result<Transform, Refusal>> {
    if !query.iter().any(|(key, _)| PARAMS.contains(&key.as_str())) {
        return None;
    }
    Some(parse(config, secret, path, query))
}

fn parse(
    config: &TransformConfig,
    secret: Option<&str>,
    path: &str,
    query: &[(String, String)],
) -> Result<Transform, Refusal> {
    let get = |key: &str| query.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str());
    if let Some(name) = get("preset") {
        if query.iter().any(|(key, _)| key != "preset" && PARAMS.contains(&key.as_str())) {
            return Err(Refusal::Invalid("preset cannot be combined with other parameters".into()));
        }
        return config
            .presets
            .get(name)
            .cloned()
            .ok_or_else(|| Refusal::Invalid(format!("unknown preset `{name}`")));
    }
    let number = |key: &str| -> Result<Option<u32>, Refusal> {
        get(key)
            .map(|value| {
                value.parse().map_err(|_| Refusal::Invalid(format!("{key} must be a number")))
            })
            .transpose()
    };
    let transform = Transform {
        w: number("w")?,
        h: number("h")?,
        fit: match get("fit") {
            None | Some("cover") => Fit::Cover,
            Some("inside") => Fit::Inside,
            Some("fill") => Fit::Fill,
            Some(other) => return Err(Refusal::Invalid(format!("unknown fit `{other}`"))),
        },
        format: match get("format") {
            None => None,
            Some("jpeg" | "jpg") => Some(OutputFormat::Jpeg),
            Some("png") => Some(OutputFormat::Png),
            Some("webp") => Some(OutputFormat::Webp),
            Some(other) => return Err(Refusal::Invalid(format!("unknown format `{other}`"))),
        },
        q: number("q")?.map(|q| q.min(255) as u8),
    };
    transform.check(config.max_size)?;
    if config.allow_arbitrary {
        return Ok(transform);
    }
    let signed = match (secret, get("s")) {
        (Some(secret), Some(given)) => {
            // `verify_slice` compares in constant time.
            hex_decode(given).is_some_and(|given| {
                mac(secret, path, &transform.canonical()).verify_slice(&given).is_ok()
            })
        }
        _ => false,
    };
    if signed { Ok(transform) } else { Err(Refusal::Unsigned) }
}

type HmacSha256 = Hmac<Sha256>;

fn mac(secret: &str, path: &str, canonical: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC takes any key");
    mac.update(path.trim_start_matches('/').as_bytes());
    mac.update(b"?");
    mac.update(canonical.as_bytes());
    mac
}

/// The `s` parameter for `path` (e.g. `photo_1a2b.jpg`) and `transform`: hex HMAC-SHA256
/// of `path?canonical`.
pub fn sign(secret: &str, path: &str, transform: &Transform) -> String {
    let bytes = mac(secret, path, &transform.canonical()).finalize().into_bytes();
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_decode(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok()).collect()
}

/// Where the rendering of `transform` for the file named `name` is cached: one directory
/// per file (`{stem}/`), dropped when the file changes.
pub fn cache_path(cache_dir: &Path, name: &str, transform: &Transform) -> PathBuf {
    let format = output_format(name, transform);
    let digest = Sha256::digest(transform.canonical().as_bytes());
    let digest: String = digest.iter().take(12).map(|byte| format!("{byte:02x}")).collect();
    cache_dir.join(stem(name)).join(format!("{digest}.{}", format.extension()))
}

/// Raster formats that can be transformed, by file name (GIFs may be animated).
pub fn transformable(name: &str) -> bool {
    source_format(name).is_some()
}

fn source_format(name: &str) -> Option<ImageFormat> {
    let (_, extension) = name.rsplit_once('.')?;
    Some(match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "webp" => ImageFormat::WebP,
        "tif" | "tiff" => ImageFormat::Tiff,
        "bmp" => ImageFormat::Bmp,
        _ => return None,
    })
}

/// What a transformation of the file named `name` is encoded as.
pub fn output_format(name: &str, transform: &Transform) -> OutputFormat {
    transform.format.unwrap_or(OutputFormat::of(source_format(name).unwrap_or(ImageFormat::Jpeg)))
}

/// The file's hash (its name without extension).
pub fn stem(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// Renders `transform` of the image at `path`. `focal` is the focal point (fractions of
/// the width and height) that cover crops keep in view. Blocking.
pub fn render(
    path: &Path,
    transform: &Transform,
    focal: Option<(f64, f64)>,
    max_megapixels: u32,
) -> Option<(Vec<u8>, OutputFormat)> {
    let source = source_format(&path.file_name()?.to_string_lossy())?;
    let mut reader = ImageReader::open(path).ok()?;
    reader.set_format(source);
    let mut limits = Limits::default();
    limits.max_alloc = Some(u64::from(max_megapixels) * 1_000_000 * 8);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().ok()?;
    let orientation = decoder.orientation().ok();
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > u64::from(max_megapixels) * 1_000_000 {
        return None;
    }
    let mut image = DynamicImage::from_decoder(decoder).ok()?;
    if let Some(orientation) = orientation {
        image.apply_orientation(orientation);
    }
    let image = resize(image, transform, focal);
    let format = transform.format.unwrap_or(OutputFormat::of(source));
    let mut out = Cursor::new(Vec::new());
    match format {
        OutputFormat::Jpeg => {
            let quality = transform.q.unwrap_or(80);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
            image.to_rgb8().write_with_encoder(encoder).ok()?;
        }
        OutputFormat::Png => image.write_to(&mut out, ImageFormat::Png).ok()?,
        OutputFormat::Webp => {
            DynamicImage::ImageRgba8(image.to_rgba8()).write_to(&mut out, ImageFormat::WebP).ok()?
        }
    }
    Some((out.into_inner(), format))
}

/// Images are never enlarged.
fn resize(image: DynamicImage, transform: &Transform, focal: Option<(f64, f64)>) -> DynamicImage {
    let (width, height) = (image.width(), image.height());
    let (w, h) = match (transform.w, transform.h) {
        (None, None) => return image,
        (Some(w), None) => return image.resize(w.min(width), u32::MAX, FilterType::Lanczos3),
        (None, Some(h)) => return image.resize(u32::MAX, h.min(height), FilterType::Lanczos3),
        (Some(w), Some(h)) => (w, h),
    };
    match transform.fit {
        Fit::Inside => image.resize(w.min(width), h.min(height), FilterType::Lanczos3),
        Fit::Fill => image.resize_exact(w.min(width), h.min(height), FilterType::Lanczos3),
        Fit::Cover => {
            // The largest window of the box's aspect ratio, centred on the focal point.
            let scale = (f64::from(w) / f64::from(width)).max(f64::from(h) / f64::from(height));
            let crop_w = (f64::from(w) / scale).round().clamp(1.0, f64::from(width)) as u32;
            let crop_h = (f64::from(h) / scale).round().clamp(1.0, f64::from(height)) as u32;
            let (fx, fy) = focal.unwrap_or((0.5, 0.5));
            let x = (fx * f64::from(width) - f64::from(crop_w) / 2.0)
                .clamp(0.0, f64::from(width - crop_w)) as u32;
            let y = (fy * f64::from(height) - f64::from(crop_h) / 2.0)
                .clamp(0.0, f64::from(height - crop_h)) as u32;
            let cropped = image.crop_imm(x, y, crop_w, crop_h);
            if scale >= 1.0 { cropped } else { cropped.resize_exact(w, h, FilterType::Lanczos3) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn presets_signatures_and_limits() {
        let mut config = TransformConfig::default();
        config
            .presets
            .insert("thumb".into(), Transform { w: Some(100), h: Some(100), ..Default::default() });
        let ask = |config: &TransformConfig, pairs: &[(&str, &str)]| {
            requested(config, Some("secret"), "a.png", &query(pairs))
        };
        assert_eq!(ask(&config, &[("v", "1")]), None, "no transformation asked");
        assert_eq!(ask(&config, &[("preset", "thumb")]).unwrap().unwrap().w, Some(100));
        assert!(matches!(ask(&config, &[("preset", "nope")]), Some(Err(Refusal::Invalid(_)))));
        assert!(matches!(
            ask(&config, &[("preset", "thumb"), ("w", "5")]),
            Some(Err(Refusal::Invalid(_)))
        ));
        assert_eq!(ask(&config, &[("w", "300")]), Some(Err(Refusal::Unsigned)));

        let transform =
            Transform { w: Some(300), format: Some(OutputFormat::Webp), ..Default::default() };
        assert_eq!(transform.canonical(), "format=webp&w=300");
        let s = sign("secret", "a.png", &transform);
        assert_eq!(
            ask(&config, &[("format", "webp"), ("w", "300"), ("s", &s)]),
            Some(Ok(transform.clone()))
        );
        assert_eq!(ask(&config, &[("w", "300"), ("s", &s)]), Some(Err(Refusal::Unsigned)));
        assert_eq!(
            requested(
                &config,
                Some("secret"),
                "b.png",
                &query(&[("format", "webp"), ("w", "300"), ("s", &s)])
            ),
            Some(Err(Refusal::Unsigned)),
            "signatures are per file"
        );
        assert!(matches!(ask(&config, &[("w", "99999")]), Some(Err(Refusal::Invalid(_)))));
        config.allow_arbitrary = true;
        assert!(matches!(ask(&config, &[("w", "300")]), Some(Ok(_))));
        assert!(matches!(ask(&config, &[("fit", "zoom")]), Some(Err(Refusal::Invalid(_)))));
    }

    #[test]
    fn covers_around_the_focal_point() {
        // Left half black, right half white.
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_fn(200, 100, |x, _| {
            if x < 100 { image::Rgb([0, 0, 0]) } else { image::Rgb([255, 255, 255]) }
        }));
        let square = Transform { w: Some(50), h: Some(50), ..Default::default() };
        let left = resize(image.clone(), &square, Some((0.0, 0.5)));
        assert_eq!((left.width(), left.height()), (50, 50));
        assert_eq!(left.to_rgb8().get_pixel(25, 25).0, [0, 0, 0]);
        let right = resize(image.clone(), &square, Some((1.0, 0.5)));
        assert_eq!(right.to_rgb8().get_pixel(25, 25).0, [255, 255, 255]);

        let inside = Transform { w: Some(50), h: Some(50), fit: Fit::Inside, ..Default::default() };
        let inside = resize(image.clone(), &inside, None);
        assert_eq!((inside.width(), inside.height()), (50, 25));
        let larger = Transform { w: Some(400), ..Default::default() };
        assert_eq!(resize(image.clone(), &larger, None).width(), 200, "never enlarged");
        let big_box = Transform { w: Some(400), h: Some(400), ..Default::default() };
        let big = resize(image, &big_box, None);
        assert_eq!((big.width(), big.height()), (100, 100), "the box's shape, not enlarged");
    }
}
