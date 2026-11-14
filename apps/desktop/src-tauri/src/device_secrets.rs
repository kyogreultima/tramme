// A phone's secrets (the providers' keys, the account's session): kept by the
// device plugin under a key of the Android Keystore (plugin-device/android), the
// app asking it each time it needs one. Nothing is held here, so a key is still
// there after the app is killed and reopened. Behind the same `Secrets` trait as
// the desktop's keychain, so keys.rs and account.rs keep their logic.

use crate::keys::Secrets;
use crate::store::{http_err, Res};
use std::sync::OnceLock;
use tauri_plugin_tramme_device::Device;

static DEVICE: OnceLock<Device<tauri::Wry>> = OnceLock::new();

/// the device plugin's handle, given once at startup
pub fn install(device: Device<tauri::Wry>) {
    let _ = DEVICE.set(device);
}

pub struct DeviceSecrets;

fn failed(e: String) -> crate::store::HttpError {
    eprintln!("device: secrets error: {e}");
    crate::store::HttpError { status: 500, message: "the device refused to keep the key".into() }
}

impl Secrets for DeviceSecrets {
    fn get(&self, slot: &str) -> Option<String> {
        DEVICE.get()?.secret_get(slot)
    }
    fn set(&self, slot: &str, key: &str) -> Res<()> {
        match DEVICE.get() {
            Some(d) => d.secret_set(slot, key).map_err(failed),
            None => http_err(500, "the device is not ready"),
        }
    }
    fn delete(&self, slot: &str) -> Res<()> {
        match DEVICE.get() {
            Some(d) => d.secret_delete(slot).map_err(failed),
            None => http_err(500, "the device is not ready"),
        }
    }
}
