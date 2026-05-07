//! On-disk persistence for the send history. Uses the same `~/.amqpush/`
//! directory as profiles/queues/templates. Best-effort: any I/O failures are
//! silently logged to stderr without breaking the send flow.

use crate::amqp::HistoryEntry;
use std::path::PathBuf;

fn history_path() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".amqpush");
    std::fs::create_dir_all(&dir).ok();
    dir.join("history.json")
}

pub fn load() -> Vec<HistoryEntry> {
    let path = history_path();
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save(history: &[HistoryEntry]) {
    let path = history_path();
    match serde_json::to_string_pretty(history) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                eprintln!("history: save failed: {e}");
            }
        }
        Err(e) => eprintln!("history: serialize failed: {e}"),
    }
}
