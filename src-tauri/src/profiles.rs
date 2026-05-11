use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

/// Current schema version for `Profile`. Bump when a breaking change to the
/// on-disk shape requires per-record translation (a field renames, a value
/// remaps, a field gets a different meaning). Add a match arm in
/// `migrate_profile` to translate prev → current.
///
/// Files saved by older AMQPush versions get migrated lazily on load
/// (`migrate_profile` runs in a loop until `version == CURRENT_VERSION`) and
/// the upgraded shape is written back on the next `save` — no separate
/// "migration command", users don't have to think about it.
pub const CURRENT_VERSION: u32 = 1;

fn default_version() -> u32 { 1 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    /// On-disk schema version. Missing in pre-versioning files; defaults to
    /// `1` so they're treated as the original shape.
    #[serde(default = "default_version")]
    pub version: u32,

    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub queue: String,
    #[serde(default)]
    pub use_tls: bool,

    // Advanced options — added later, default to "off"/"auto" so old
    // profiles without these keys keep loading.
    #[serde(default)]
    pub container_id: String,            // empty = autogenerate
    #[serde(default)]
    pub heartbeat_secs: u32,             // 0 = no idle-timeout
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u32,       // 0 = no timeout (block until connected)
    #[serde(default)]
    pub tls_skip_verify: bool,           // self-signed certs (insecure)
    #[serde(default)]
    pub sasl_anonymous: bool,            // force ANONYMOUS even with creds in form

    /// User-defined grouping label, e.g. "Dev" / "Staging" / "Prod" or per
    /// service / project. Profiles are sorted under their workspace in the
    /// global picker and the Cmd+K palette. Empty / missing → "Default".
    #[serde(default = "default_workspace")]
    pub workspace: String,

    /// Catch-all for fields not modelled here. Without it, hand-edited custom
    /// keys (or fields from a newer AMQPush version) would be silently dropped
    /// on the first `save_profile`. With `#[serde(flatten)]` they ride
    /// through load → save round-trips intact.
    #[serde(flatten, default)]
    pub extra: HashMap<String, Value>,
}

fn default_connect_timeout() -> u32 { 10 }
fn default_workspace() -> String { "Default".into() }

impl Default for Profile {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            name: String::new(),
            host: "127.0.0.1".into(),
            port: 61616,
            username: String::new(),
            password: String::new(),
            queue: String::new(),
            use_tls: false,
            container_id: String::new(),
            heartbeat_secs: 0,
            connect_timeout_secs: 10,
            tls_skip_verify: false,
            sasl_anonymous: false,
            workspace: default_workspace(),
            extra: HashMap::new(),
        }
    }
}

fn profiles_path() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".amqpush");
    std::fs::create_dir_all(&dir).ok();
    dir.join("profiles.json")
}

/// Step a single `Profile` forward one schema version at a time until it
/// reaches `CURRENT_VERSION`. Currently a no-op because v1 is the only
/// version in the wild — but the match block is ready for future bumps:
/// each new version adds an arm that mutates `p` and increments `p.version`.
fn migrate_profile(p: &mut Profile) {
    while p.version < CURRENT_VERSION {
        match p.version {
            // Example shape for future migrations:
            // 1 => { ...translate v1 → v2 here...; p.version = 2 }
            _ => {
                // Unknown version (newer than this build understands, or a
                // gap in the chain). Bail; the profile loads as-is but won't
                // be migrated further.
                eprintln!("profile '{}': unknown version {}, skipping migration", p.name, p.version);
                break;
            }
        }
    }
}

pub fn load_all() -> Vec<Profile> {
    let path = profiles_path();
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    let map: HashMap<String, Profile> = serde_json::from_str(&data).unwrap_or_default();
    let mut list: Vec<Profile> = map.into_values().collect();
    for p in list.iter_mut() {
        migrate_profile(p);
    }
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

pub fn save(mut profile: Profile) -> Result<(), String> {
    let path = profiles_path();
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    let mut map: HashMap<String, Profile> = serde_json::from_str(&data).unwrap_or_default();
    // Preserve unknown fields ('extra') from the on-disk version — the
    // frontend doesn't model them but a user (or a future AMQPush version)
    // may have set them. Without this merge, save_profile silently wipes
    // custom keys on the first round-trip.
    if profile.extra.is_empty() {
        if let Some(existing) = map.get_mut(&profile.name) {
            profile.extra = std::mem::take(&mut existing.extra);
        }
    }
    map.insert(profile.name.clone(), profile);
    std::fs::write(&path, serde_json::to_string_pretty(&map).unwrap())
        .map_err(|e| e.to_string())
}

pub fn delete(name: &str) -> Result<(), String> {
    let path = profiles_path();
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    let mut map: HashMap<String, Profile> = serde_json::from_str(&data).unwrap_or_default();
    map.remove(name);
    std::fs::write(&path, serde_json::to_string_pretty(&map).unwrap())
        .map_err(|e| e.to_string())
}
