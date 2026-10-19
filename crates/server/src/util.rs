use std::collections::HashMap;

use axum::http::HeaderMap;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub fn random_token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    hex(&b)
}

pub fn random_suffix(n: usize) -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    for word in s.split_whitespace() {
        let w: String = word
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_lowercase();
        if !w.is_empty() {
            if !out.is_empty() {
                out.push('-');
            }
            out.push_str(&w);
        }
    }
    let trimmed: String = out.chars().take(40).collect();
    if trimmed.is_empty() {
        "event".into()
    } else {
        trimmed
    }
}

pub fn parse_cookies(headers: &HeaderMap) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for v in headers.get_all(axum::http::header::COOKIE) {
        let Ok(s) = v.to_str() else { continue };
        for pair in s.split(';') {
            if let Some((k, v)) = pair.split_once('=') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    map
}

pub fn pin_cookie_name(event_id: &str) -> String {
    let clean: String = event_id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    format!("wspin_{}", &clean[..clean.len().min(12)])
}

/// Keyed hash used for PIN verification cookies. Secret is server-side only.
pub fn keyed_hash(secret: &str, value: &str) -> String {
    blake3::hash(format!("{secret}|{value}").as_bytes()).to_hex().to_string()
}

pub fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    v.strip_prefix("Bearer ").map(|s| s.trim().to_string())
}

/// Short photographer id from the saved hub machine session (written by the
/// desktop app). Used to prefix new event slugs so every guest link carries
/// the photographer's identity: {short}-{folder}-{rand}.
pub fn machine_short_id(data_dir: &std::path::Path) -> String {
    let Ok(text) = std::fs::read_to_string(data_dir.join("machine-session.json")) else {
        return String::new();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return String::new();
    };
    v["short_id"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect()
}

/// Best-effort LAN IP (the source address a route to the internet would use)
/// — shown in the desktop app so the photographer can type host:port into
/// the camera's FTP settings. No packet is actually sent.
pub fn lan_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

/// The machine token from the saved hub session — photographer-side routes
/// trust proxied admin-lite actions (rename/cover) that carry it.
pub fn machine_token(data_dir: &std::path::Path) -> String {
    let Ok(text) = std::fs::read_to_string(data_dir.join("machine-session.json")) else {
        return String::new();
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v["token"].as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

/// Constant-time-ish equality for token comparison.
pub fn token_matches(a: &str, b: &str) -> bool {
    if a.is_empty() || a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
