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

    // ── Optional fields added in v1.2 — older saved templates won't have
    //    them, so each one is `#[serde(default)]` for backward compat. ──

    /// Saved Raw subtype (`text` / `json` / `xml`). When `None`, the
    /// auto-detect on load will pick from body content.
    #[serde(default)]
    pub raw_type: Option<String>,

    /// Whether the Batch toggle was on when the template was saved.
    #[serde(default)]
    pub batch_enabled: Option<bool>,
    #[serde(default)]
    pub repeat: Option<u32>,
    #[serde(default)]
    pub delay_ms: Option<u32>,

    /// Whether the Schedule toggle was on (delayed first send).
    #[serde(default)]
    pub schedule_enabled: Option<bool>,
    #[serde(default)]
    pub schedule_delay_secs: Option<u32>,

    /// Whether the Reply (request-reply) toggle was on when saved.
    #[serde(default)]
    pub reply_enabled: Option<bool>,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub reply_timeout_ms: Option<u32>,

    /// User-defined variables from the Variables tab. Each entry mirrors the
    /// `UserVariable` shape on the frontend.
    #[serde(default)]
    pub user_vars: Vec<TemplateVariable>,

    /// JavaScript pre-script source. Runs before each send to compute
    /// dynamic variable values. Empty / `None` → no script.
    #[serde(default)]
    pub pre_script: Option<String>,

    /// JSON Schema source — body is validated against this when subtype is JSON.
    /// Kept for backward compat with templates saved before XSD support landed;
    /// new saves use `body_schema_json` instead.
    #[serde(default)]
    pub body_schema: Option<String>,

    /// JSON Schema source for the JSON Raw subtype.
    #[serde(default)]
    pub body_schema_json: Option<String>,
    /// XSD (XML Schema) source for the XML Raw subtype.
    #[serde(default)]
    pub body_schema_xsd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateVariable {
    pub enabled: bool,
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub description: String,
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

/// Rename a template in place. Returns `Err` if the new name is empty, the
/// old name doesn't exist, or another template already uses the new name —
/// callers surface those as user-facing validation errors.
pub fn rename(old_name: &str, new_name: &str) -> Result<(), String> {
    let new_trim = new_name.trim();
    if new_trim.is_empty() {
        return Err("New name cannot be empty".into());
    }
    if old_name == new_trim {
        return Ok(()); // no-op
    }
    let mut all = load_all();
    if all.iter().any(|t| t.name == new_trim) {
        return Err(format!("Template '{new_trim}' already exists"));
    }
    let pos = all.iter().position(|t| t.name == old_name)
        .ok_or_else(|| format!("Template '{old_name}' not found"))?;
    all[pos].name = new_trim.to_string();
    save_all(&all);
    Ok(())
}
