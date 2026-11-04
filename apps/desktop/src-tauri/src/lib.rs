// The desktop app: one window whose page is the built editor, served on the
// custom `tramme` protocol — the same handler answers the static assets
// (embedded from apps/editor/dist by Tauri) and the /api routes over the
// local storage, so the editor runs unmodified, like behind its Worker.

mod api;
mod fetch;
pub mod format;
mod keys;
pub mod store;

use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::http::{Request, Response, StatusCode};
use tauri::{DragDropEvent, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const SCHEME: &str = "tramme";

/// a .tramme the system handed to the app (a double-click), waiting for the
/// editor to import it
static PENDING: Mutex<Option<(String, PathBuf)>> = Mutex::new(None);

fn take_open_path(argv: &[String]) -> Option<(String, PathBuf)> {
    let arg = argv.iter().skip(1).find(|a| a.to_lowercase().ends_with(".tramme"))?;
    let p = PathBuf::from(arg);
    let name = p.file_name()?.to_string_lossy().into_owned();
    Some((name, p))
}

fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ── the desktop app's commands, for the editor's settings ────

#[tauri::command]
fn desktop_state() -> serde_json::Value {
    serde_json::json!({ "home": store::home().to_string_lossy() })
}

/// the folder for the projects, picked natively; None when cancelled
#[tauri::command]
async fn desktop_pick_home(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn desktop_set_home(home: String) -> Result<serde_json::Value, String> {
    let p = PathBuf::from(&home);
    if !p.is_absolute() {
        return Err("the folder must be an absolute path".into());
    }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    store::set_configured_home(&home).map_err(|e| e.message)?;
    Ok(serde_json::json!({ "home": store::home().to_string_lossy() }))
}

// ── the way out to the providers, keys put back on the way (fetch.rs) ──

/// sends a request of the page; its answer comes back over `events`
/// the folder of the installed plugins, shown in the system's file manager
/// (made first, so the settings' "Open the folder" always opens one)
#[tauri::command]
fn desktop_open_plugins() -> Result<(), String> {
    let dir = store::home().join("library").join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(windows) { "explorer" } else { "xdg-open" };
    std::process::Command::new(opener).arg(&dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_fetch(id: u32, request: fetch::Outbound, events: tauri::ipc::Channel<fetch::Event>) -> Result<(), String> {
    let keys = keys::KeyStore::system().map_err(|e| e.message)?;
    // the answer may stream for minutes: off the main thread
    std::thread::spawn(move || fetch::run(id, request, &keys, |e| events.send(e).is_ok()));
    Ok(())
}

#[tauri::command]
fn desktop_fetch_abort(id: u32) {
    fetch::abort(id);
}

// ── a .tramme opened from the system ─────────────────────────

/// the name of the archive waiting to be imported, if any
#[tauri::command]
fn desktop_pending_name() -> Option<String> {
    PENDING.lock().unwrap().as_ref().map(|(name, _)| name.clone())
}

/// the archive's bytes; reading them consumes the pending open
#[tauri::command]
fn desktop_pending_bytes() -> tauri::ipc::Response {
    let taken = PENDING.lock().unwrap().take();
    let bytes = taken.and_then(|(_, p)| std::fs::read(p).ok()).unwrap_or_default();
    tauri::ipc::Response::new(bytes)
}

// ── the quick bubble: a small floating window over the other apps ──

/// the bubble's size closed (a round button) and open (the suggestions), in logical px
const BUBBLE: f64 = 56.0;
const PANEL: (f64, f64) = (340.0, 440.0);
/// the room kept from the screen's bottom and right edges, taskbar included
const EDGE: (f64, f64) = (24.0, 88.0);

/// switched on in the settings: the bubble shows when Tramme is not in front
static QUICK_ON: AtomicBool = AtomicBool::new(false);

fn build_quick(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("quick").is_some() {
        return Ok(());
    }
    let url = format!("{SCHEME}://localhost/quick").parse().unwrap();
    // its drag-and-drop handler stays on: the files dropped on the bubble come as paths, kept here
    let mut builder = WebviewWindowBuilder::new(app, "quick", WebviewUrl::CustomProtocol(url))
        .title("Tramme")
        .inner_size(BUBBLE, BUBBLE)
        // without its own minimum Windows keeps a window at least ~134 px wide: the round button came out oval
        .min_inner_size(BUBBLE, BUBBLE)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);
    // WebView2 shares one browser per data folder: the windows must start it with the same arguments
    if let Ok(port) = std::env::var("TRAMME_CDP_PORT") {
        builder = builder.additional_browser_args(&format!("--remote-debugging-port={port}"));
    }
    let window = builder.build()?;
    let (x, y) = saved_position(app).unwrap_or_else(|| default_position(app));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::DragDrop(DragDropEvent::Enter { .. }) => {
            let _ = handle.emit_to("quick", "quick-drag", "enter");
        }
        WindowEvent::DragDrop(DragDropEvent::Leave) => {
            let _ = handle.emit_to("quick", "quick-drag", "leave");
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            *DROPPED.lock().unwrap() = paths.iter().filter(|p| p.is_file()).cloned().collect();
            let _ = handle.emit_to("quick", "quick-drag", "drop");
            let _ = handle.emit_to("main", "quick-action", serde_json::json!({ "kind": "drop" }));
        }
        WindowEvent::Moved(pos) => remember_position(&handle, pos.x, pos.y),
        WindowEvent::Destroyed => remember_position_now(),
        _ => {}
    });
    Ok(())
}

/// the files dropped on the bubble, waiting for the main window to take them
static DROPPED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
/// where the closed bubble was left, and when that was last written to disk
static BUBBLE_AT: Mutex<Option<(i32, i32)>> = Mutex::new(None);
static WRITTEN: Mutex<Option<std::time::Instant>> = Mutex::new(None);

fn position_file() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("tramme-desktop").join("quick-position.json"))
}

