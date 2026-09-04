//! Downscale an image and encode it as lossy WebP.
//!
//! The web app does this in a canvas, but WebKit cannot encode WebP from
//! one: `canvas.toBlob('image/webp')` in a WKWebView quietly hands back PNG
//! bytes labelled as WebP, and those bytes would go on chain under a name
//! that lies about them. So on the desktop the shell does the encoding
//! instead, with libwebp, and the web app skips the canvas entirely.
//!
//! Nothing here knows about Tauri, windows or IPC. That is the point: this
//! crate builds and its tests run on any machine, including the Linux ones
//! that have no macOS webview to link against.

use image::imageops::FilterType;
use image::ImageReader;
use std::io::Cursor;

/// The bytes of `input`, downscaled so its longest edge is at most
/// `max_edge`, encoded as lossy WebP at `quality` (0 to 100).
///
/// An image already inside the box is not enlarged: upscaling would buy
/// calldata and no detail. The error is a plain `String` because its one
/// caller is a Tauri command, and everything that crosses that boundary
/// reaches the writer as a sentence anyway.
pub fn transcode_image(input: &[u8], max_edge: u32, quality: u8) -> Result<Vec<u8>, String> {
    let decoded = ImageReader::new(Cursor::new(input))
        // The file picker and the clipboard both hand over bytes with no
        // reliable type beside them, so the format is read from the bytes.
        .with_guessed_format()
        .map_err(|e| format!("could not read the image: {e}"))?
        .decode()
        .map_err(|e| format!("could not decode the image: {e}"))?;

    let longest = decoded.width().max(decoded.height());
    let sized = if max_edge > 0 && longest > max_edge {
        // `resize` fits the image inside the box and keeps its proportions,
        // so the same call handles portrait and landscape.
        decoded.resize(max_edge, max_edge, FilterType::Lanczos3)
    } else {
        decoded
    };

    // libwebp takes 8-bit RGBA. Alpha is kept: a diagram with a transparent
    // background is a normal thing to publish.
    let rgba = sized.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    if w == 0 || h == 0 {
        return Err("the image has no pixels".to_string());
    }
    let encoder = webp::Encoder::from_rgba(rgba.as_raw(), w, h);
    Ok(encoder.encode(f32::from(quality.min(100))).to_vec())
}

#[cfg(test)]
mod tests {
    use super::transcode_image;
    use image::{ImageFormat, RgbaImage};
    use std::io::Cursor;

    /// A deterministic image with something in it to compress: flat colour
    /// would encode to the same handful of bytes at every quality and prove
    /// nothing about the quality argument.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut img = RgbaImage::new(width, height);
        let mut noise: u32 = 0x1234_5678;
        for (x, y, px) in img.enumerate_pixels_mut() {
            // A cheap linear congruential generator, so the test image is
            // the same on every machine and every run.
            noise = noise.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let grain = (noise >> 24) as u8 / 8;
            *px = image::Rgba([
                ((x * 255) / width) as u8,
                ((y * 255) / height) as u8,
                grain,
                255,
            ]);
        }
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn is_webp(bytes: &[u8]) -> bool {
        bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
    }

    #[test]
    fn encodes_webp_within_the_edge_limit() {
        let out = transcode_image(&png(3000, 2000), 1600, 60).unwrap();
        assert!(
            is_webp(&out),
            "not a WebP file: {:?}",
            &out[..12.min(out.len())]
        );

        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!(
            decoded.width(),
            1600,
            "the longest edge is scaled to max_edge"
        );
        assert_eq!(decoded.height(), 1067, "and the proportions are kept");
    }

    #[test]
    fn a_lower_quality_is_fewer_bytes() {
        let source = png(1200, 800);
        let good = transcode_image(&source, 1600, 90).unwrap();
        let rough = transcode_image(&source, 1600, 30).unwrap();
        assert!(
            rough.len() < good.len(),
            "quality 30 produced {} bytes, quality 90 produced {}",
            rough.len(),
            good.len(),
        );
    }

    #[test]
    fn an_image_inside_the_box_is_not_enlarged() {
        let out = transcode_image(&png(320, 240), 1600, 60).unwrap();
        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (320, 240));
    }

    #[test]
    fn bytes_that_are_not_an_image_are_an_error() {
        let err = transcode_image(b"this is a letter, not a photograph", 1600, 60).unwrap_err();
        assert!(!err.is_empty());
    }
}
