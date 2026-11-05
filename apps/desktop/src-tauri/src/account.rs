// The account of the person using the app. The web editor reaches the accounts
// backend through its Worker, at its own address, the browser holding the
// backend's session cookie. The desktop app has neither: its page is on the
// app's own protocol. So the editor's /api/auth, /api/account and /api/billing
// calls are answered here, by sending them to the backend of this build's
// environment (BACKEND: the beta app signs in at the beta, the stable one at
// production; nothing the page says, nor the user's machine, can change it),
// and the session cookie is kept here, in the system keychain: the page never
// sees it.
//
// What is not sent: the sign-in with Google or GitHub, which needs the system
// browser and a way back into the app (the providers are said off here), and
// the payment providers' notices, which reach the backend on their own.

use crate::keys::{self, Secrets};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};

type Body = Response<Vec<u8>>;

/// the backend of this build: the app of its environment (build.rs, from brand/environments.ts)
pub const BACKEND: &str = env!("TRAMME_BACKEND_ORIGIN");

/// what a page may send, and what it may be answered (an account's export is the largest)
const MAX_REQUEST: usize = 2 * 1024 * 1024;
const MAX_ANSWER: u64 = 32 * 1024 * 1024;
const AGENT: &str = concat!("TrammeDesktop/", env!("CARGO_PKG_VERSION"));

/// the routes of the accounts, the ones the Worker hands to the backend (apps/worker/src/accounts.ts)
const ROUTES: [&str; 3] = ["auth", "account", "billing"];

fn json_body(status: u16, data: serde_json::Value) -> Body {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap())
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .body(serde_json::to_vec(&data).unwrap())
        .unwrap()
}

/// one /api/auth, /api/account or /api/billing request of the page, answered
pub fn route(req: &Request<Vec<u8>>) -> Body {
    forward(BACKEND, keys::keychain(), req)
}

/// the path's segments, decoded; none when one climbs out of its place
fn segments(path: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for raw in path.split('/').filter(|s| !s.is_empty()) {
        let seg = percent_encoding::percent_decode_str(raw).decode_utf8().ok()?.into_owned();
        if seg == "." || seg == ".." || seg.contains('/') || seg.contains('\\') {
            return None;
        }
        out.push(seg);
    }
    Some(out)
}

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    // no redirect is followed: the backend answers its API with a status, and a request
    // carrying the session goes to the backend only
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(60))
            .redirects(0)
            .build()
    })
}

fn forward(origin: &str, secrets: &dyn Secrets, req: &Request<Vec<u8>>) -> Body {
    let Some(parts) = segments(req.uri().path()) else {
        return json_body(400, json!({ "error": "unreadable address" }));
    };
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    if !matches!(parts.as_slice(), ["api", first, ..] if ROUTES.contains(first)) {
        return json_body(404, json!({ "error": "not an account route" }));
    }
    // answered here
    match parts.as_slice() {
        ["api", "auth", "providers"] => return json_body(200, json!({ "google": false, "github": false })),
        ["api", "auth", "google" | "github", ..] => return json_body(404, json!({ "error": "unknown-provider" })),
        ["api", "billing", "webhook", ..] => return json_body(404, json!({ "error": "not served here" })),
        _ => {}
    }
    let method = req.method().as_str();
    if !matches!(method, "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return json_body(405, json!({ "error": "method not allowed" }));
    }
    if req.body().len() > MAX_REQUEST {
        return json_body(413, json!({ "error": "the request is too large" }));
    }

    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let url = format!("{origin}{}{query}", req.uri().path());
    let session = Session::new(secrets, origin);
    // the backend's own origin: it takes a change only from the address of its app
    let mut request = agent().request(method, &url).set("origin", origin).set("user-agent", AGENT);
    // of the page's headers, only what the backend reads: no cookie, no credentials, no address of the page
    for name in ["content-type", "accept", "accept-language"] {
        if let Some(value) = req.headers().get(name).and_then(|v| v.to_str().ok()) {
            request = request.set(name, value);
        }
    }
    if let Some(cookie) = session.header() {
        request = request.set("cookie", &cookie);
    }
    let sent = if req.body().is_empty() { request.call() } else { request.send_bytes(req.body()) };
    let res = match sent {
        Ok(r) | Err(ureq::Error::Status(_, r)) => r,
        Err(ureq::Error::Transport(e)) => {
            eprintln!("desktop: the accounts backend did not answer: {e}");
            return json_body(503, json!({ "error": "network" }));
        }
    };

    session.take(res.all("set-cookie"));
    let status = StatusCode::from_u16(res.status()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out = Response::builder().status(status).header("cache-control", "no-store");
    for name in ["content-type", "content-disposition"] {
        if let Some(value) = res.header(name) {
            out = out.header(name, value);
        }
    }
    let mut bytes = Vec::new();
    if res.into_reader().take(MAX_ANSWER + 1).read_to_end(&mut bytes).is_err() || bytes.len() as u64 > MAX_ANSWER {
        return json_body(502, json!({ "error": "the backend's answer could not be read" }));
    }
    out.body(bytes).unwrap_or_else(|_| json_body(502, json!({ "error": "the backend's answer could not be read" })))
}

// ── the session ──────────────────────────────────────────────────────────────

/// the cookies are read and changed one request at a time
static COOKIES: Mutex<()> = Mutex::new(());

/// where they wait when the keychain refuses them: the session then lasts until the app closes
fn memory() -> &'static Mutex<HashMap<String, String>> {
    static MEMORY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    MEMORY.get_or_init(Default::default)
}

