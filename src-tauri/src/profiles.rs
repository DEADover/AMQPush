use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub queue: String,
    pub use_tls: bool,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            name: String::new(),
            host: "127.0.0.1".into(),
            port: 61616,
            username: String::new(),
            password: String::new(),
            queue: "test_queue".into(),
            use_tls: false,
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

pub fn load_all() -> Vec<Profile> {
    let path = profiles_path();
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    let map: HashMap<String, Profile> = serde_json::from_str(&data).unwrap_or_default();
    let mut list: Vec<Profile> = map.into_values().collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

pub fn save(profile: Profile) -> Result<(), String> {
    let path = profiles_path();
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    let mut map: HashMap<String, Profile> = serde_json::from_str(&data).unwrap_or_default();
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
