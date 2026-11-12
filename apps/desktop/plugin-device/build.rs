// The app calls this plugin from Rust; the page only listens to its `back` event,
// which goes through the two listener commands every mobile plugin has.
const COMMANDS: &[&str] = &["register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
