// The providers' keys of the desktop app, in the system keychain (the Windows
// Credential Manager, the macOS Keychain, the Secret Service on Linux), one
// entry per provider: never in a file, never in the page. The editor sends a
// key once, on the routes of packages/api keys.ts (same checks, same answers),
// and then only learns which providers are connected (/api/config). The custom
// providers' names and addresses, which are not secret, stay in the app's
// settings; their keys in the keychain too, as `custom:<id>`. The settings a
// provider takes next to its key (Hydracept: its project) are not secret
// either: they stay in the app's settings.
//
//   PUT    /api/keys/:provider        {key, ...fields}      connect a provider (or change its key)
//   DELETE /api/keys/:provider                              disconnect it
//   PUT    /api/keys/custom/:id       {label, base, key?}   add or change a custom provider (key kept when absent)
//   DELETE /api/keys/custom/:id                             remove it
//   DELETE /api/keys                                        forget every key and custom provider

use crate::store::{self, http_err, HttpError, Res};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// the providers of packages/api, built into the app: never read from the page, which could send a key elsewhere
const KEYED: &str = include_str!("../../../../packages/api/src/keyed-providers.json");

/// a provider: where it answers (a key goes nowhere else) and the settings it takes next to its key
#[derive(Debug, Deserialize)]
pub struct Provider {
    pub origin: String,
    #[serde(default)]
    pub fields: Vec<Field>,
}

#[derive(Debug, Deserialize)]
pub struct Field {
    pub name: String,
    #[serde(default)]
    pub required: bool,
}

pub fn providers() -> &'static BTreeMap<String, Provider> {
    static LIST: OnceLock<BTreeMap<String, Provider>> = OnceLock::new();
    LIST.get_or_init(|| serde_json::from_str(KEYED).expect("packages/api/src/keyed-providers.json"))
}

const SERVICE: &str = "tramme";

/// the changes of the keys, one at a time (each request runs on its own thread)
static CHANGING: Mutex<()> = Mutex::new(());

/// where the secrets are kept: the keychain, or memory in the tests
pub trait Secrets: Send + Sync {
    fn get(&self, slot: &str) -> Option<String>;
    fn set(&self, slot: &str, key: &str) -> Res<()>;
    fn delete(&self, slot: &str) -> Res<()>;
}

/// the system keychain
pub struct Keychain;

fn keychain_err(e: keyring::Error) -> HttpError {
    eprintln!("desktop: keychain error: {e}");
    HttpError { status: 500, message: "the system keychain refused the key".into() }
}

impl Secrets for Keychain {
    fn get(&self, slot: &str) -> Option<String> {
        keyring::Entry::new(SERVICE, slot).ok()?.get_password().ok().filter(|k| !k.is_empty())
    }
    fn set(&self, slot: &str, key: &str) -> Res<()> {
        keyring::Entry::new(SERVICE, slot).and_then(|e| e.set_password(key)).map_err(keychain_err)
    }
    fn delete(&self, slot: &str) -> Res<()> {
        match keyring::Entry::new(SERVICE, slot).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_err(e)),
        }
    }
}

static KEYCHAIN: Keychain = Keychain;

/// a provider of the OpenAI chat format added by the user
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Custom {
    pub id: String,
    pub label: String,
    pub base: String,
}

pub struct KeyStore {
    secrets: &'static dyn Secrets,
    /// the settings file that lists the custom providers
    settings: PathBuf,
}