/// the cookies of one backend, in the keychain under that backend's address: a beta app and a
/// stable one, each signed in at its own, never share a session
struct Session<'a> {
    secrets: &'a dyn Secrets,
    slot: String,
}

impl<'a> Session<'a> {
    fn new(secrets: &'a dyn Secrets, origin: &str) -> Self {
        Session { secrets, slot: format!("session:{origin}") }
    }

    fn read(&self) -> BTreeMap<String, String> {
        let raw = self.secrets.get(&self.slot).or_else(|| memory().lock().unwrap().get(&self.slot).cloned());
        raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default()
    }

    fn write(&self, jar: &BTreeMap<String, String>) {
        if jar.is_empty() {
            let _ = self.secrets.delete(&self.slot);
            memory().lock().unwrap().remove(&self.slot);
            return;
        }
        let raw = serde_json::to_string(jar).unwrap();
        match self.secrets.set(&self.slot, &raw) {
            Ok(()) => {
                memory().lock().unwrap().remove(&self.slot);
            }
            Err(_) => {
                memory().lock().unwrap().insert(self.slot.clone(), raw);
            }
        }
    }

    /// the Cookie header to send, when there is a session
    fn header(&self) -> Option<String> {
        let jar = self.read();
        if jar.is_empty() {
            return None;
        }
        Some(jar.iter().map(|(name, value)| format!("{name}={value}")).collect::<Vec<_>>().join("; "))
    }

    /// keeps what the backend's answer sets, forgets what it ends
    fn take(&self, set_cookies: Vec<&str>) {
        if set_cookies.is_empty() {
            return;
        }
        let _one_at_a_time = COOKIES.lock().unwrap_or_else(|e| e.into_inner());
        let mut jar = self.read();
        let now = chrono::Utc::now().timestamp();
        let mut changed = false;
        for line in set_cookies {
            if let Some((name, value)) = parse_set_cookie(line, now) {
                changed = true;
                match value {
                    Some(value) => jar.insert(name, value),
                    None => jar.remove(&name),
                };
            }
        }
        if changed {
            self.write(&jar);
        }
    }
}

