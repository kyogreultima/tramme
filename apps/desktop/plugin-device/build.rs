// The app calls this plugin from Rust; the page only listens to its `back` event,
// which goes through the two listener commands every mobile plugin has. Both
// spellings: @tauri-apps/api's addPluginListener calls one or the other
// depending on its version, and the ACL matches the name as sent.
const COMMANDS: &[&str] = &["register_listener", "remove_listener", "registerListener", "removeListener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
