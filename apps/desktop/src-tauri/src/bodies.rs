// The bodies of the page's requests on Android. Its WebView hands the app's
// protocol a request without its body (wry builds it with an empty one: Android's
// WebResourceRequest has none), so a POST or a PUT to /api would arrive empty.
// The page (apps/editor/src/device.ts, carryBodies) first lays the body here
// through the IPC, in base64 parts, under a token of its own, then sends the
// request without a body and with the token in `x-tramme-body`; `restore` puts
// the body back before the request is answered. Elsewhere no request carries the
// header and nothing changes.

use base64::Engine;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::http::Request;

pub const HEADER: &str = "x-tramme-body";

/// a body laid and never claimed (its request was aborted) is dropped after this
const KEPT: Duration = Duration::from_secs(600);

struct Laid {
    bytes: Vec<u8>,
    at: Instant,
}

static LAID: Mutex<Option<HashMap<String, Laid>>> = Mutex::new(None);

/// one part of a body, appended to what the token already holds
pub fn lay(token: &str, part: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 64 {
        return Err("bad token".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(part).map_err(|_| "unreadable part".to_string())?;
    let mut laid = LAID.lock().unwrap_or_else(|e| e.into_inner());
    let map = laid.get_or_insert_with(HashMap::new);
    let now = Instant::now();
    map.retain(|_, l| now.duration_since(l.at) < KEPT);
    let entry = map.entry(token.to_string()).or_insert(Laid { bytes: Vec::new(), at: now });
    entry.bytes.extend_from_slice(&bytes);
    entry.at = now;
    Ok(())
}

/// the request with the body its token names, the header removed; any other request as it came
pub fn restore(request: Request<Vec<u8>>) -> Request<Vec<u8>> {
    let Some(token) = request.headers().get(HEADER).and_then(|v| v.to_str().ok()).map(str::to_string) else {
        return request;
    };
    let bytes = LAID.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|m| m.remove(&token)).map(|l| l.bytes);
    let (mut parts, body) = request.into_parts();
    parts.headers.remove(HEADER);
    Request::from_parts(parts, bytes.unwrap_or(body))
}

/// a part of a body, from the page (only the phone needs it)
#[cfg(mobile)]
#[tauri::command]
pub fn device_body(token: String, part: String) -> Result<(), String> {
    lay(&token, &part)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(s: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(s)
    }

    fn put(token: Option<&str>) -> Request<Vec<u8>> {
        let mut b = Request::builder().method("PUT").uri("tramme://localhost/api/projects/x").header("content-type", "application/json");
        if let Some(t) = token {
            b = b.header(HEADER, t);
        }
        b.body(Vec::new()).unwrap()
    }

    #[test]
    fn the_parts_come_back_as_the_body_once() {
        lay("t-1", &b64(b"{\"name\":")).unwrap();
        lay("t-1", &b64(b"\"film\"}")).unwrap();
        let r = restore(put(Some("t-1")));
        assert_eq!(r.body(), b"{\"name\":\"film\"}");
        assert!(r.headers().get(HEADER).is_none());
        assert_eq!(r.headers().get("content-type").unwrap(), "application/json");
        assert_eq!(r.method(), "PUT");
        // claimed: a second request with the same token has nothing
        assert!(restore(put(Some("t-1"))).body().is_empty());
    }

    #[test]
    fn a_request_without_the_header_is_untouched() {
        let r = Request::builder().method("POST").uri("tramme://localhost/api/x").body(b"kept".to_vec()).unwrap();
        assert_eq!(restore(r).body(), b"kept");
    }

    #[test]
    fn bad_parts_and_tokens_are_refused() {
        assert!(lay("t-2", "not base64 !").is_err());
        assert!(lay("", &b64(b"x")).is_err());
        assert!(lay(&"x".repeat(65), &b64(b"x")).is_err());
    }
}