/// bottom right of the main screen, where the system keeps its own small things
fn default_position(app: &tauri::AppHandle) -> (i32, i32) {
    let Ok(Some(monitor)) = app.primary_monitor() else { return (100, 100) };
    let scale = monitor.scale_factor();
    let (origin, size) = (monitor.position(), monitor.size());
    (
        (origin.x as f64 + size.width as f64 - (BUBBLE + EDGE.0) * scale) as i32,
        (origin.y as f64 + size.height as f64 - (BUBBLE + EDGE.1) * scale) as i32,
    )
}

/// where the bubble was left, if that is still on a screen
fn saved_position(app: &tauri::AppHandle) -> Option<(i32, i32)> {
    let text = std::fs::read_to_string(position_file()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let (x, y) = (v.get("x")?.as_i64()? as i32, v.get("y")?.as_i64()? as i32);
    let on_screen = app.available_monitors().ok()?.iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        x >= p.x && y >= p.y && x < p.x + s.width as i32 - 8 && y < p.y + s.height as i32 - 8
    });
    on_screen.then_some((x, y))
}

/// the closed bubble moved: kept, and written at most twice a second
fn remember_position(app: &tauri::AppHandle, x: i32, y: i32) {
    let Some(w) = app.get_webview_window("quick") else { return };
    let (Ok(size), Ok(scale)) = (w.outer_size(), w.scale_factor()) else { return };
    // the panel's own moves (it grows from the corner) are not where the bubble lives
    if size.width as f64 > BUBBLE * scale + 2.0 {
        return;
    }
    *BUBBLE_AT.lock().unwrap() = Some((x, y));
    let due = WRITTEN.lock().unwrap().map_or(true, |t| t.elapsed().as_millis() > 500);
    if due {
        remember_position_now();
    }
}

fn remember_position_now() {
    let (Some(file), Some((x, y))) = (position_file(), *BUBBLE_AT.lock().unwrap()) else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, serde_json::json!({ "x": x, "y": y }).to_string());
    *WRITTEN.lock().unwrap() = Some(std::time::Instant::now());
}

