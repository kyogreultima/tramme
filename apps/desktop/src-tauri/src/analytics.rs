// Audience measurement in the desktop app (Google Analytics 4), opt-in. The
// page loads nothing of Google's: it tells this side what happened
// (apps/editor/src/analytics.ts) and this side sends the event through GA4's
// Measurement Protocol, after the user's yes, which it keeps itself
// (desktop.json) so the page cannot say yes for them. It is an option of the
// settings, off until turned on; the app never asks by itself.
//
// Nothing is measured, whatever the option says, unless the build is the
// production one (build.rs: TRAMME_ENV unset or `production`, a release build)
// and has the Measurement Protocol's API secret (TRAMME_GA_API_SECRET, a
// variable of the build, never in the repository). A beta build, `tauri dev`
// and a build from source stay silent.
//
// Only the name of an event and a few plain values (a page, a feature) are
// sent, with a random id of this installation and the app's version; never a
// project, a key, a path or what is said to the assistant. Saying no (or
// changing one's mind) forgets the installation's id.

use crate::store::{read_setting, settings_path, write_setting};
use rand::Rng;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// the property's measurement id (build.rs reads it from brand/analytics.ts, the one place it is written)
const MEASUREMENT_ID: &str = env!("TRAMME_MEASUREMENT_ID");
/// the environment this build is for (build.rs)
const ENVIRONMENT: &str = env!("TRAMME_ENV_NAME");
const API_SECRET: Option<&str> = option_env!("TRAMME_GA_API_SECRET");
const AGENT: &str = concat!("TrammeDesktop/", env!("CARGO_PKG_VERSION"));

/// whether this build is measured at all
pub fn available() -> bool {
    ENVIRONMENT == "production" && !cfg!(debug_assertions) && API_SECRET.is_some_and(|s| !s.is_empty())
}

fn choice() -> Option<bool> {
    read_setting(&settings_path()?, "analytics")?.as_bool()
}

/// the person's choice (null while there is none); kept in every build, so the setting can be tried, counted only in a measured one
#[tauri::command]
pub fn analytics_state() -> Value {
    json!({ "choice": choice() })
}

#[tauri::command]
pub fn analytics_set(granted: bool) -> Result<(), String> {
    let path = settings_path().ok_or("no settings folder on this machine")?;
    write_setting(&path, "analytics", json!(granted)).map_err(|e| e.message)?;
    // a no forgets this installation: a later yes is a new one
    if !granted {
        write_setting(&path, "analytics_client", Value::Null).map_err(|e| e.message)?;
    }
    Ok(())
}

/// an event of the page; dropped, silently, unless measured and accepted
#[tauri::command]
pub fn analytics_event(name: String, params: Map<String, Value>) {
    if !available() || choice() != Some(true) {
        return;
    }
    let Some(path) = settings_path() else { return };
    let client = match read_setting(&path, "analytics_client").and_then(|v| v.as_str().map(str::to_string)) {
        Some(id) => id,
        None => {
            let id = new_client_id();
            if write_setting(&path, "analytics_client", json!(id)).is_err() {
                return;
            }
            id
        }
    };
    let Some(body) = payload(&client, session(), &name, &params) else { return };
    let url = format!("https://www.google-analytics.com/mp/collect?measurement_id={MEASUREMENT_ID}&api_secret={}", API_SECRET.unwrap_or_default());
    // off the caller's thread: a slow network must not slow the app
    std::thread::spawn(move || {
        let _ = agent().post(&url).set("content-type", "application/json").send_string(&body.to_string());
    });
}

fn agent() -> &'static ureq::Agent {
    static CELL: OnceLock<ureq::Agent> = OnceLock::new();
    CELL.get_or_init(|| ureq::AgentBuilder::new().user_agent(AGENT).timeout(Duration::from_secs(10)).redirects(0).build())
}

/// a session is one launch of the app
fn session() -> u64 {
    static START: OnceLock<u64> = OnceLock::new();
    *START.get_or_init(|| SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
}

/// a random id for this installation, in the shape GA4 uses
fn new_client_id() -> String {
    let mut rng = rand::thread_rng();
    format!("{}.{}", rng.gen_range(1_000_000_000u64..=9_999_999_999), rng.gen_range(1_000_000_000u64..=9_999_999_999))
}

/// an event's name as GA4 takes it: lowercase letters, digits and underscores, starting with a letter, at most 40
fn valid_name(name: &str) -> bool {
    (1..=40).contains(&name.len()) && name.starts_with(|c: char| c.is_ascii_lowercase()) && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// the Measurement Protocol's body for one event: only plain values (text of at most 100 characters, numbers, booleans) of well-named parameters, plus the app's version and system
fn payload(client: &str, session: u64, name: &str, params: &Map<String, Value>) -> Option<Value> {
    if !valid_name(name) {
        return None;
    }
    let mut kept = Map::new();
    for (key, value) in params.iter().take(10) {
        if !valid_name(key) {
            continue;
        }
        match value {
            Value::String(s) => {
                kept.insert(key.clone(), json!(s.chars().take(100).collect::<String>()));
            }
            Value::Number(_) | Value::Bool(_) => {
                kept.insert(key.clone(), value.clone());
            }
            _ => {}
        }
    }
    kept.insert("session_id".into(), json!(session));
    kept.insert("engagement_time_msec".into(), json!(1));
    kept.insert("app_version".into(), json!(env!("CARGO_PKG_VERSION")));
    kept.insert("platform".into(), json!(std::env::consts::OS));
    Some(json!({ "client_id": client, "events": [{ "name": name, "params": kept }] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn names_are_ga4_names() {
        assert!(valid_name("page_view"));
        assert!(!valid_name("Page View"));
        assert!(!valid_name("1st"));
        assert!(!valid_name(""));
        assert!(!valid_name(&"a".repeat(41)));
    }

    #[test]
    fn an_event_carries_plain_values_only() {
        let body = payload("1.2", 7, "page_view", &params(json!({ "page_path": "/space", "bad key": "x", "nested": { "a": 1 }, "n": 3, "list": [1] }))).unwrap();
        let p = &body["events"][0]["params"];
        assert_eq!(body["client_id"], "1.2");
        assert_eq!(p["page_path"], "/space");
        assert_eq!(p["n"], 3);
        assert_eq!(p["session_id"], 7);
        assert!(p.get("bad key").is_none() && p.get("nested").is_none() && p.get("list").is_none());
    }

    #[test]
    fn a_long_text_is_cut_and_a_bad_name_sends_nothing() {
        let body = payload("1.2", 7, "export_done", &params(json!({ "page_title": "x".repeat(300) }))).unwrap();
        assert_eq!(body["events"][0]["params"]["page_title"].as_str().unwrap().len(), 100);
        assert!(payload("1.2", 7, "Not valid", &Map::new()).is_none());
    }

    #[test]
    fn a_client_id_has_two_numbers() {
        let id = new_client_id();
        let parts: Vec<&str> = id.split('.').collect();
        assert_eq!(parts.len(), 2);
        assert!(parts.iter().all(|p| p.len() == 10 && p.chars().all(|c| c.is_ascii_digit())));
    }

    #[test]
    fn a_debug_build_is_never_measured() {
        assert!(!available());
    }
}
