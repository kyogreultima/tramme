// What the phone gives the app, for the Rust side to call (the page never does,
// except for listening to the back button): secrets kept with a key of the
// Android Keystore, a finished file saved to the gallery or the downloads, the
// share sheet, the screen kept awake, leaving the app. The Kotlin half is in
// `android/` (DevicePlugin.kt), merged into the app by Tauri. On a computer
// every method answers "android only" or does nothing, so the crate builds
// everywhere and the desktop app is unchanged.

use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(not(target_os = "android"))]
use std::marker::PhantomData;
use std::path::Path;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(not(target_os = "android"))]
const NOT_HERE: &str = "android only";

/// the device's side, in the app's managed state
pub struct Device<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _runtime: PhantomData<fn() -> R>,
}

impl<R: Runtime> Clone for Device<R> {
    fn clone(&self) -> Self {
        Device {
            #[cfg(target_os = "android")]
            handle: self.handle.clone(),
            #[cfg(not(target_os = "android"))]
            _runtime: PhantomData,
        }
    }
}

#[derive(Serialize)]
struct Slot<'a> {
    slot: &'a str,
}

#[derive(Serialize)]
struct SlotValue<'a> {
    slot: &'a str,
    value: &'a str,
}

#[derive(Serialize)]
struct File<'a> {
    path: &'a str,
    name: &'a str,
    mime: &'a str,
}

#[derive(Serialize)]
struct Awake {
    on: bool,
}

/// a command without arguments still sends an object
#[derive(Serialize)]
struct Empty {}

#[derive(Serialize)]
struct Url<'a> {
    url: &'a str,
}

#[derive(Deserialize)]
struct Secret {
    value: Option<String>,
}

impl<R: Runtime> Device<R> {
    /// calls a command of DevicePlugin.kt and waits for its answer
    #[cfg(target_os = "android")]
    fn call<P: Serialize>(&self, command: &str, payload: P) -> Result<Value, String> {
        self.handle.run_mobile_plugin(command, payload).map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "android"))]
    fn call<P: Serialize>(&self, _command: &str, _payload: P) -> Result<Value, String> {
        Err(NOT_HERE.into())
    }

    pub fn secret_get(&self, slot: &str) -> Option<String> {
        let answer = self.call("getSecret", Slot { slot }).ok()?;
        serde_json::from_value::<Secret>(answer).ok()?.value.filter(|v| !v.is_empty())
    }

    pub fn secret_set(&self, slot: &str, value: &str) -> Result<(), String> {
        self.call("setSecret", SlotValue { slot, value }).map(|_| ())
    }

    pub fn secret_delete(&self, slot: &str) -> Result<(), String> {
        self.call("deleteSecret", Slot { slot }).map(|_| ())
    }

    /// a finished file put where the user finds it: `Movies/Tramme` for a video, `Pictures/Tramme`
    /// for an image, the downloads for the rest
    pub fn save(&self, path: &Path, name: &str, mime: &str) -> Result<(), String> {
        self.call("save", File { path: &path.to_string_lossy(), name, mime }).map(|_| ())
    }

    /// the system share sheet for a file
    pub fn share(&self, path: &Path, name: &str, mime: &str) -> Result<(), String> {
        self.call("share", File { path: &path.to_string_lossy(), name, mime }).map(|_| ())
    }

    pub fn keep_awake(&self, on: bool) {
        let _ = self.call("keepAwake", Awake { on });
    }

    pub fn exit(&self) {
        let _ = self.call("exit", Empty {});
    }

    /// a web address in the phone's browser (or the app that claims it)
    pub fn open_url(&self, url: &str) -> Result<(), String> {
        self.call("openUrl", Url { url }).map(|_| ())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("tramme-device")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            app.manage(Device { handle: _api.register_android_plugin("app.tramme.device", "DevicePlugin")? });
            #[cfg(not(target_os = "android"))]
            app.manage(Device::<R> { _runtime: PhantomData });
            Ok(())
        })
        .build()
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;

    #[test]
    fn off_android_nothing_is_kept_and_nothing_crashes() {
        let device = Device::<tauri::Wry> { _runtime: PhantomData };
        assert_eq!(device.secret_get("a"), None);
        assert_eq!(device.secret_set("a", "b"), Err(NOT_HERE.to_string()));
        assert_eq!(device.save(Path::new("x.mp4"), "x.mp4", "video/mp4"), Err(NOT_HERE.to_string()));
        assert_eq!(device.open_url("https://tramme.dev"), Err(NOT_HERE.to_string()));
        device.keep_awake(true);
        device.exit();
    }
}