/// the bubble over the others while Tramme is behind them, away while it is in front
fn follow_main(app: &tauri::AppHandle, main_focused: bool) {
    if !QUICK_ON.load(Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    // a window shown or hidden off the event loop's thread, so it never waits on itself
    std::thread::spawn(move || {
        if let Some(w) = app.get_webview_window("quick") {
            if main_focused {
                // back in Tramme: the next time it shows, it is the closed bubble
                resize_quick(&app, false);
                let _ = app.emit_to("quick", "quick-fold", ());
                let _ = w.hide();
            } else {
                let _ = w.show();
            }
        }
    });
}

/// the bubble on or off: made (hidden) when on, closed when off
#[tauri::command]
async fn desktop_quick_enable(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    QUICK_ON.store(on, Ordering::SeqCst);
    if on {
        build_quick(&app).map_err(|e| e.to_string())?;
        // Tramme is already behind the others (a launch at login, a restart): show it now
        let behind = app.get_webview_window("main").map(|w| !w.is_focused().unwrap_or(true)).unwrap_or(false);
        if behind {
            if let Some(w) = app.get_webview_window("quick") {
                let _ = w.show();
            }
        }
    } else if let Some(w) = app.get_webview_window("quick") {
        let _ = w.close();
    }
    Ok(())
}

/// the bubble opened into its panel or folded back, its bottom right corner staying where it is
fn resize_quick(app: &tauri::AppHandle, open: bool) {
    let Some(w) = app.get_webview_window("quick") else { return };
    let (Ok(pos), Ok(size), Ok(scale)) = (w.outer_position(), w.outer_size(), w.scale_factor()) else { return };
    let (width, height) = if open { PANEL } else { (BUBBLE, BUBBLE) };
    let (nw, nh) = ((width * scale).round() as i32, (height * scale).round() as i32);
    let _ = w.set_size(LogicalSize::new(width, height));
    let _ = w.set_position(PhysicalPosition::new(pos.x + size.width as i32 - nw, pos.y + size.height as i32 - nh));
}

#[tauri::command]
fn desktop_quick_open(app: tauri::AppHandle, open: bool) {
    resize_quick(&app, open);
    if open {
        if let Some(w) = app.get_webview_window("quick") {
            let _ = w.set_focus();
        }
    }
}

/// the names of the files dropped on the bubble
#[tauri::command]
fn desktop_quick_drop_names() -> Vec<String> {
    DROPPED.lock().unwrap().iter().filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).collect()
}

/// one of those files' bytes (never a path of the page's choosing: only what was dropped)
#[tauri::command]
fn desktop_quick_drop_file(index: usize) -> tauri::ipc::Response {
    let path = DROPPED.lock().unwrap().get(index).cloned();
    tauri::ipc::Response::new(path.and_then(|p| std::fs::read(p).ok()).unwrap_or_default())
}

/// what the bubble asks of Tramme: the main window comes forward and gets the action
#[tauri::command]
fn desktop_quick_do(app: tauri::AppHandle, action: serde_json::Value) {
    focus_main(&app);
    let _ = app.emit_to("main", "quick-action", action);
}

