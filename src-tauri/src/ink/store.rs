//! Ink captures: the screen grab taken when drawing starts, the composed PNGs
//! it turns into, and the folder they are kept in.
//!
//! The grab stays here rather than being handed to the overlay webview. The
//! webview only ever owns the strokes; at save time it sends those back as a
//! transparent PNG and the composition happens in Rust. That keeps a
//! multi-megabyte screenshot off the Tauri bridge, and means nothing has to be
//! encoded between the gesture and the first stroke.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use image::{ImageReader, RgbaImage};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows::Win32::System::SystemInformation::GetLocalTime;

use super::capture;

/// Longest edge of a list thumbnail. Big enough to recognize a window in the
/// shot, small enough that a folder of them is a few hundred KB of data URLs.
const THUMB_MAX: u32 = 360;

/// The screen under the overlay for the current drawing session.
struct Background {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
}

static BACKGROUND: Mutex<Option<Background>> = Mutex::new(None);

fn background() -> std::sync::MutexGuard<'static, Option<Background>> {
    BACKGROUND
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Grabs the monitor the overlay is about to cover. Called on activation,
/// before the overlay is shown — a grab taken later would photograph our own
/// strokes.
pub fn capture_background(x: i32, y: i32, width: i32, height: i32) {
    match capture::grab_rgba(x, y, width, height) {
        Ok(pixels) => {
            *background() = Some(Background {
                pixels,
                width: width as u32,
                height: height as u32,
            });
        }
        Err(e) => {
            // Not fatal: drawing still works, only saving is unavailable, and
            // the overlay says so when Alt+C is pressed.
            eprintln!("ink: screen capture failed: {e}");
            *background() = None;
        }
    }
}

/// Drops the grab when drawing ends. A screen is several megabytes and there
/// is no reason to hold one between sessions.
pub fn clear_background() {
    *background() = None;
}

/// One saved capture, as the Ink tab lists it.
#[derive(serde::Serialize, Clone)]
pub struct InkCapture {
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    /// File mtime in milliseconds since the epoch; the list sorts on it.
    pub modified_ms: u64,
    pub size_bytes: u64,
    /// `data:image/png;base64,...` of a downscaled preview.
    pub thumbnail: String,
}

/// Composes the session's screen grab with the strokes the overlay drew,
/// writes it into `dir`, and puts the same image on the clipboard.
pub fn save_capture(app: &AppHandle, dir: &Path, strokes_png_b64: &str) -> Result<String, String> {
    let composed = {
        let guard = background();
        let bg = guard
            .as_ref()
            .ok_or_else(|| "no screen capture is available for this drawing session".to_string())?;
        let mut canvas = RgbaImage::from_raw(bg.width, bg.height, bg.pixels.clone())
            .ok_or_else(|| "the screen capture is malformed".to_string())?;
        let strokes = decode_png(&crate::b64::decode(strokes_png_b64)?)?;
        // The overlay canvas is sized from CSS pixels times the device pixel
        // ratio, which can land a pixel off the monitor's own size. Scale
        // rather than refuse: a one-pixel mismatch is not a reason to lose a
        // capture.
        let strokes = if strokes.width() == canvas.width() && strokes.height() == canvas.height() {
            strokes
        } else {
            image::imageops::resize(
                &strokes,
                canvas.width(),
                canvas.height(),
                image::imageops::FilterType::Triangle,
            )
        };
        image::imageops::overlay(&mut canvas, &strokes, 0, 0);
        canvas
    };
    let png = capture::encode_png(composed.as_raw(), composed.width(), composed.height())?;
    let path = unique_path(dir, &format!("{}.png", local_stamp()))?;
    write_png(&path, &png)?;
    // Best effort: a capture that is on disk but not on the clipboard is
    // still a capture, and the toast names the file either way.
    if let Err(e) = write_clipboard(app, &composed) {
        eprintln!("ink: could not copy the capture to the clipboard: {e}");
    }
    Ok(norm(&path))
}

/// Writes a cropped region of an existing capture beside it, as
/// `<name>-crop.png`. The original is never touched — cropping in place would
/// throw away the rest of the shot with no way back.
pub fn save_crop(app: &AppHandle, source: &Path, png_b64: &str) -> Result<String, String> {
    let dir = source
        .parent()
        .ok_or_else(|| "the capture has no folder".to_string())?;
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("capture");
    let bytes = crate::b64::decode(png_b64)?;
    let path = unique_path(dir, &format!("{stem}-crop.png"))?;
    write_png(&path, &bytes)?;
    if let Err(e) = write_clipboard(app, &decode_png(&bytes)?) {
        eprintln!("ink: could not copy the crop to the clipboard: {e}");
    }
    Ok(norm(&path))
}