/// one Set-Cookie line: the cookie's name, and its value, or none when the line ends it (an empty
/// value, a Max-Age of zero or less, a date that is past). Only the name and the lifetime count:
/// the cookie goes back to the one backend it came from.
fn parse_set_cookie(line: &str, now: i64) -> Option<(String, Option<String>)> {
    let mut parts = line.split(';');
    let (name, value) = parts.next()?.split_once('=')?;
    let (name, value) = (name.trim(), value.trim());
    if name.is_empty() {
        return None;
    }
    let (mut max_age, mut expires) = (None::<i64>, None::<i64>);
    for attribute in parts {
        let (key, v) = attribute.split_once('=').unwrap_or((attribute, ""));
        match key.trim().to_ascii_lowercase().as_str() {
            "max-age" => max_age = v.trim().parse().ok(),
            "expires" => expires = chrono::DateTime::parse_from_rfc2822(v.trim()).ok().map(|d| d.timestamp()),
            _ => {}
        }
    }
    let ended = value.is_empty()
        || match (max_age, expires) {
            (Some(age), _) => age <= 0,
            (None, Some(at)) => at <= now,
            _ => false,
        };
    Some((name.to_string(), if ended { None } else { Some(value.to_string()) }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::tests::Memory;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::Arc;

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    /// a backend that answers each request with the next of `answers` (the status line and headers, then the body),
    /// and keeps what it was sent
    struct Mock {
        origin: String,
        seen: Arc<Mutex<Vec<String>>>,
    }

    fn mock(answers: Vec<(&'static str, &'static str)>) -> Mock {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for (head, body) in answers {
                let Ok((mut stream, _)) = listener.accept() else { return };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                loop {
                    let n = stream.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(end) = find(&buf, b"\r\n\r\n") {
                        let text = String::from_utf8_lossy(&buf[..end]).to_lowercase();
                        let len = text
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .and_then(|v| v.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if buf.len() >= end + 4 + len {
                            break;
                        }
                    }
                }
                log.lock().unwrap().push(String::from_utf8_lossy(&buf).to_string());
                let reply = format!("HTTP/1.1 {head}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        Mock { origin, seen }
    }

    fn request(method: &str, uri: &str, headers: &[(&str, &str)], body: &str) -> Request<Vec<u8>> {
        let mut b = Request::builder().method(method).uri(uri);
        for (name, value) in headers {
            b = b.header(*name, *value);
        }
        b.body(body.as_bytes().to_vec()).unwrap()
    }

    fn text(res: &Body) -> String {
        String::from_utf8_lossy(res.body()).to_string()
    }

    /// nothing listens here: a request that should stay local does not even try
    const NOWHERE: &str = "http://127.0.0.1:1";

    #[test]
    fn the_backend_of_this_build_is_an_address_without_a_trailing_slash() {
        assert!(BACKEND.starts_with("https://") || BACKEND.starts_with("http://"), "{BACKEND}");
        assert!(!BACKEND.ends_with('/'), "{BACKEND}");
        println!("backend of this build: {BACKEND}");
    }

    #[test]
    fn a_request_goes_to_the_backend_with_its_origin_and_without_the_pages_credentials() {
        let backend = mock(vec![("200 OK\r\ncontent-type: application/json", r#"{"error":"signed_out"}"#)]);
        let secrets = Memory::default();
        let req = request(
            "GET",
            "tramme://localhost/api/auth/me?x=1",
            &[("accept", "application/json"), ("authorization", "Bearer secret"), ("cookie", "evil=1"), ("x-forwarded-for", "1.2.3.4")],
            "",
        );
        let res = forward(&backend.origin, &secrets, &req);
        assert_eq!(res.status(), 200);
        assert_eq!(text(&res), r#"{"error":"signed_out"}"#);
        assert_eq!(res.headers().get("content-type").unwrap(), "application/json");
        let sent = backend.seen.lock().unwrap()[0].to_lowercase();
        assert!(sent.starts_with("get /api/auth/me?x=1 http/1.1"), "{sent}");
        assert!(sent.contains(&format!("origin: {}", backend.origin)), "{sent}");
        assert!(sent.contains("accept: application/json"));
        for left_out in ["authorization", "evil=1", "x-forwarded-for", "cookie"] {
            assert!(!sent.contains(left_out), "{left_out} was sent: {sent}");
        }
    }

    #[test]
    fn the_body_and_the_type_of_a_post_arrive() {
        let backend = mock(vec![("200 OK", "{}")]);
        let req = request("POST", "tramme://localhost/api/auth/login", &[("content-type", "application/json")], r#"{"email":"a@b.c"}"#);
        forward(&backend.origin, &Memory::default(), &req);
        let sent = backend.seen.lock().unwrap()[0].to_lowercase();
        assert!(sent.contains("content-type: application/json"));
        assert!(sent.ends_with(r#"{"email":"a@b.c"}"#), "{sent}");
    }

    #[test]
    fn the_session_cookie_is_kept_here_sent_back_and_never_shown_to_the_page() {
        let backend = mock(vec![
            ("200 OK\r\nset-cookie: sid=abc123; Path=/; HttpOnly; Secure; Max-Age=3600", r#"{"user":{"id":"1"}}"#),
            ("200 OK", "{}"),
            ("200 OK\r\nset-cookie: sid=; Path=/; Max-Age=0", "{}"),
            ("200 OK", "{}"),
        ]);
        let secrets = Memory::default();
        let at = |method: &str, path: &str| request(method, &format!("tramme://localhost{path}"), &[], "");

        let login = forward(&backend.origin, &secrets, &request("POST", "tramme://localhost/api/auth/login", &[("content-type", "application/json")], "{}"));
        assert!(login.headers().get("set-cookie").is_none(), "the page must not see the cookie");
        assert_eq!(secrets.get(&format!("session:{}", backend.origin)).unwrap(), r#"{"sid":"abc123"}"#);

        forward(&backend.origin, &secrets, &at("GET", "/api/auth/me"));
        assert!(backend.seen.lock().unwrap()[1].to_lowercase().contains("cookie: sid=abc123"));

        forward(&backend.origin, &secrets, &at("POST", "/api/auth/logout"));
        assert!(secrets.get(&format!("session:{}", backend.origin)).is_none(), "the backend ended it");

        forward(&backend.origin, &secrets, &at("GET", "/api/auth/me"));
        assert!(!backend.seen.lock().unwrap()[3].to_lowercase().contains("cookie:"));
    }

    #[test]
    fn two_backends_never_share_a_session() {
        let one = mock(vec![("200 OK\r\nset-cookie: sid=one; Path=/", "{}")]);
        let other = mock(vec![("200 OK", "{}")]);
        let secrets = Memory::default();
        let get = || request("GET", "tramme://localhost/api/auth/me", &[], "");
        forward(&one.origin, &secrets, &get());
        forward(&other.origin, &secrets, &get());
        assert!(!other.seen.lock().unwrap()[0].to_lowercase().contains("cookie:"));
    }

    #[test]
    fn the_sign_in_with_a_provider_stays_off_and_asks_nothing_of_the_backend() {
        let secrets = Memory::default();
        let get = |path: &str| forward(NOWHERE, &secrets, &request("GET", &format!("tramme://localhost{path}"), &[], ""));
        let providers: serde_json::Value = serde_json::from_slice(get("/api/auth/providers").body()).unwrap();
        assert_eq!(providers, json!({ "google": false, "github": false }));
        assert_eq!(get("/api/auth/google/redirect").status(), 404);
        assert_eq!(get("/api/auth/github/callback?code=x").status(), 404);
        let notice = forward(NOWHERE, &secrets, &request("POST", "tramme://localhost/api/billing/webhook/fake", &[], "{}"));
        assert_eq!(notice.status(), 404);
    }

    #[test]
    fn only_the_accounts_routes_are_sent() {
        let secrets = Memory::default();
        for path in ["/api/projects", "/api/keys", "/api/internal/edge", "/auth/me", "/api"] {
            let res = forward(NOWHERE, &secrets, &request("GET", &format!("tramme://localhost{path}"), &[], ""));
            assert_eq!(res.status(), 404, "{path}");
        }
    }

    #[test]
    fn an_address_that_climbs_out_of_its_place_is_refused() {
        let secrets = Memory::default();
        for path in ["/api/auth/../internal/edge", "/api/auth/%2e%2e/internal/edge", "/api/auth/%2E%2E%2Finternal", "/api/auth/a%5Cb"] {
            let res = forward(NOWHERE, &secrets, &request("GET", &format!("tramme://localhost{path}"), &[], ""));
            assert_eq!(res.status(), 400, "{path}");
        }
    }

    #[test]
    fn a_method_the_backend_does_not_take_is_refused_here() {
        let res = forward(NOWHERE, &Memory::default(), &request("TRACE", "tramme://localhost/api/auth/me", &[], ""));
        assert_eq!(res.status(), 405);
    }

    #[test]
    fn a_backend_that_does_not_answer_is_said_to_be_unreachable() {
        let res = forward(NOWHERE, &Memory::default(), &request("GET", "tramme://localhost/api/auth/me", &[], ""));
        assert_eq!(res.status(), 503);
        assert_eq!(text(&res), r#"{"error":"network"}"#);
    }

    #[test]
    fn a_status_of_the_backend_reaches_the_page_as_it_is() {
        let backend = mock(vec![("409 Conflict\r\ncontent-type: application/json", r#"{"error":"email_taken"}"#)]);
        let res = forward(&backend.origin, &Memory::default(), &request("POST", "tramme://localhost/api/auth/signup", &[], "{}"));
        assert_eq!(res.status(), 409);
        assert_eq!(text(&res), r#"{"error":"email_taken"}"#);
    }

    /// against the real beta backend, by hand: cargo test --lib -- --ignored the_real_beta
    #[test]
    #[ignore = "needs the network and the beta deployment"]
    fn the_real_beta_backend_takes_the_apps_origin() {
        let beta = "https://beta.app.tramme.dev";
        let secrets = Memory::default();
        let me = forward(beta, &secrets, &request("GET", "tramme://localhost/api/auth/me", &[("accept", "application/json")], ""));
        assert_eq!((me.status().as_u16(), text(&me).as_str()), (401, r#"{"error":"signed_out"}"#));
        // a sign-in that fails for what it is (no such account), not for its origin: the backend took the app's
        let login = forward(beta, &secrets, &request("POST", "tramme://localhost/api/auth/login", &[("content-type", "application/json")], r#"{"email":"nobody@example.invalid","password":"not a real password"}"#));
        println!("login of nobody: {} {}", login.status(), text(&login));
        assert!(!text(&login).contains("\"origin\""), "the backend refused the origin: {}", text(&login));
        assert!([400, 401, 422].contains(&login.status().as_u16()), "{}", login.status());
        // the backend keeps a session cookie even for a visitor: nobody is signed in all the same
        let again = forward(beta, &secrets, &request("GET", "tramme://localhost/api/auth/me", &[], ""));
        assert_eq!((again.status().as_u16(), text(&again).as_str()), (401, r#"{"error":"signed_out"}"#));
    }

    #[test]
    fn set_cookie_lines() {
        let now = 1_800_000_000;
        let some = |v: &str| Some(v.to_string());
        assert_eq!(parse_set_cookie("sid=abc; Path=/; HttpOnly", now), Some(("sid".into(), some("abc"))));
        assert_eq!(parse_set_cookie("sid=abc; Max-Age=60", now), Some(("sid".into(), some("abc"))));
        assert_eq!(parse_set_cookie("sid=abc; Max-Age=0", now), Some(("sid".into(), None)));
        assert_eq!(parse_set_cookie("sid=abc; max-age=-1", now), Some(("sid".into(), None)));
        assert_eq!(parse_set_cookie("sid=; Path=/", now), Some(("sid".into(), None)));
        assert_eq!(parse_set_cookie("sid=abc; Expires=Thu, 01 Jan 1970 00:00:00 GMT", now), Some(("sid".into(), None)));
        assert_eq!(parse_set_cookie("sid=abc; Expires=Fri, 01 Jan 2100 00:00:00 GMT", now), Some(("sid".into(), some("abc"))));
        // a value that holds an equals sign (base64) stays whole
        assert_eq!(parse_set_cookie("sid=ab=cd==; Path=/", now), Some(("sid".into(), some("ab=cd=="))));
        assert_eq!(parse_set_cookie("nothing", now), None);
        assert_eq!(parse_set_cookie("=x", now), None);
    }
}
