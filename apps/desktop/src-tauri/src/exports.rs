// The exports folder of a phone's app: a video exported by the editor is written
// here piece by piece, at the position mediabunny's stream target gives (an MP4
// is patched in place), never held whole in memory; then the device plugin
// saves it to the gallery or shares it. The folder is the app's cache
// `exports/`, which the share sheet may read (plugin-device's tramme_files.xml);
// files older than a day are swept at startup.
//
//   PUT    /api/device/exports/<name>?at=<n>   body = bytes, written at offset n (the file is created, never truncated)
//   GET    /api/device/exports/<name>          the file, with byte ranges
//   DELETE /api/device/exports/<name>
//   POST   /api/device/exports/<name>?as=<new>  the file under the name the user gave it
//
// The code is the same on every platform so the desktop's tests and lints cover
// it; only a phone sets the folder up and registers the commands.
#![cfg_attr(not(mobile), allow(dead_code))]

use crate::store::{http_err, HttpError, Range, Res};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use tauri::Manager;
use tauri_plugin_tramme_device::Device;
use unicode_normalization::UnicodeNormalization;

/// no export is larger than this: a position beyond it is a mistake, not a video
const MAX_FILE: u64 = 8 << 30;
const MAX_NAME: usize = 120;
const KEEP: Duration = Duration::from_secs(24 * 3600);

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// the folder, made, and swept of what is older than a day
pub fn init(dir: PathBuf) {
    let _ = fs::create_dir_all(&dir);
    sweep(&dir, KEEP);
    let _ = DIR.set(dir);
}

pub fn dir() -> Option<&'static Path> {
    DIR.get().map(PathBuf::as_path)
}

/// A name that stays in the folder: letters (accented ones too), digits and `-_. ` are kept,
/// anything else becomes `_`; no leading dot, at most 120 characters; nothing left → `export`.
pub fn safe_name(name: &str) -> String {
    let kept: String = name
        .nfc()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' })
        .collect();
    let kept: String = kept.trim_start_matches('.').chars().take(MAX_NAME).collect();
    if kept.trim().is_empty() {
        "export".to_string()
    } else {
        kept
    }
}

/// where an export of that name lives: always inside `dir`
pub fn path_of(dir: &Path, name: &str) -> PathBuf {
    dir.join(safe_name(name))
}

fn io_err(e: std::io::Error) -> HttpError {
    eprintln!("device: exports error: {e}");
    HttpError { status: 500, message: "storage error".into() }
}

/// writes `data` at offset `at` of the export, creating it; what is before and after stays
pub fn write_at(dir: &Path, name: &str, at: u64, data: &[u8]) -> Res<()> {
    if at.saturating_add(data.len() as u64) > MAX_FILE {
        return http_err(413, "file too large");
    }
    fs::create_dir_all(dir).map_err(io_err)?;
    let mut file = fs::OpenOptions::new().create(true).write(true).truncate(false).open(path_of(dir, name)).map_err(io_err)?;
    file.seek(SeekFrom::Start(at)).map_err(io_err)?;
    file.write_all(data).map_err(io_err)
}

/// the export's size and the part of it a range asks for, as (start, bytes); None when the range does not fit
pub fn read(dir: &Path, name: &str, range: Option<Range>) -> Res<Option<(u64, Vec<u8>, u64)>> {
    let Ok(mut file) = fs::File::open(path_of(dir, name)) else { return http_err(404, "no such export") };
    let size = file.metadata().map_err(io_err)?.len();
    let (start, length) = match range {
        None => (0, size),
        Some(r) => match crate::api::span(size as usize, r) {
            Some((s, l)) => (s as u64, l as u64),
            None => return Ok(None),
        },
    };
    file.seek(SeekFrom::Start(start)).map_err(io_err)?;
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(length).read_to_end(&mut bytes).map_err(io_err)?;
    Ok(Some((start, bytes, size)))
}

pub fn remove(dir: &Path, name: &str) -> Res<()> {
    match fs::remove_file(path_of(dir, name)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_err(e)),
    }
}

/// an export under another name (the user's: the gallery and the share sheet show it); one of that name is replaced
pub fn rename(dir: &Path, from: &str, to: &str) -> Res<()> {
    let (from, to) = (path_of(dir, from), path_of(dir, to));
    if from == to {
        return Ok(());
    }
    fs::rename(from, to).map_err(io_err)
}

/// deletes the files not touched for `older_than`
pub fn sweep(dir: &Path, older_than: Duration) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .ok()
            .filter(|m| m.is_file())
            .and_then(|m| m.modified().ok())
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age >= older_than);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

// ── the commands the page calls once an export is written ────

/// the plugin and the export's path, or why there is none (a plain sentence for the page)
fn device_of(app: &tauri::AppHandle, name: &str) -> Result<(Device<tauri::Wry>, PathBuf), String> {
    let device = app.try_state::<Device<tauri::Wry>>().ok_or("not on this device")?.inner().clone();
    let path = dir().map(|d| path_of(d, name)).filter(|p| p.is_file()).ok_or("the exported file is gone")?;
    Ok((device, path))
}

/// the export put in the gallery (a video, an image) or the downloads (the rest)
#[tauri::command]
pub async fn device_save(app: tauri::AppHandle, name: String, mime: String) -> Result<(), String> {
    let (device, path) = device_of(&app, &name)?;
    device.save(&path, &safe_name(&name), &mime)
}

