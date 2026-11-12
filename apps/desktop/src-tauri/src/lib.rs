// The app: one window whose page is the built editor, served on the
// custom `tramme` protocol — the same handler answers the static assets
// (embedded from apps/editor/dist by Tauri) and the /api routes over the
// local storage, so the editor runs unmodified, like behind its Worker.
// One crate for the computers and for Android; what only a computer has
// lives in `desktop` (compiled there only).

mod account;
mod analytics;
mod api;
mod bodies;
#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod device_secrets;
mod exports;
mod fetch;
pub mod format;
mod keys;
pub mod store;

use std::borrow::Cow;
use tauri::http::{Request, Response, StatusCode};
#[cfg(mobile)]
use tauri::Manager;
use tauri::{WebviewUrl, WebviewWindowBuilder};

const SCHEME: &str = "tramme";
const PROJECT_SANDBOX_CSP: &str = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; worker-src data:; connect-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

// ── the app's commands, for the editor's settings ────

#[tauri::command]
fn desktop_state() -> serde_json::Value {
    serde_json::json!({ "home": store::home().to_string_lossy() })
}

// ── the way out to the providers, keys put back on the way (fetch.rs) ──

/// a web page (or a release's installer) in the system's browser: the window's own
/// webview does nothing for a link that opens a new tab, so the page asks for it here
#[cfg(desktop)]
#[tauri::command]
fn desktop_open_url(url: String) -> Result<(), String> {
    web_address(&url)?;
    let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(windows) { "explorer" } else { "xdg-open" };
    std::process::Command::new(opener).arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// on a phone, the system opens it (DevicePlugin.kt): there is no browser to spawn
#[cfg(mobile)]
#[tauri::command]
async fn desktop_open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    web_address(&url)?;
    app.state::<tauri_plugin_tramme_device::Device<tauri::Wry>>().open_url(&url)
}

fn web_address(url: &str) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") { Ok(()) } else { Err("only web addresses open in the browser".into()) }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // a second launch (a double-click on a .tramme) hands its file here
    #[cfg(desktop)]
    let builder = builder.plugin(desktop::single_instance());
    // the commands only a computer has, then the ones both have (one list per cfg: generate_handler! takes a literal list)
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        analytics::analytics_state, analytics::analytics_set, analytics::analytics_event,
        desktop_state, desktop::desktop_pick_home, desktop::desktop_set_home, desktop::desktop_pending_name, desktop::desktop_pending_bytes,
        desktop_fetch, desktop_fetch_abort, desktop::desktop_open_plugins, desktop_open_url,
        desktop::desktop_quick_enable, desktop::desktop_quick_open, desktop::desktop_quick_do,
        desktop::desktop_quick_drop_names, desktop::desktop_quick_drop_file
    ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        analytics::analytics_state, analytics::analytics_set, analytics::analytics_event,
        desktop_state, desktop_fetch, desktop_fetch_abort, desktop_open_url,
        exports::device_save, exports::device_share, exports::device_keep_awake, exports::device_exit,
        exports::device_bars, bodies::device_body
    ]);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_tramme_device::init())
        .register_asynchronous_uri_scheme_protocol(SCHEME, |_ctx, request, responder| {
            // answered off the main thread: the storage does disk I/O
            let app = _ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(handle(app, request));
            });
        })
        .setup(|app| {
            #[cfg(desktop)]
            desktop::read_launch_args();
            // a phone gives the app its own private folders: the projects and the settings live there
            #[cfg(mobile)]
            {
                store::set_roots(app.path().app_data_dir()?.join("Tramme"), app.path().app_config_dir()?.join("desktop.json"));
                exports::init(app.path().app_cache_dir()?.join("exports"));
                device_secrets::install(app.state::<tauri_plugin_tramme_device::Device<tauri::Wry>>().inner().clone());
            }
            let url = format!("{SCHEME}://localhost/").parse().unwrap();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url)).title("Tramme");
            #[cfg(desktop)]
            let window = desktop::configure_window(window);
            #[allow(unused_variables)]
            let main = window.build()?;
            #[cfg(desktop)]
            desktop::watch_main(app.handle(), &main);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Tramme app");
}

/// any request on the app origin: /api to the storage, everything else to the
/// embedded assets, with index.html for the editor's pages (/p/<id>)
fn handle(app: tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    // on Android the body comes through the IPC, the request names it (bodies.rs)
    let request = bodies::restore(request);
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
        Some(asset) => {
            let mut response = Response::builder()
                .status(StatusCode::OK)
                .header("content-type", mime)
                .header("cache-control", "no-cache");
            if name == "project-sandbox.html" {
                response = response.header("content-security-policy", PROJECT_SANDBOX_CSP);
            }
            response.body(asset.bytes).unwrap()
        }
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