/// Every capture in `dir`, newest first, each with a thumbnail.
pub fn list(dir: &Path) -> Result<Vec<InkCapture>, String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        // A folder that does not exist yet simply has no captures in it.
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("png"))
        {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(image) = decode_png_file(&path) else {
            // A half-written or foreign PNG in the folder should not take the
            // whole list down with it.
            continue;
        };
        let (tw, th) = thumb_size(image.width(), image.height());
        let thumb = image::imageops::thumbnail(&image, tw, th);
        out.push(InkCapture {
            path: norm(&path),
            name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string(),
            width: image.width(),
            height: image.height(),
            modified_ms: modified_ms(&meta),
            size_bytes: meta.len(),
            thumbnail: data_url(&capture::encode_png(
                thumb.as_raw(),
                thumb.width(),
                thumb.height(),
            )?),
        });
    }
    out.sort_by_key(|c| std::cmp::Reverse(c.modified_ms));
    Ok(out)
}

/// The full-size image, for the preview dialog.
pub fn read_full(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(data_url(&bytes))
}

/// Puts a saved capture back on the clipboard from the list.
pub fn copy_to_clipboard(app: &AppHandle, path: &Path) -> Result<(), String> {
    write_clipboard(app, &decode_png_file(path)?)
}

/// Copies an image the frontend produced — a crop of a capture — without
/// writing it anywhere. Cropping to the clipboard is the common case; not
/// every crop deserves a file.
pub fn copy_png(app: &AppHandle, png_b64: &str) -> Result<(), String> {
    write_clipboard(app, &decode_png(&crate::b64::decode(png_b64)?)?)
}

/// Sends a capture to the recycle bin. Deleting outright would make a
/// mis-click unrecoverable.
pub fn delete(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

/// Thumbnail dimensions that fit `THUMB_MAX` on the longest edge and never
/// collapse to zero on a very lopsided image.
fn thumb_size(width: u32, height: u32) -> (u32, u32) {
    let longest = width.max(height).max(1);
    if longest <= THUMB_MAX {
        return (width.max(1), height.max(1));
    }
    let scale = f64::from(THUMB_MAX) / f64::from(longest);
    (
        ((f64::from(width) * scale).round() as u32).max(1),
        ((f64::from(height) * scale).round() as u32).max(1),
    )
}

fn write_png(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

fn write_clipboard(app: &AppHandle, image: &RgbaImage) -> Result<(), String> {
    let owned = tauri::image::Image::new(image.as_raw(), image.width(), image.height()).to_owned();
    app.clipboard()
        .write_image(&owned)
        .map_err(|e| e.to_string())
}

fn decode_png(bytes: &[u8]) -> Result<RgbaImage, String> {
    ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png)
        .decode()
        .map(|img| img.to_rgba8())
        .map_err(|e| e.to_string())
}

fn decode_png_file(path: &Path) -> Result<RgbaImage, String> {
    decode_png(&std::fs::read(path).map_err(|e| e.to_string())?)
}

fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", crate::b64::encode(png))
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Local wall-clock stamp, so a file lands under the date the user was
/// looking at the screen. The vault's other stamps are UTC dates, which as a
/// filename would read as the wrong day for most of a Japanese evening.
fn local_stamp() -> String {
    let t = unsafe { GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02}-{:02}{:02}{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

/// `name`, or `name-2`, `name-3`, ... if it is taken. Two captures inside the
/// same second, or two crops of one shot, must not overwrite each other.
fn unique_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) => (stem, ext),
        None => (name, "png"),
    };
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
        if n > 1000 {
            return Err("too many captures with the same name".into());
        }
    }
    Ok(candidate)
}

fn norm(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("workhub-ink-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn unique_path_suffixes_a_taken_name() {
        let dir = temp_dir("unique");
        let first = unique_path(&dir, "shot.png").unwrap();
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(&dir, "shot.png").unwrap();
        assert!(second.ends_with("shot-2.png"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn listing_a_missing_folder_is_empty_not_an_error() {
        let dir = temp_dir("missing").join("nope");
        assert!(list(&dir).unwrap().is_empty());
    }

    #[test]
    fn list_reads_pngs_and_skips_other_files() {
        let dir = temp_dir("list");
        let png = capture::encode_png(&[128; 4 * 4], 2, 2).unwrap();
        std::fs::write(dir.join("a.png"), &png).unwrap();
        std::fs::write(dir.join("notes.txt"), b"ignored").unwrap();
        std::fs::write(dir.join("broken.png"), b"not a png").unwrap();
        let items = list(&dir).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a.png");
        assert_eq!((items[0].width, items[0].height), (2, 2));
        assert!(items[0].thumbnail.starts_with("data:image/png;base64,"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn thumbnails_keep_the_aspect_ratio_and_never_collapse() {
        assert_eq!(
            thumb_size(100, 50),
            (100, 50),
            "smaller than the cap is left alone"
        );
        assert_eq!(thumb_size(1920, 1080), (360, 203));
        assert_eq!(thumb_size(4000, 3), (360, 1), "a sliver still has a row");
    }

    #[test]
    fn local_stamp_is_a_sortable_filename() {
        let stamp = local_stamp();
        assert_eq!(stamp.len(), "YYYY-MM-DD-HHMMSS".len());
        assert!(stamp.chars().all(|c| c.is_ascii_digit() || c == '-'));
    }
}
