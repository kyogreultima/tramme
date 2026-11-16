// The projects of the account, beside the ones of this device's folder. Signed
// in (account.rs keeps the session in the system keychain), the app lists the
// account's projects with its own, each under an id that says where it lives
// (`cloud--<id>`), and sends every request about one of them to the app of this
// build's environment, the Worker that keeps them (apps/worker/src/cloud.ts).
// The editor does not know the difference: the same routes, the same answers,
// its files (pictures, sounds, videos) read in parts like the folder's.
//
// A new project goes to the folder, unless the page asks for the account
// (`POST /api/projects?place=cloud`): how a project of this computer is brought
// into the account, through its archive (apps/editor/src/bring.ts).

use crate::account::{self, Answer};
use serde_json::Value;

/// what the ids of the account's projects start with on this device
pub const PREFIX: &str = "cloud--";

/// the largest part of a file one request brings: a video is read in parts, as from the folder
const PART: u64 = 8 * 1024 * 1024;
/// the largest answer read whole (an archive, a document)
const MAX_ANSWER: u64 = 512 * 1024 * 1024;

/// whether an id is one of the account's
pub fn is_cloud(id: &str) -> bool {
    id.starts_with(PREFIX)
}

/// the id of a project of the account as the device shows it, and back
pub fn shown(id: &str) -> String {
    format!("{PREFIX}{id}")
}

/// the ids of a project's JSON (a manifest, a list of them, a project's info) as the device shows them
pub fn show_ids(v: &mut Value) {
    match v {
        Value::Array(items) => items.iter_mut().for_each(show_ids),
        Value::Object(map) => {
            if let Some(Value::Object(manifest)) = map.get_mut("manifest") {
                if let Some(Value::String(id)) = manifest.get_mut("id") {
                    *id = shown(id);
                }
            }
            // a manifest: it has its name and its id
            if map.contains_key("name") {
                if let Some(Value::String(id)) = map.get_mut("id") {
                    if !is_cloud(id) {
                        *id = shown(id);
                    }
                }
                map.insert("cloud".into(), Value::Bool(true));
            }
        }
        _ => {}
    }
}

/// a Range the cloud is asked: an open end becomes one part, so a video is never brought whole
pub fn bounded_range(range: &str) -> String {
    let Some(spec) = range.trim().strip_prefix("bytes=") else { return range.to_string() };
    match spec.split_once('-') {
        Some((start, "")) if !start.is_empty() && !spec.contains(',') => match start.trim().parse::<u64>() {
            Ok(from) => format!("bytes={from}-{}", from + PART - 1),
            Err(_) => range.to_string(),
        },
        _ => range.to_string(),
    }
}

/// the account's projects, as the device lists them; none when signed out or out of reach
pub fn list() -> Vec<Value> {
    if !account::signed_in() {
        return Vec::new();
    }
    match account::to_cloud("GET", "/api/projects", &[("accept", "application/json".into())], &[], MAX_ANSWER) {
        Ok(Answer { status: 200, body, .. }) => match serde_json::from_slice::<Value>(&body) {
            Ok(mut v @ Value::Array(_)) => {
                show_ids(&mut v);
                v.as_array().cloned().unwrap_or_default()
            }
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

/// a request about the account's projects, sent to the cloud: `path` is its path there (/api/projects/…)
pub fn forward(method: &str, path_and_query: &str, req_headers: &[(&str, Option<&str>)], body: &[u8]) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let mut headers: Vec<(&str, String)> = Vec::new();
    for (name, value) in req_headers {
        if let Some(value) = value {
            let value = if *name == "range" { bounded_range(value) } else { value.to_string() };
            headers.push((name, value));
        }
    }
    match account::to_cloud(method, path_and_query, &headers, body, MAX_ANSWER) {
        Ok(Answer { status, headers, body }) => {
            let json = headers.iter().any(|(k, v)| k == "content-type" && v.starts_with("application/json"));
            if json && (200..300).contains(&status) {
                if let Ok(mut v) = serde_json::from_slice::<Value>(&body) {
                    show_ids(&mut v);
                    return (status, headers, serde_json::to_vec(&v).unwrap_or(body));
                }
            }
            (status, headers, body)
        }
        Err(e) => {
            eprintln!("desktop: the account's projects did not answer: {e}");
            (503, vec![("content-type".into(), "application/json".into())], br#"{"error":"network"}"#.to_vec())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_account_s_ids_say_where_they_live() {
        let mut list = json!([{ "id": "film-a1b2c3", "name": "Film" }, { "id": "other-x", "name": "Other" }]);
        show_ids(&mut list);
        assert_eq!(list[0]["id"], "cloud--film-a1b2c3");
        assert_eq!(list[0]["cloud"], true);
        let mut info = json!({ "manifest": { "id": "film-a1b2c3", "name": "Film" }, "files": [{ "path": "document.tramme.json" }] });
        show_ids(&mut info);
        assert_eq!(info["manifest"]["id"], "cloud--film-a1b2c3");
        assert_eq!(info["files"][0]["path"], "document.tramme.json");
        assert!(is_cloud("cloud--x") && !is_cloud("film-x"));
    }

    #[test]
    fn a_video_is_read_in_parts() {
        assert_eq!(bounded_range("bytes=0-"), format!("bytes=0-{}", PART - 1));
        assert_eq!(bounded_range("bytes=100-199"), "bytes=100-199");
        assert_eq!(bounded_range("bytes=-500"), "bytes=-500");
    }
}
