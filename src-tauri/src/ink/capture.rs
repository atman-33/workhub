//! Screen grab behind an ink capture.
//!
//! The overlay is a transparent window, so the strokes on their own are a
//! picture of nothing. What makes a capture useful is the screen underneath
//! them, and that has to be grabbed *before* the overlay is shown — grabbing
//! it at save time would either photograph our own strokes or need the
//! overlay hidden and re-shown mid-gesture, which flickers and races.
//!
//! Windows-only, like the rest of the ink module: BitBlt from the screen DC
//! into a memory bitmap, GetDIBits into a top-down BGRA buffer, then a swap
//! to RGBA. The grab stays raw and stays in Rust (see `super::store`): the
//! gesture must not wait for a PNG encode before the overlay appears, and a
//! full-screen PNG would be a multi-megabyte trip across the Tauri bridge for
//! a picture the webview never displays.

use image::{ImageEncoder, ImageError};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    HGDIOBJ, SRCCOPY,
};

/// Grabs `width` x `height` physical pixels of the screen, starting at the
/// virtual-desktop coordinate (`x`, `y`), as an opaque RGBA buffer.
///
/// The screen DC spans the whole virtual desktop, so a monitor to the left of
/// or above the primary one (negative coordinates) grabs like any other.
pub fn grab_rgba(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    if width <= 0 || height <= 0 {
        return Err("the capture area is empty".into());
    }
    let mut pixels = unsafe { grab_bgra(x, y, width, height) }?;
    bgra_to_rgba(&mut pixels);
    Ok(pixels)
}

/// Encodes an RGBA buffer as a PNG.
pub fn encode_png(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(pixels, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e: ImageError| e.to_string())?;
    Ok(png)
}

// ---------------------------------------------------------------------
// GDI
// ---------------------------------------------------------------------

/// Owned GDI handles. A capture takes three of them and can fail at any step;
/// releasing them by hand on every path is how a long session springs a leak.
struct ScreenDc(HDC);
struct MemoryDc(HDC);
struct Bitmap(HBITMAP);

impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe { ReleaseDC(None, self.0) };
    }
}

impl Drop for MemoryDc {
    fn drop(&mut self) {
        let _ = unsafe { DeleteDC(self.0) };
    }
}

impl Drop for Bitmap {
    fn drop(&mut self) {
        let _ = unsafe { DeleteObject(HGDIOBJ(self.0 .0)) };
    }
}

/// Reads the screen into a top-down BGRA buffer.
unsafe fn grab_bgra(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    let screen = ScreenDc(GetDC(None));
    if screen.0.is_invalid() {
        return Err("could not open the screen device context".into());
    }
    let memory = MemoryDc(CreateCompatibleDC(Some(screen.0)));
    if memory.0.is_invalid() {
        return Err("could not create a memory device context".into());
    }
    let bitmap = Bitmap(CreateCompatibleBitmap(screen.0, width, height));
    if bitmap.0.is_invalid() {
        return Err("could not create the capture bitmap".into());
    }
    let previous = SelectObject(memory.0, HGDIOBJ(bitmap.0 .0));
    let blit = BitBlt(memory.0, 0, 0, width, height, Some(screen.0), x, y, SRCCOPY);
    let pixels = blit
        .map_err(|_| "the screen could not be copied".to_string())
        .and_then(|()| read_pixels(memory.0, bitmap.0, width, height));
    // Put the DC's original bitmap back before the handles are dropped: a DC
    // must not still have our bitmap selected into it when it is deleted.
    if !previous.is_invalid() {
        SelectObject(memory.0, previous);
    }
    pixels
}

/// A negative `biHeight` asks GDI for a top-down buffer, which is the row
/// order every image format here wants; the default is bottom-up.
unsafe fn read_pixels(
    memory: HDC,
    bitmap: HBITMAP,
    width: i32,
    height: i32,
) -> Result<Vec<u8>, String> {
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut buffer = vec![0u8; (width as usize) * (height as usize) * 4];
    let copied = GetDIBits(
        memory,
        bitmap,
        0,
        height as u32,
        Some(buffer.as_mut_ptr().cast()),
        &mut info,
        DIB_RGB_COLORS,
    );
    if copied == 0 {
        return Err("the captured pixels could not be read".into());
    }
    Ok(buffer)
}

/// In place: swap the blue and red channels and force the alpha opaque. GDI
/// leaves alpha at zero for a screen copy, which a straight reinterpretation
/// would render as a fully transparent image.
fn bgra_to_rgba(pixels: &mut [u8]) {
    for px in pixels.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
        px[3] = 255;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgra_becomes_opaque_rgba() {
        let mut pixels = vec![10, 20, 30, 0, 40, 50, 60, 0];
        bgra_to_rgba(&mut pixels);
        assert_eq!(pixels, vec![30, 20, 10, 255, 60, 50, 40, 255]);
    }

    #[test]
    fn an_empty_area_is_rejected() {
        assert!(grab_rgba(0, 0, 0, 100).is_err());
        assert!(grab_rgba(0, 0, 100, -1).is_err());
    }

    #[test]
    fn encodes_a_png_signature() {
        let png = encode_png(&[0; 4 * 4], 2, 2).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