/// the origin of an http(s) address (scheme, host, port), the way a browser compares them
pub fn origin(address: &str) -> Option<String> {
    let url = url::Url::parse(address).ok()?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

fn valid_custom_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && id.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// a key as typed: one line, without spaces around it
fn key_of(v: Option<&Value>, required: bool) -> Res<Option<String>> {
    let k = v.and_then(Value::as_str).unwrap_or("").trim();
    if k.is_empty() {
        return if required { http_err(400, "the key is missing") } else { Ok(None) };
    }
    if k.chars().count() > 1000 || k.chars().any(char::is_whitespace) {
        return http_err(400, "this does not look like a key (one word, without spaces)");
    }
    Ok(Some(k.to_string()))
}

/// a setting typed next to a key: one short line
fn field_of(v: Option<&Value>) -> Res<Option<String>> {
    let k = v.and_then(Value::as_str).unwrap_or("").trim();
    if k.is_empty() {
        return Ok(None);
    }
    if k.chars().count() > 200 || k.chars().any(char::is_whitespace) {
        return http_err(400, "this setting is one word, without spaces");
    }
    Ok(Some(k.to_string()))
}

/// an address of the chat format, without its trailing slash
fn base_of(v: Option<&Value>) -> Res<String> {
    let raw = v.and_then(Value::as_str).unwrap_or("").trim().trim_end_matches('/');
    let Ok(url) = url::Url::parse(raw) else { return http_err(400, "the address is not a URL (https://…/v1)") };
    if url.scheme() != "https" && url.scheme() != "http" {
        return http_err(400, "the address must start with https://");
    }
    Ok(raw.to_string())
}

impl KeyStore {
    /// the keys of the app: the system keychain, the custom providers in the app's settings
    pub fn system() -> Res<KeyStore> {
        let Some(settings) = store::settings_path() else { return http_err(500, "no settings folder on this machine") };
        Ok(KeyStore { secrets: &KEYCHAIN, settings })
    }

    #[cfg(test)]
    pub fn with(secrets: &'static dyn Secrets, settings: PathBuf) -> KeyStore {
        KeyStore { secrets, settings }
    }

    pub fn customs(&self) -> Vec<Custom> {
        store::read_setting(&self.settings, "custom").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    }

    fn save_customs(&self, list: &[Custom]) -> Res<()> {
        store::write_setting(&self.settings, "custom", json!(list))
    }

    /// the settings of the providers, by provider: `{"hydracept": {"project": "cpr_…"}}`
    pub fn fields(&self) -> Map<String, Value> {
        store::read_setting(&self.settings, "fields").and_then(|v| v.as_object().cloned()).unwrap_or_default()
    }

    fn save_fields(&self, fields: Map<String, Value>) -> Res<()> {
        store::write_setting(&self.settings, "fields", Value::Object(fields))
    }

    /// whether a provider is connected: its key, and the settings it needs (packages/api loadKeys)
    fn connected(&self, p: &str, provider: &Provider, fields: &Map<String, Value>) -> bool {
        self.key(p).is_some() && provider.fields.iter().all(|f| !f.required || fields.get(p).and_then(|v| v.get(&f.name)).is_some())
    }

    /// the key of a provider (`openai`…) or of a custom one (`custom:<id>`)
    pub fn key(&self, slot: &str) -> Option<String> {
        self.secrets.get(slot)
    }

    /// where the key of this slot may go: its provider's origin, or the custom provider's address
    pub fn origin_of(&self, slot: &str) -> Option<String> {
        if let Some(id) = slot.strip_prefix("custom:") {
            return self.customs().into_iter().find(|c| c.id == id).and_then(|c| origin(&c.base));
        }
        providers().get(slot).map(|p| p.origin.clone())
    }

    /// what the page may know (packages/api KeyStatus): which providers are connected and their settings, never their keys
    pub fn status(&self) -> Value {
        let fields = self.fields();
        let providers: Map<String, Value> = providers()
            .iter()
            .map(|(p, provider)| (p.clone(), if self.connected(p, provider, &fields) { json!("settings") } else { Value::Null }))
            .collect();
        let custom: Vec<Value> = self
            .customs()
            .into_iter()
            .map(|c| {
                let key = self.key(&format!("custom:{}", c.id)).is_some();
                json!({ "id": c.id, "label": c.label, "base": c.base, "key": key })
            })
            .collect();
        json!({ "providers": providers, "fields": fields, "custom": custom })
    }

    /// a request of /api/keys (parts: the decoded path after /api/keys/)
    pub fn route(&self, method: &str, parts: &[String], body: &[u8]) -> Res<Value> {
        let _one = CHANGING.lock().unwrap_or_else(|e| e.into_inner());
        let read = || serde_json::from_slice::<Value>(body).map_err(|_| HttpError { status: 400, message: "unreadable JSON body".into() });
        let customs = self.customs();
        match (parts.first().map(String::as_str), parts.get(1).map(String::as_str), parts.len(), method) {
            (None, _, _, "DELETE") => {
                for p in providers().keys() {
                    self.secrets.delete(p)?;
                }
                for c in &customs {
                    self.secrets.delete(&format!("custom:{}", c.id))?;
                }
                self.save_customs(&[])?;
                self.save_fields(Map::new())?;
                Ok(json!({ "deleted": "all" }))
            }
            (Some("custom"), Some(id), 2, _) => {
                if !valid_custom_id(id) {
                    return http_err(400, "custom provider id: lower case letters, digits and -");
                }
                let slot = format!("custom:{id}");
                match method {
                    "DELETE" => {
                        self.secrets.delete(&slot)?;
                        self.save_customs(&customs.into_iter().filter(|c| c.id != id).collect::<Vec<_>>())?;
                        Ok(json!({ "deleted": id }))
                    }
                    "PUT" => {
                        let b = read()?;
                        let label: String = b.get("label").and_then(Value::as_str).unwrap_or("").trim().chars().take(40).collect();
                        if label.is_empty() {
                            return http_err(400, "the provider needs a name");
                        }
                        let custom = Custom { id: id.to_string(), label, base: base_of(b.get("base"))? };
                        if let Some(key) = key_of(b.get("key"), false)? {
                            self.secrets.set(&slot, &key)?;
                        }
                        let mut list = customs;
                        match list.iter_mut().find(|c| c.id == id) {
                            Some(c) => *c = custom.clone(),
                            None => list.push(custom.clone()),
                        }
                        self.save_customs(&list)?;
                        let key = self.key(&slot).is_some();
                        Ok(json!({ "id": id, "label": custom.label, "base": custom.base, "key": key }))
                    }
                    _ => http_err(404, "unknown keys route"),
                }
            }
            (Some(p), None, 1, _) if p != "custom" => {
                let Some(provider) = providers().get(p) else { return http_err(404, format!("unknown provider: {p}")) };
                let mut fields = self.fields();
                match method {
                    "DELETE" => {
                        self.secrets.delete(p)?;
                        if fields.remove(p).is_some() {
                            self.save_fields(fields)?;
                        }
                        Ok(json!({ "deleted": p }))
                    }
                    "PUT" => {
                        let b = read()?;
                        let key = key_of(b.get("key"), true)?.unwrap_or_default();
                        let mut values = Map::new();
                        for f in &provider.fields {
                            match field_of(b.get(&f.name))? {
                                Some(v) => {
                                    values.insert(f.name.clone(), json!(v));
                                }
                                None if f.required => return http_err(400, format!("{p} needs its {}", f.name)),
                                None => {}
                            }
                        }
                        self.secrets.set(p, &key)?;
                        fields.remove(p);
                        if !values.is_empty() {
                            fields.insert(p.to_string(), Value::Object(values));
                        }
                        self.save_fields(fields)?;
                        Ok(json!({ "provider": p }))
                    }
                    _ => http_err(404, "unknown keys route"),
                }
            }
            _ => http_err(404, "unknown keys route"),
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::collections::HashMap;

    /// the keychain of a test, in memory
    #[derive(Default)]
    pub struct Memory(Mutex<HashMap<String, String>>);

    impl Secrets for Memory {
        fn get(&self, slot: &str) -> Option<String> {
            self.0.lock().unwrap().get(slot).cloned()
        }
        fn set(&self, slot: &str, key: &str) -> Res<()> {
            self.0.lock().unwrap().insert(slot.into(), key.into());
            Ok(())
        }
        fn delete(&self, slot: &str) -> Res<()> {
            self.0.lock().unwrap().remove(slot);
            Ok(())
        }
    }

    /// a store over a fresh memory and a settings file of its own
    pub fn memory_store(dir: &tempfile::TempDir) -> KeyStore {
        KeyStore::with(Box::leak(Box::default()) as &'static Memory, dir.path().join("desktop.json"))
    }

    fn parts(path: &str) -> Vec<String> {
        path.split('/').filter(|s| !s.is_empty()).map(String::from).collect()
    }

    #[test]
    fn a_key_is_kept_and_only_its_presence_told() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        assert_eq!(keys.route("PUT", &parts("openai"), br#"{"key":"  sk-test  "}"#).unwrap(), json!({ "provider": "openai" }));
        assert_eq!(keys.key("openai").as_deref(), Some("sk-test"));
        let status = keys.status();
        assert_eq!(status["providers"]["openai"], json!("settings"));
        assert_eq!(status["providers"]["anthropic"], Value::Null);
        assert!(!status.to_string().contains("sk-test"));
        keys.route("DELETE", &parts("openai"), b"").unwrap();
        assert_eq!(keys.key("openai"), None);
    }

    #[test]
    fn keys_are_checked_as_the_server_does() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        assert_eq!(keys.route("PUT", &parts("openai"), br#"{}"#).unwrap_err().message, "the key is missing");
        assert_eq!(keys.route("PUT", &parts("openai"), br#"{"key":"a b"}"#).unwrap_err().status, 400);
        assert_eq!(keys.route("PUT", &parts("nobody"), br#"{"key":"k"}"#).unwrap_err().status, 404);
        assert_eq!(keys.route("PUT", &parts("openai"), b"not json").unwrap_err().message, "unreadable JSON body");
        assert_eq!(keys.route("PUT", &parts("custom/Bad_Id"), br#"{"label":"x","base":"https://x"}"#).unwrap_err().status, 400);
        assert_eq!(keys.route("PUT", &parts("custom/x"), br#"{"label":"","base":"https://x"}"#).unwrap_err().message, "the provider needs a name");
        assert_eq!(keys.route("PUT", &parts("custom/x"), br#"{"label":"X","base":"ftp://x"}"#).unwrap_err().status, 400);
    }

    #[test]
    fn custom_providers_keep_their_key_when_none_is_sent() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        let made = keys.route("PUT", &parts("custom/lab"), br#"{"label":"Lab","base":"https://lab.example/v1///","key":"k1"}"#).unwrap();
        assert_eq!(made, json!({ "id": "lab", "label": "Lab", "base": "https://lab.example/v1", "key": true }));
        let renamed = keys.route("PUT", &parts("custom/lab"), br#"{"label":"Lab 2","base":"https://lab.example/v1"}"#).unwrap();
        assert_eq!(renamed["key"], json!(true));
        assert_eq!(keys.key("custom:lab").as_deref(), Some("k1"));
        assert_eq!(keys.customs().len(), 1);
        assert_eq!(keys.origin_of("custom:lab").as_deref(), Some("https://lab.example"));
        keys.route("DELETE", &parts("custom/lab"), b"").unwrap();
        assert!(keys.customs().is_empty());
        assert_eq!(keys.key("custom:lab"), None);
    }

    #[test]
    fn forgetting_everything() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        keys.route("PUT", &parts("anthropic"), br#"{"key":"a"}"#).unwrap();
        keys.route("PUT", &parts("custom/lab"), br#"{"label":"Lab","base":"http://localhost:1234/v1","key":"k"}"#).unwrap();
        assert_eq!(keys.route("DELETE", &[], b"").unwrap(), json!({ "deleted": "all" }));
        assert_eq!(keys.key("anthropic"), None);
        assert_eq!(keys.key("custom:lab"), None);
        assert!(keys.customs().is_empty());
    }

    #[test]
    fn a_provider_keeps_its_settings_next_to_its_key() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        assert_eq!(keys.route("PUT", &parts("hydracept"), br#"{"key":"hk"}"#).unwrap_err().message, "hydracept needs its project");
        assert_eq!(keys.route("PUT", &parts("hydracept"), br#"{"key":"hk","project":"a b"}"#).unwrap_err().status, 400);
        assert_eq!(keys.key("hydracept"), None);
        keys.route("PUT", &parts("hydracept"), br#"{"key":"hk","project":" cpr_1 ","environment":"","other":"x"}"#).unwrap();
        let status = keys.status();
        assert_eq!(status["providers"]["hydracept"], json!("settings"));
        assert_eq!(status["fields"], json!({ "hydracept": { "project": "cpr_1" } }));
        assert!(!status.to_string().contains("\"hk\""));
        keys.route("DELETE", &parts("hydracept"), b"").unwrap();
        assert_eq!(keys.key("hydracept"), None);
        assert!(keys.fields().is_empty());
    }

    #[test]
    fn a_key_without_the_settings_it_needs_is_not_connected() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        keys.secrets.set("hydracept", "hk").unwrap();
        assert_eq!(keys.status()["providers"]["hydracept"], Value::Null);
    }

    #[test]
    fn where_each_key_may_go() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        assert_eq!(keys.origin_of("anthropic").as_deref(), Some("https://api.anthropic.com"));
        assert_eq!(keys.origin_of("hydracept").as_deref(), Some("https://api.hydracept.com"));
        assert!(providers().values().all(|p| origin(&p.origin).as_deref() == Some(p.origin.as_str())));
        assert_eq!(keys.origin_of("custom:none"), None);
        assert_eq!(keys.origin_of("nobody"), None);
        assert_eq!(origin("https://API.openai.com:443/v1/x").as_deref(), Some("https://api.openai.com"));
        assert_eq!(origin("https://api.openai.com@evil.example/").as_deref(), Some("https://evil.example"));
        assert_eq!(origin("file:///c:/x"), None);
    }
}
