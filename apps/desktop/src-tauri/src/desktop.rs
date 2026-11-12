// What only makes sense on a computer: a .tramme opened from the system, the
// projects folder, the quick bubble, the window's frame. A phone has none of it
// (this module is compiled on desktop only).

use crate::{store, SCHEME};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{DragDropEvent, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// a .tramme the system handed to the app (a double-click), waiting for the
/// editor to import it
pub static PENDING: Mutex<Option<(String, PathBuf)>> = Mutex::new(None);

pub fn take_open_path(argv: &[String]) -> Option<(String, PathBuf)> {
    let arg = argv.iter().skip(1).find(|a| a.to_lowercase().ends_with(".tramme"))?;
    let p = PathBuf::from(arg);
    let name = p.file_name()?.to_string_lossy().into_owned();
    Some((name, p))
}

pub fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ── the desktop app's commands, for the editor's settings ────

/// the folder for the projects, picked natively; None when cancelled
#[tauri::command]
pub async fn desktop_pick_home(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn desktop_set_home(home: String) -> Result<serde_json::Value, String> {
    let p = PathBuf::from(&home);
    if !p.is_absolute() {
        return Err("the folder must be an absolute path".into());
    }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    store::set_configured_home(&home).map_err(|e| e.message)?;
    Ok(serde_json::json!({ "home": store::home().to_string_lossy() }))
}

/// the folder of the installed plugins, shown in the system's file manager
/// (made first, so the settings' "Open the folder" always opens one)
#[tauri::command]
pub fn desktop_open_plugins() -> Result<(), String> {
    let dir = store::home().join("library").join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(windows) { "explorer" } else { "xdg-open" };
    std::process::Command::new(opener).arg(&dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ── a .tramme opened from the system ─────────────────────────

/// the name of the archive waiting to be imported, if any
#[tauri::command]
pub fn desktop_pending_name() -> Option<String> {
    PENDING.lock().unwrap().as_ref().map(|(name, _)| name.clone())
}

/// the archive's bytes; reading them consumes the pending open
#[tauri::command]
pub fn desktop_pending_bytes() -> tauri::ipc::Response {
    let taken = PENDING.lock().unwrap().take();
    let bytes = taken.and_then(|(_, p)| std::fs::read(p).ok()).unwrap_or_default();
    tauri::ipc::Response::new(bytes)
}

// ── the quick bubble: a small floating window over the other apps ──

/// the bubble's size closed (a round button) and open (the suggestions), in logical px
const BUBBLE: f64 = 56.0;
const PANEL: (f64, f64) = (340.0, 440.0);
/// the room kept from the bottom and right edges of a screen's work area (the part the taskbar leaves), in logical px
const EDGE: f64 = 24.0;

/// switched on in the settings: the bubble shows when Tramme is not in front
pub static QUICK_ON: AtomicBool = AtomicBool::new(false);

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
    place_bubble(app, &window);
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
pub static DROPPED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
/// where the closed bubble was left, and when that was last written to disk
pub static BUBBLE_AT: Mutex<Option<(i32, i32)>> = Mutex::new(None);
pub static WRITTEN: Mutex<Option<std::time::Instant>> = Mutex::new(None);

pub fn position_file() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("tramme-desktop").join("quick-position.json"))
}

/// a rectangle in physical px: x, y, width, height
type Rect = (i32, i32, i32, i32);

pub fn overlap(a: Rect, b: Rect) -> i64 {
    let w = (a.0 + a.2).min(b.0 + b.2) - a.0.max(b.0);
    let h = (a.1 + a.3).min(b.1 + b.3) - a.1.max(b.1);
    if w <= 0 || h <= 0 { 0 } else { w as i64 * h as i64 }
}

/// the bottom right corner of an area, where the system keeps its own small things
pub fn corner(area: Rect, size: (i32, i32), margin: i32) -> (i32, i32) {
    (area.0 + area.2 - size.0 - margin, area.1 + area.3 - size.1 - margin)
}

/// Where a window of `size` wanted at `at` really goes: on the screen it overlaps most, moved in until it
/// is whole on it. A window that overlaps none (its screen was unplugged, the screens were rearranged)
/// goes to the corner of `home`. `areas` are the screens' work areas, the taskbar left out.
pub fn fit(at: (i32, i32), size: (i32, i32), areas: &[Rect], home: Rect, margin: i32) -> (i32, i32) {
    let me = (at.0, at.1, size.0, size.1);
    let Some(area) = areas.iter().copied().filter(|a| overlap(me, *a) > 0).max_by_key(|a| overlap(me, *a)) else {
        return corner(home, size, margin);
    };
    (
        at.0.clamp(area.0, (area.0 + area.2 - size.0).max(area.0)),
        at.1.clamp(area.1, (area.1 + area.3 - size.1).max(area.1)),
    )
}

/// the screens that exist now, as work areas, and the main one
pub fn work_areas(app: &tauri::AppHandle) -> Option<(Vec<Rect>, Rect)> {
    let rect = |m: &tauri::Monitor| {
        let a = m.work_area();
        (a.position.x, a.position.y, a.size.width as i32, a.size.height as i32)
    };
    let areas: Vec<Rect> = app.available_monitors().ok()?.iter().map(rect).collect();
    let home = app.primary_monitor().ok().flatten().map(|m| rect(&m)).or_else(|| areas.first().copied())?;
    Some((areas, home))
}

/// where the bubble was left, as it was written (it may be on a screen that is gone: `fit` decides)
pub fn saved_position() -> Option<(i32, i32)> {
    let text = std::fs::read_to_string(position_file()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some((v.get("x")?.as_i64()? as i32, v.get("y")?.as_i64()? as i32))
}

/// the bubble put where it was left, or in the corner of the main screen, and always whole on a screen that exists now
pub fn place_bubble(app: &tauri::AppHandle, w: &tauri::WebviewWindow) {
    let Some((areas, home)) = work_areas(app) else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let side = (BUBBLE * scale).round() as i32;
    let margin = (EDGE * scale).round() as i32;
    let wanted = BUBBLE_AT.lock().unwrap().or_else(saved_position).unwrap_or_else(|| corner(home, (side, side), margin));
    let (x, y) = fit(wanted, (side, side), &areas, home, margin);
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// the closed bubble, at its own size and on a screen, then shown: a window shown as it stood could be
/// where a screen used to be, or still at the size it was made with (oval, before its page is drawn)
pub fn reveal(app: &tauri::AppHandle, w: &tauri::WebviewWindow) {
    let _ = w.set_size(LogicalSize::new(BUBBLE, BUBBLE));
    place_bubble(app, w);
    let _ = w.show();
}

/// the closed bubble moved: kept, and written at most twice a second
pub fn remember_position(app: &tauri::AppHandle, x: i32, y: i32) {
    let Some(w) = app.get_webview_window("quick") else { return };
    let (Ok(size), Ok(scale)) = (w.outer_size(), w.scale_factor()) else { return };
    // the panel's own moves (it grows from the corner) are not where the bubble lives
    if size.width as f64 > BUBBLE * scale + 2.0 {
        return;
    }
    *BUBBLE_AT.lock().unwrap() = Some((x, y));
    let due = WRITTEN.lock().unwrap().is_none_or(|t| t.elapsed().as_millis() > 500);
    if due {
        remember_position_now();
    }
}

pub fn remember_position_now() {
    let (Some(file), Some((x, y))) = (position_file(), *BUBBLE_AT.lock().unwrap()) else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, serde_json::json!({ "x": x, "y": y }).to_string());
    *WRITTEN.lock().unwrap() = Some(std::time::Instant::now());
}

/// the changes of focus, counted: only the last one decides
pub static FOLLOW: AtomicU32 = AtomicU32::new(0);

/// the bubble over the others while Tramme is behind them, away while it is in front
pub fn follow_main(app: &tauri::AppHandle) {
    if !QUICK_ON.load(Ordering::SeqCst) {
        return;
    }
    let turn = FOLLOW.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    // a window shown or hidden off the event loop's thread, so it never waits on itself
    std::thread::spawn(move || {
        // a focus that goes and comes back at once is no change: the bubble's own window being made when it is
        // switched on takes it for a moment, and showed the bubble where Tramme was in front (the flash)
        std::thread::sleep(std::time::Duration::from_millis(250));
        if FOLLOW.load(Ordering::SeqCst) != turn || !QUICK_ON.load(Ordering::SeqCst) {
            return;
        }
        let Some(w) = app.get_webview_window("quick") else { return };
        let in_front = app.get_webview_window("main").map(|m| m.is_focused().unwrap_or(true)).unwrap_or(true);
        if in_front {
            // back in Tramme: the next time it shows, it is the closed bubble
            resize_quick(&app, false);
            let _ = app.emit_to("quick", "quick-fold", ());
            let _ = w.hide();
        } else if !w.is_visible().unwrap_or(false) {
            reveal(&app, &w);
        }
    });
}

/// the bubble on or off: made (hidden) when on, closed when off
#[tauri::command]
pub async fn desktop_quick_enable(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    QUICK_ON.store(on, Ordering::SeqCst);
    if on {
        build_quick(&app).map_err(|e| e.to_string())?;
        // Tramme may already be behind the others (a launch at login, a restart): shown then, never while it is in front
        follow_main(&app);
    } else if let Some(w) = app.get_webview_window("quick") {
        let _ = w.close();
    }
    Ok(())
}

/// the bubble opened into its panel or folded back, its bottom right corner staying where it is
pub fn resize_quick(app: &tauri::AppHandle, open: bool) {
    let Some(w) = app.get_webview_window("quick") else { return };
    let (Ok(pos), Ok(size), Ok(scale)) = (w.outer_position(), w.outer_size(), w.scale_factor()) else { return };
    let (width, height) = if open { PANEL } else { (BUBBLE, BUBBLE) };
    let (nw, nh) = ((width * scale).round() as i32, (height * scale).round() as i32);
    let _ = w.set_size(LogicalSize::new(width, height));
    let anchored = (pos.x + size.width as i32 - nw, pos.y + size.height as i32 - nh);
    // folded, it goes back to where the bubble lived, even if the panel had to be pushed in from an edge
    let wanted = if open { anchored } else { BUBBLE_AT.lock().unwrap().unwrap_or(anchored) };
    let (x, y) = match work_areas(app) {
        Some((areas, home)) => fit(wanted, (nw, nh), &areas, home, (EDGE * scale).round() as i32),
        None => wanted,
    };
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

#[tauri::command]
pub fn desktop_quick_open(app: tauri::AppHandle, open: bool) {
    resize_quick(&app, open);
    if open {
        if let Some(w) = app.get_webview_window("quick") {
            let _ = w.set_focus();
        }
    }
}

/// the names of the files dropped on the bubble
#[tauri::command]
pub fn desktop_quick_drop_names() -> Vec<String> {
    DROPPED.lock().unwrap().iter().filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).collect()
}

/// one of those files' bytes (never a path of the page's choosing: only what was dropped)
#[tauri::command]
pub fn desktop_quick_drop_file(index: usize) -> tauri::ipc::Response {
    let path = DROPPED.lock().unwrap().get(index).cloned();
    tauri::ipc::Response::new(path.and_then(|p| std::fs::read(p).ok()).unwrap_or_default())
}

/// what the bubble asks of Tramme: the main window comes forward and gets the action
#[tauri::command]
pub fn desktop_quick_do(app: tauri::AppHandle, action: serde_json::Value) {
    focus_main(&app);
    let _ = app.emit_to("main", "quick-action", action);
}

/// the main window as a computer has it: sized, without the system bar (the editor's top bar is the
/// title bar, apps/editor/src/ui/WindowControls.tsx), taking the dropped files itself
pub fn configure_window<'a, R: tauri::Runtime, M: Manager<R>>(window: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    let mut window = window
        .inner_size(1400.0, 880.0)
        .min_inner_size(640.0, 480.0)
        // the editor drops files itself (the home screen imports them)
        .disable_drag_drop_handler();
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
    window
}

/// a first launch started from a double-click on a .tramme
pub fn read_launch_args() {
    let argv: Vec<String> = std::env::args().collect();
    if let Some((name, path)) = take_open_path(&argv) {
        *PENDING.lock().unwrap() = Some((name, path));
    }
}

/// the quick bubble follows the main window's focus; it goes when the window does
pub fn watch_main(app: &tauri::AppHandle, main: &tauri::WebviewWindow) {
    let handle = app.clone();
    main.on_window_event(move |event| match event {
        WindowEvent::Focused(_) => follow_main(&handle),
        WindowEvent::Destroyed => {
            if let Some(w) = handle.get_webview_window("quick") {
                let _ = w.close();
            }
        }
        _ => {}
    });
}

/// the plugin that hands a second launch's .tramme to the running app
pub fn single_instance() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if let Some((name, path)) = take_open_path(&argv) {
            app.emit("desktop-open", &name).ok();
            *PENDING.lock().unwrap() = Some((name, path));
            focus_main(app);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // the screens of the user's desk: the laptop's 1920x1040 work area (the taskbar takes 40), and a larger
    // monitor beside it, at its right
    const LAPTOP: Rect = (0, 0, 1920, 1040);
    const MONITOR: Rect = (1920, -200, 2560, 1440);
    const BUBBLE_PX: (i32, i32) = (56, 56);

    #[test]
    fn a_bubble_on_a_screen_that_exists_stays_where_it_is() {
        assert_eq!(fit((2500, 900), BUBBLE_PX, &[LAPTOP, MONITOR], LAPTOP, 24), (2500, 900));
        assert_eq!(fit((100, 100), BUBBLE_PX, &[LAPTOP, MONITOR], LAPTOP, 24), (100, 100));
    }

    #[test]
    fn a_bubble_left_on_a_monitor_that_was_unplugged_comes_back_to_the_main_screen() {
        // bottom right of the monitor, then only the laptop is left
        let (x, y) = fit((4300, 1100), BUBBLE_PX, &[LAPTOP], LAPTOP, 24);
        assert_eq!((x, y), (1920 - 56 - 24, 1040 - 56 - 24));
    }

    #[test]
    fn a_bubble_that_is_half_off_a_screen_is_moved_in() {
        assert_eq!(fit((1900, 1030), BUBBLE_PX, &[LAPTOP], LAPTOP, 24), (1920 - 56, 1040 - 56));
        assert_eq!(fit((-30, -10), BUBBLE_PX, &[LAPTOP], LAPTOP, 24), (0, 0));
    }

    #[test]
    fn a_bubble_between_two_screens_goes_to_the_one_it_is_mostly_on() {
        // 40 px on the laptop, 16 on the monitor
        let at = (1880, 500);
        assert_eq!(fit(at, BUBBLE_PX, &[LAPTOP, MONITOR], LAPTOP, 24), (1864, 500));
        // 20 px on the laptop, 36 on the monitor
        assert_eq!(fit((1900, 500), BUBBLE_PX, &[LAPTOP, MONITOR], LAPTOP, 24).0, 1920);
    }

    #[test]
    fn a_panel_opened_near_the_top_left_is_pushed_into_the_screen() {
        let panel = (340, 440);
        // anchored at its bubble's corner it would hang over the top and the left of the screen
        assert_eq!(fit((-200, -300), panel, &[LAPTOP], LAPTOP, 24), (0, 0));
        // opened at the bottom right it fits where it grows
        assert_eq!(fit((1920 - 340 - 24, 1040 - 440 - 24), panel, &[LAPTOP], LAPTOP, 24), (1556, 576));
    }

    #[test]
    fn a_window_larger_than_its_screen_is_put_at_its_corner() {
        assert_eq!(fit((50, 50), (3000, 2000), &[LAPTOP], LAPTOP, 24), (0, 0));
    }

    #[test]
    fn the_main_screen_corner_leaves_room_for_the_taskbar_by_its_work_area() {
        assert_eq!(corner(LAPTOP, BUBBLE_PX, 24), (1840, 960));
        // a taskbar on the left: the work area starts further right
        assert_eq!(corner((60, 0, 1860, 1080), BUBBLE_PX, 24), (1840, 1000));
    }

}