/// the export handed to the system's share sheet
#[tauri::command]
pub async fn device_share(app: tauri::AppHandle, name: String, mime: String) -> Result<(), String> {
    let (device, path) = device_of(&app, &name)?;
    device.share(&path, &safe_name(&name), &mime)
}

/// the screen kept on while an export runs
#[tauri::command]
pub async fn device_keep_awake(app: tauri::AppHandle, on: bool) {
    if let Some(device) = app.try_state::<Device<tauri::Wry>>() {
        device.keep_awake(on);
    }
}

/// the system's bars over the page's colour, their icons dark on a light one (the page's theme-color)
#[tauri::command]
pub async fn device_bars(app: tauri::AppHandle, color: String, light: bool) {
    if let Some(device) = app.try_state::<Device<tauri::Wry>>() {
        device.bars(&color, light);
    }
}

/// the back button with nothing left to go back to: leave the app
#[tauri::command]
pub async fn device_exit(app: tauri::AppHandle) {
    if let Some(device) = app.try_state::<Device<tauri::Wry>>() {
        device.exit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_name_keeps_accents_and_drops_paths() {
        assert_eq!(safe_name("Mon film été.mp4"), "Mon film été.mp4");
        // an accent typed as a letter and a combining mark is the same name
        assert_eq!(safe_name("e\u{301}te\u{301}.mp4"), "été.mp4");
        let dir = Path::new("/data/exports");
        for bad in ["../../x.mp4", "a\\b.mp4", ".hidden", "", "..", "a/b/c.mp4", "   "] {
            let name = safe_name(bad);
            assert!(!name.is_empty(), "{bad:?}");
            assert!(!name.contains('/') && !name.contains('\\'), "{bad:?} -> {name:?}");
            assert!(!name.starts_with('.'), "{bad:?} -> {name:?}");
            assert_eq!(path_of(dir, bad).parent(), Some(dir), "{bad:?}");
        }
        assert_eq!(safe_name(""), "export");
        assert_eq!(safe_name(&"a".repeat(300)).chars().count(), 120);
    }

    #[test]
    fn write_at_patches_in_place() {
        let tmp = tempfile::tempdir().unwrap();
        write_at(tmp.path(), "v.mp4", 0, b"aaaa").unwrap();
        write_at(tmp.path(), "v.mp4", 4, b"bbbb").unwrap();
        write_at(tmp.path(), "v.mp4", 1, b"XX").unwrap();
        assert_eq!(fs::read(tmp.path().join("v.mp4")).unwrap(), b"aXXabbbb");
        // a position far beyond the end is refused, not allocated
        assert_eq!(write_at(tmp.path(), "v.mp4", MAX_FILE, b"x").unwrap_err().status, 413);
    }

    #[test]
    fn read_gives_the_whole_file_or_a_range() {
        let tmp = tempfile::tempdir().unwrap();
        write_at(tmp.path(), "v.mp4", 0, b"0123456789").unwrap();
        let (start, bytes, size) = read(tmp.path(), "v.mp4", None).unwrap().unwrap();
        assert_eq!((start, bytes.as_slice(), size), (0, &b"0123456789"[..], 10));
        let range = crate::store::parse_range("bytes=2-4");
        let (start, bytes, size) = read(tmp.path(), "v.mp4", range).unwrap().unwrap();
        assert_eq!((start, bytes.as_slice(), size), (2, &b"234"[..], 10));
        assert!(read(tmp.path(), "v.mp4", crate::store::parse_range("bytes=50-")).unwrap().is_none());
        assert_eq!(read(tmp.path(), "none.mp4", None).unwrap_err().status, 404);
    }

    #[test]
    fn remove_forgets_a_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        write_at(tmp.path(), "v.mp4", 0, b"a").unwrap();
        remove(tmp.path(), "v.mp4").unwrap();
        assert!(!tmp.path().join("v.mp4").exists());
        remove(tmp.path(), "v.mp4").unwrap();
    }

    #[test]
    fn rename_replaces_and_stays_in_the_folder() {
        let tmp = tempfile::tempdir().unwrap();
        write_at(tmp.path(), "export-1.mp4", 0, b"new").unwrap();
        write_at(tmp.path(), "Mon film.mp4", 0, b"older").unwrap();
        rename(tmp.path(), "export-1.mp4", "Mon film.mp4").unwrap();
        assert_eq!(fs::read(tmp.path().join("Mon film.mp4")).unwrap(), b"new");
        assert!(!tmp.path().join("export-1.mp4").exists());
        rename(tmp.path(), "Mon film.mp4", "../../out.mp4").unwrap();
        assert!(tmp.path().join("_.._out.mp4").exists());
        assert_eq!(rename(tmp.path(), "nothing.mp4", "x.mp4").unwrap_err().status, 500);
    }

    #[test]
    fn sweep_removes_only_old_files() {
        let tmp = tempfile::tempdir().unwrap();
        write_at(tmp.path(), "old.mp4", 0, b"a").unwrap();
        write_at(tmp.path(), "new.mp4", 0, b"b").unwrap();
        let old = fs::File::options().write(true).open(tmp.path().join("old.mp4")).unwrap();
        old.set_modified(SystemTime::now() - Duration::from_secs(2 * 24 * 3600)).unwrap();
        drop(old);
        sweep(tmp.path(), KEEP);
        assert!(!tmp.path().join("old.mp4").exists());
        assert!(tmp.path().join("new.mp4").exists());
    }
}
