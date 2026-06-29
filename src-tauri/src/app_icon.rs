use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

static ICON_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

pub fn application_icon_data_url(process_path: &str) -> Option<String> {
    let process_path = process_path.trim();
    if process_path.is_empty() {
        return None;
    }

    let cache = ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = cache.lock() {
        if let Some(icon) = cache.get(process_path) {
            return icon.clone();
        }
    }

    let icon = extract_application_icon(process_path);
    if let Ok(mut cache) = cache.lock() {
        cache.insert(process_path.to_string(), icon.clone());
    }
    icon
}

#[cfg(not(windows))]
fn extract_application_icon(_process_path: &str) -> Option<String> {
    None
}

#[cfg(windows)]
fn extract_application_icon(process_path: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows::{
        core::PCWSTR,
        Win32::{
            Graphics::Gdi::{
                CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject,
                BITMAPINFO, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
            },
            UI::{
                Shell::ExtractIconExW,
                WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON},
            },
        },
    };

    const ICON_SIZE: i32 = 32;
    let wide_path = OsStr::new(process_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut icon = HICON::default();

    let extracted = unsafe {
        ExtractIconExW(
            PCWSTR::from_raw(wide_path.as_ptr()),
            0,
            Some(&mut icon),
            None,
            1,
        )
    };
    if extracted == 0 || icon.0.is_null() {
        return None;
    }

    let rgba = unsafe {
        let memory_dc = CreateCompatibleDC(None);
        if memory_dc.0.is_null() {
            let _ = DestroyIcon(icon);
            return None;
        }

        let mut bitmap_info = BITMAPINFO::default();
        bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
        bitmap_info.bmiHeader.biWidth = ICON_SIZE;
        bitmap_info.bmiHeader.biHeight = -ICON_SIZE;
        bitmap_info.bmiHeader.biPlanes = 1;
        bitmap_info.bmiHeader.biBitCount = 32;
        bitmap_info.bmiHeader.biCompression = BI_RGB.0;

        let mut bits = std::ptr::null_mut();
        let bitmap = match CreateDIBSection(
            Some(memory_dc),
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        ) {
            Ok(bitmap) => bitmap,
            Err(_) => {
                let _ = DeleteDC(memory_dc);
                let _ = DestroyIcon(icon);
                return None;
            }
        };

        let previous = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        let drawn = DrawIconEx(
            memory_dc, 0, 0, icon, ICON_SIZE, ICON_SIZE, 0, None, DI_NORMAL,
        )
        .is_ok();

        let byte_count = (ICON_SIZE * ICON_SIZE * 4) as usize;
        let pixels = if drawn && !bits.is_null() {
            std::slice::from_raw_parts(bits.cast::<u8>(), byte_count).to_vec()
        } else {
            Vec::new()
        };

        SelectObject(memory_dc, previous);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = DestroyIcon(icon);
        pixels
    };

    if rgba.is_empty() {
        return None;
    }

    let has_alpha = rgba.chunks_exact(4).any(|pixel| pixel[3] != 0);
    let mut normalized = Vec::with_capacity(rgba.len());
    for pixel in rgba.chunks_exact(4) {
        let (blue, green, red, mut alpha) = (pixel[0], pixel[1], pixel[2], pixel[3]);
        if !has_alpha && (red != 0 || green != 0 || blue != 0) {
            alpha = u8::MAX;
        }

        let unpremultiply = |channel: u8| {
            if alpha == 0 || alpha == u8::MAX {
                channel
            } else {
                ((u16::from(channel) * 255 / u16::from(alpha)).min(255)) as u8
            }
        };
        normalized.extend_from_slice(&[
            unpremultiply(red),
            unpremultiply(green),
            unpremultiply(blue),
            alpha,
        ]);
    }

    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, ICON_SIZE as u32, ICON_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&normalized).ok()?;
    }

    Some(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png_bytes)
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn extracts_a_windows_executable_icon_as_a_png_data_url() {
        let windows_dir = std::env::var("WINDIR").expect("Windows 环境应提供 WINDIR");
        let explorer = std::path::Path::new(&windows_dir).join("explorer.exe");

        let icon = application_icon_data_url(&explorer.to_string_lossy())
            .expect("应能提取 Windows Explorer 图标");

        assert!(icon.starts_with("data:image/png;base64,"));
    }
}
