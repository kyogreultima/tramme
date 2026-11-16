// A dictation heard as it is said, in the app. The web editor opens a WebSocket
// to its Worker's /api/listen (Deepgram Nova-3 on Workers AI) with the browser's
// session cookie; the app's page has neither the cookie nor the app's address.
// So the app opens it here, to the app of this build's environment, with the
// session of the keychain (account.rs), and relays: the microphone's samples come
// from the page through `listen_send`, Deepgram's results go back to it through
// a channel, one JSON text each. The page never sees the session.

use crate::account::{self, BACKEND};
use std::collections::HashMap;
use std::io::ErrorKind;
use std::net::TcpStream;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

/// what the page asks of a listening socket
enum Ask {
    Audio(Vec<u8>),
    /// no more audio: Deepgram says its last words, then closes
    Finish,
}

fn sockets() -> &'static Mutex<HashMap<u32, Sender<Ask>>> {
    static SOCKETS: OnceLock<Mutex<HashMap<u32, Sender<Ask>>>> = OnceLock::new();
    SOCKETS.get_or_init(Default::default)
}

/// the address of the listening route: the app's own, its scheme made a WebSocket's
pub(crate) fn listen_url(origin: &str, language: &str) -> String {
    let ws = origin.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    let lang: String = language.chars().filter(|c| c.is_ascii_alphabetic()).take(8).collect();
    format!("{ws}/api/listen?language={lang}")
}

/// the TCP stream under the socket, read with a short wait so the same thread also writes
fn tcp(socket: &WebSocket<MaybeTlsStream<TcpStream>>) -> Option<&TcpStream> {
    match socket.get_ref() {
        MaybeTlsStream::Plain(s) => Some(s),
        MaybeTlsStream::Rustls(s) => Some(s.get_ref()),
        _ => None,
    }
}

#[tauri::command]
pub fn listen_open(id: u32, language: String, results: Channel<String>) -> Result<(), String> {
    if !account::signed_in() {
        return Err("signed out".into());
    }
    let mut request = listen_url(BACKEND, &language).into_client_request().map_err(|e| e.to_string())?;
    let headers = request.headers_mut();
    headers.insert("origin", BACKEND.parse().map_err(|_| "origin")?);
    if let Some(cookie) = account::session_cookie() {
        headers.insert("cookie", cookie.parse().map_err(|_| "cookie")?);
    }
    let (mut socket, _) = tungstenite::connect(request).map_err(|e| format!("the live transcription did not open: {e}"))?;
    if let Some(stream) = tcp(&socket) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(20)));
    }
    let (asks, waiting) = channel::<Ask>();
    sockets().lock().unwrap().insert(id, asks);
    std::thread::spawn(move || {
        let mut finishing = false;
        loop {
            // what the page sent since, then what Deepgram said
            while let Ok(ask) = waiting.try_recv() {
                let sent = match ask {
                    Ask::Audio(bytes) => socket.send(Message::Binary(bytes.into())),
                    Ask::Finish => {
                        finishing = true;
                        socket.send(Message::Text(r#"{"type":"CloseStream"}"#.into()))
                    }
                };
                if sent.is_err() {
                    break;
                }
            }
            match socket.read() {
                Ok(Message::Text(text)) => {
                    if results.send(text.to_string()).is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                    // the page went away without finishing: the socket goes too
                    if !finishing && !sockets().lock().unwrap().contains_key(&id) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        sockets().lock().unwrap().remove(&id);
        let _ = socket.close(None);
        let _ = results.send(r#"{"type":"Closed"}"#.into());
    });
    Ok(())
}

/// samples of the microphone (16-bit PCM, 16 kHz mono), in base64
#[tauri::command]
pub fn listen_send(id: u32, audio: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(audio).map_err(|e| e.to_string())?;
    let sockets = sockets().lock().unwrap();
    let asks = sockets.get(&id).ok_or("no live transcription open")?;
    asks.send(Ask::Audio(bytes)).map_err(|e| e.to_string())
}

/// the dictation ends: its last words come, then the socket closes
#[tauri::command]
pub fn listen_finish(id: u32) {
    if let Some(asks) = sockets().lock().unwrap().get(&id) {
        let _ = asks.send(Ask::Finish);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_route_is_the_app_s_own_as_a_websocket() {
        assert_eq!(listen_url("https://app.tramme.dev", "fr"), "wss://app.tramme.dev/api/listen?language=fr");
        assert_eq!(listen_url("http://127.0.0.1:8787", "multi"), "ws://127.0.0.1:8787/api/listen?language=multi");
        // nothing but letters reaches the address
        assert_eq!(listen_url("https://app.tramme.dev", "fr&x=../1"), "wss://app.tramme.dev/api/listen?language=frx");
    }
}
