//! Raster image metadata and responsive formats (Strapi's `thumbnail`, `small`, `medium`,
//! `large`), generated off the async runtime.

use std::io::Cursor;
use std::path::Path;

use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

use crate::config::Breakpoint;

/// Strapi's thumbnail box.
const THUMBNAIL: (u32, u32) = (245, 156);
const JPEG_QUALITY: u8 = 80;

#[derive(Debug, Clone)]
pub(crate) struct Analysis {
    pub width: u32,
    pub height: u32,
    pub formats: Vec<Generated>,
}

#[derive(Debug, Clone)]
pub(crate) struct Generated {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

/// Formats we can decode and re-encode.
pub(crate) fn resizable(mime: &str) -> Option<ImageFormat> {
    Some(match mime {
        "image/jpeg" => ImageFormat::Jpeg,
        "image/png" => ImageFormat::Png,
        "image/webp" => ImageFormat::WebP,
        "image/tiff" => ImageFormat::Tiff,
        "image/bmp" => ImageFormat::Bmp,
        // GIFs may be animated: resizing would keep only the first frame.
        _ => return None,
    })
}

/// Dimensions of any decodable image, without decoding pixels.
pub(crate) fn dimensions(path: &Path) -> Option<(u32, u32)> {
    ImageReader::open(path).ok()?.with_guessed_format().ok()?.into_dimensions().ok()
}

/// Decodes the image (bounded by `max_megapixels`), honours its EXIF orientation and
/// renders every format smaller than the original.
pub(crate) fn analyse(
    path: &Path,
    format: ImageFormat,
    breakpoints: &[Breakpoint],
    max_megapixels: u32,
    responsive: bool,
) -> Option<Analysis> {
    let mut reader = ImageReader::open(path).ok()?;
    reader.set_format(format);
    let mut limits = Limits::default();
    let max_side = (u64::from(max_megapixels) * 1_000_000).isqrt().min(u64::from(u32::MAX));
    limits.max_image_width = Some(max_side as u32 * 4);
    limits.max_image_height = Some(max_side as u32 * 4);
    limits.max_alloc = Some(u64::from(max_megapixels) * 1_000_000 * 8);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().ok()?;
    let orientation = decoder.orientation().ok();
    let (raw_width, raw_height) = decoder.dimensions();
    if u64::from(raw_width) * u64::from(raw_height) > u64::from(max_megapixels) * 1_000_000 {
        return None;
    }
    let mut image = DynamicImage::from_decoder(decoder).ok()?;
    if let Some(orientation) = orientation {
        image.apply_orientation(orientation);
    }
    let (width, height) = (image.width(), image.height());
    let mut formats = Vec::new();
    if responsive {
        let mut targets: Vec<(String, u32, u32)> =
            vec![("thumbnail".into(), THUMBNAIL.0, THUMBNAIL.1)];
        targets.extend(breakpoints.iter().map(|b| (b.name.clone(), b.width, b.width)));
        for (name, max_width, max_height) in targets {
            if width <= max_width && height <= max_height {
                continue;
            }
            if name != "thumbnail" && width <= max_width {
                continue;
            }
            let resized = if name == "thumbnail" {
                image.resize(max_width, max_height, FilterType::Lanczos3)
            } else {
                image.resize(max_width, u32::MAX, FilterType::Lanczos3)
            };
            if let Some(bytes) = encode(&resized, format) {
                formats.push(Generated {
                    name,
                    width: resized.width(),
                    height: resized.height(),
                    bytes,
                });
            }
        }
    }
    Some(Analysis { width, height, formats })
}

fn encode(image: &DynamicImage, format: ImageFormat) -> Option<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    match format {
        ImageFormat::Jpeg => {
            let encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
            image.to_rgb8().write_with_encoder(encoder).ok()?;
        }
        other => image.write_to(&mut out, other).ok()?,
    }
    Some(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> tempfile::NamedTempFile {
        let file = tempfile::Builder::new().suffix(".png").tempfile().unwrap();
        let image = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        });
        image.save(file.path()).unwrap();
        file
    }

    #[test]
    fn generates_formats_smaller_than_the_original() {
        let file = png(1200, 800);
        let breakpoints = crate::config::UploadConfig::default().breakpoints;
        let analysis = analyse(file.path(), ImageFormat::Png, &breakpoints, 100, true).unwrap();
        assert_eq!((analysis.width, analysis.height), (1200, 800));
        let names: Vec<(&str, u32, u32)> =
            analysis.formats.iter().map(|f| (f.name.as_str(), f.width, f.height)).collect();
        assert_eq!(
            names,
            [
                ("thumbnail", 234, 156),
                ("large", 1000, 667),
                ("medium", 750, 500),
                ("small", 500, 333)
            ]
        );

        let small = png(300, 200);
        let analysis = analyse(small.path(), ImageFormat::Png, &breakpoints, 100, true).unwrap();
        let names: Vec<&str> = analysis.formats.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["thumbnail"]);
        assert_eq!(dimensions(small.path()), Some((300, 200)));
    }

    #[test]
    fn refuses_images_over_the_pixel_budget() {
        let file = png(2000, 1000);
        assert!(analyse(file.path(), ImageFormat::Png, &[], 1, false).is_none());
    }
}