pub fn run() {
    tauri::Builder::default()
        // a second launch (a double-click on a .tramme) hands its file here
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some((name, path)) = take_open_path(&argv) {
                app.emit("desktop-open", &name).ok();
                *PENDING.lock().unwrap() = Some((name, path));
                focus_main(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            desktop_state, desktop_pick_home, desktop_set_home, desktop_pending_name, desktop_pending_bytes,
            desktop_fetch, desktop_fetch_abort, desktop_open_plugins,
            desktop_quick_enable, desktop_quick_open, desktop_quick_do, desktop_quick_drop_names, desktop_quick_drop_file
        ])
        .register_asynchronous_uri_scheme_protocol(SCHEME, |_ctx, request, responder| {
            // answered off the main thread: the storage does disk I/O
            let app = _ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(handle(app, request));
            });
        })
        .setup(|app| {
            // a first launch started from a double-click on a .tramme
            let argv: Vec<String> = std::env::args().collect();
            if let Some((name, path)) = take_open_path(&argv) {
                *PENDING.lock().unwrap() = Some((name, path));
            }
            let url = format!("{SCHEME}://localhost/").parse().unwrap();
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url))
                .title("Tramme")
                .inner_size(1400.0, 880.0)
                .min_inner_size(640.0, 480.0)
                // the editor drops files itself (the home screen imports them)
                .disable_drag_drop_handler();
            // the editor's top bar is the title bar (apps/editor/src/ui/WindowControls.tsx):
            // no system bar on Windows and Linux, the bar carries the buttons; on
            // macOS the traffic lights sit over it, centred in its 46 px
            #[cfg(not(target_os = "macos"))]
            {
                window = window.decorations(false);
            }
            #[cfg(target_os = "macos")]
            {
                window = window
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(tauri::LogicalPosition::new(16.0, 23.0));
            }
            // a test harness (TRAMME_CDP_PORT=9223) can drive the webview over CDP
            if let Ok(port) = std::env::var("TRAMME_CDP_PORT") {
                window = window.additional_browser_args(&format!("--remote-debugging-port={port}"));
            }
            let main = window.build()?;
            // the quick bubble follows the main window's focus; it goes when the window does
            let handle = app.handle().clone();
            main.on_window_event(move |event| match event {
                WindowEvent::Focused(focused) => follow_main(&handle, *focused),
                WindowEvent::Destroyed => {
                    if let Some(w) = handle.get_webview_window("quick") {
                        let _ = w.close();
                    }
                }
                _ => {}
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Tramme desktop app");
}

/// any request on the app origin: /api to the storage, everything else to the
/// embedded assets, with index.html for the editor's pages (/p/<id>)
fn handle(app: tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().to_string();
    let response = if path == "/api" || path.starts_with("/api/") {
        api::route(request)
    } else {
        asset_response(&app, &path)
    };
    response.map(Cow::Owned)
}

fn asset_response(app: &tauri::AppHandle, path: &str) -> Response<Vec<u8>> {
    let name = path.trim_start_matches('/');
    let name = if name.is_empty() || is_editor_page(name) { "index.html" } else { name };
    let mime = asset_mime(name);
    match app.asset_resolver().get(name.to_string()) {
        Some(asset) => Response::builder()
            .status(StatusCode::OK)
            .header("content-type", mime)
            .header("cache-control", "no-cache")
            .body(asset.bytes)
            .unwrap(),
        // an unknown route without an extension is a page: the editor routes it
        None if !has_extension(name) => {
            let index = app.asset_resolver().get("index.html".to_string()).map(|a| a.bytes).unwrap_or_default();
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "text/html; charset=utf-8")
                .header("cache-control", "no-cache")
                .body(index)
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("content-type", "text/plain; charset=utf-8")
            .body(b"not found".to_vec())
            .unwrap(),
    }
}

/// /p/<id>, the home page and the quick bubble's page (/quick) are the editor's, everything else is a file
fn is_editor_page(name: &str) -> bool {
    if name.trim_end_matches('/') == "quick" {
        return true;
    }
    let Some(rest) = name.strip_prefix("p/") else { return false };
    let id = rest.trim_end_matches('/');
    format::valid_id(id)
}

fn has_extension(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, e)| !e.is_empty() && !e.contains('/'))
}

fn asset_mime(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" | "webmanifest" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        "tramme" | "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_pages_and_files() {
        assert!(is_editor_page("p/abc-123"));
        assert!(is_editor_page("p/abc-123/"));
        assert!(!is_editor_page("p/ab"));
        assert!(!is_editor_page("p/ABC"));
        assert!(is_editor_page("quick"));
        assert!(!is_editor_page("assets/main.js"));
        assert!(has_extension("assets/main-abc.js"));
        assert!(has_extension("index.html"));
        assert!(!has_extension("p/abc-123"));
        assert!(!has_extension("sounds/some.folder/file"));
    }

    #[test]
    fn mime_of_the_assets() {
        assert_eq!(asset_mime("index.html"), "text/html; charset=utf-8");
        assert_eq!(asset_mime("assets/main-1.js"), "text/javascript; charset=utf-8");
        assert_eq!(asset_mime("examples/x.tramme"), "application/zip");
        assert_eq!(asset_mime("sounds/catalog.json"), "application/json; charset=utf-8");
    }
}
