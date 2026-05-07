use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub name: String,
    pub address: String,
    pub body: String,
    pub properties: HashMap<String, String>,
}

fn path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".amqpush")
        .join("templates.json")
}

pub fn load_all() -> Vec<Template> {
    fs::read_to_string(path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_all(templates: &[Template]) {
    let p = path();
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&p, serde_json::to_string_pretty(templates).unwrap_or_default());
}

pub fn save(template: Template) {
    let mut all = load_all();
    if let Some(pos) = all.iter().position(|t| t.name == template.name) {
        all[pos] = template;
    } else {
        all.push(template);
    }
    save_all(&all);
}

pub fn delete(name: &str) {
    let all: Vec<Template> = load_all().into_iter().filter(|t| t.name != name).collect();
    save_all(&all);
}
