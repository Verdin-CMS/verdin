//! `plugin.toml`: what a plugin is, what it may do and what it hooks into.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::PluginError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    /// `[a-z0-9-]`, unique: the plugin's id in URLs, settings and custom fields.
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    /// The module, relative to the plugin directory.
    #[serde(default = "default_wasm")]
    pub wasm: String,
    /// Give the module WASI (clock, random; no files or sockets).
    #[serde(default)]
    pub wasi: bool,
    #[serde(default)]
    pub capabilities: Capabilities,
    #[serde(default)]
    pub limits: Limits,
    #[serde(default)]
    pub hooks: Vec<Hook>,
    pub routes: Option<Routes>,
    #[serde(default)]
    pub jobs: Vec<Job>,
    /// Root fields of the GraphQL API resolved by the plugin.
    #[serde(default)]
    pub graphql: Vec<GraphqlField>,
    #[serde(default)]
    pub admin: Admin,
    /// The settings form in Settings → Plugins (without it, settings are free JSON).
    #[serde(default)]
    pub settings: Vec<Setting>,
}

fn default_wasm() -> String {
    "plugin.wasm".into()
}

/// What the plugin's host calls may touch.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Capabilities {
    /// Content types it may read (`api::article`, or `*`).
    #[serde(default)]
    pub read: Vec<String>,
    /// Content types it may create, update, publish and delete.
    #[serde(default)]
    pub write: Vec<String>,
    /// Hosts it may call over HTTP (`api.example.com`, `*.example.com`).
    #[serde(default)]
    pub http: Vec<String>,
    /// Its own key-value storage.
    #[serde(default)]
    pub kv: bool,
}

impl Capabilities {
    fn allows(list: &[String], uid: &str) -> bool {
        list.iter().any(|entry| entry == "*" || entry == uid)
    }

    pub fn can_read(&self, uid: &str) -> bool {
        Self::allows(&self.read, uid) || Self::allows(&self.write, uid)
    }

    pub fn can_write(&self, uid: &str) -> bool {
        Self::allows(&self.write, uid)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_memory")]
    pub memory_mb: u32,
}

fn default_timeout() -> u64 {
    5_000
}

fn default_memory() -> u32 {
    64
}

impl Default for Limits {
    fn default() -> Self {
        Self { timeout_ms: default_timeout(), memory_mb: default_memory() }
    }
}

pub const HOOK_EVENTS: &[&str] = &[
    "beforeCreate",
    "beforeUpdate",
    "beforeDelete",
    "beforePublish",
    "beforeUnpublish",
    "beforeDiscardDraft",
    "afterCreate",
    "afterUpdate",
    "afterDelete",
    "afterPublish",
    "afterUnpublish",
    "afterDiscardDraft",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Hook {
    /// One of [`HOOK_EVENTS`].
    pub on: String,
    /// A content type uid, or `*`.
    #[serde(default = "any")]
    pub uid: String,
    /// The exported function to call.
    pub function: String,
}

fn any() -> String {
    "*".into()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Routes {
    /// Handles `/api/plugins/{name}/…`.
    pub function: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
    /// Cron syntax (`*/5 * * * *`; seconds optional), in UTC.
    pub schedule: String,
    pub function: String,
}

/// `[[graphql]]`: `name(args: JSON): JSON` on `Query` (or `Mutation`); the function gets
/// `{ args, actor }` and returns the field's value.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GraphqlField {
    pub name: String,
    pub function: String,
    #[serde(default)]
    pub mutation: bool,
    #[serde(default)]
    pub description: Option<String>,
}

/// What the plugin adds to the admin panel (Web Components from its `admin/` directory).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Admin {
    /// Module script under `admin/`, imported once by the panel (defines the elements).
    pub script: Option<String>,
    #[serde(default)]
    pub widgets: Vec<Widget>,
    #[serde(default)]
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Widget {
    pub id: String,
    pub title: String,
    /// The custom element (`acme-stats`).
    pub element: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// A custom field: attributes with `"customField": "plugin::{name}.{id}"`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub id: String,
    pub title: String,
    pub element: String,
    /// The attribute type the value is stored as (`string`, `json`, …).
    #[serde(rename = "type")]
    pub storage: String,
    #[serde(default)]
    pub description: Option<String>,
}

pub const SETTING_TYPES: &[&str] =
    &["string", "text", "url", "number", "integer", "boolean", "select"];

/// A field of the plugin's settings form.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Setting {
    /// The key in the settings object (`verdin_config()`).
    pub key: String,
    pub label: String,
    /// One of [`SETTING_TYPES`].
    #[serde(rename = "type", default = "string_type")]
    pub kind: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    /// The choices of a `select`.
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub default: Option<Value>,
    /// Bounds of numbers, lengths of text.
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
}

fn string_type() -> String {
    "string".into()
}

impl Setting {
    /// Whether `value` fits this field.
    pub fn check_value(&self, value: &Value) -> Result<(), String> {
        let key = &self.key;
        let within = |number: f64, what: &str| {
            if self.min.is_some_and(|min| number < min) || self.max.is_some_and(|max| number > max)
            {
                let bound = |bound: Option<f64>| bound.map_or("…".to_owned(), |b| b.to_string());
                return Err(format!(
                    "`{key}`: {what} must be between {} and {}",
                    bound(self.min),
                    bound(self.max)
                ));
            }
            Ok(())
        };
        match (self.kind.as_str(), value) {
            ("string" | "text", Value::String(text)) => {
                within(text.chars().count() as f64, "the length")
            }
            ("url", Value::String(text)) => {
                let valid = text.is_empty()
                    || url::Url::parse(text)
                        .is_ok_and(|url| matches!(url.scheme(), "http" | "https"));
                if valid { Ok(()) } else { Err(format!("`{key}` must be an http(s) URL")) }
            }
            ("number", Value::Number(number)) => within(number.as_f64().unwrap_or_default(), "it"),
            ("integer", Value::Number(number)) if number.is_i64() || number.is_u64() => {
                within(number.as_f64().unwrap_or_default(), "it")
            }
            ("boolean", Value::Bool(_)) => Ok(()),
            ("select", Value::String(choice)) if self.options.contains(choice) => Ok(()),
            ("select", _) => Err(format!("`{key}` must be one of {}", self.options.join(", "))),
            (kind, _) => Err(format!("`{key}` must be a {kind}")),
        }
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_element(name: &str) -> bool {
    name.contains('-')
        && name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

impl Manifest {
    pub fn load(dir: &Path) -> Result<Self, PluginError> {
        let path = dir.join("plugin.toml");
        let text = std::fs::read_to_string(&path)
            .map_err(|error| PluginError::Manifest(format!("{}: {error}", path.display())))?;
        let manifest: Manifest = toml::from_str(&text)
            .map_err(|error| PluginError::Manifest(format!("{}: {error}", path.display())))?;
        manifest
            .check()
            .map_err(|message| PluginError::Manifest(format!("{}: {message}", path.display())))?;
        Ok(manifest)
    }

    pub fn check(&self) -> Result<(), String> {
        if !valid_name(&self.name) {
            return Err(format!(
                "name `{}` must be lowercase letters, digits and dashes",
                self.name
            ));
        }
        if self.wasm.contains("..") || self.wasm.starts_with('/') {
            return Err("wasm must be a path inside the plugin directory".into());
        }
        for hook in &self.hooks {
            if !HOOK_EVENTS.contains(&hook.on.as_str()) {
                return Err(format!(
                    "unknown hook `{}` (one of {})",
                    hook.on,
                    HOOK_EVENTS.join(", ")
                ));
            }
        }
        for job in &self.jobs {
            croner::parser::CronParser::builder()
                .seconds(croner::parser::Seconds::Optional)
                .build()
                .parse(&job.schedule)
                .map_err(|error| {
                    format!("job `{}`: invalid schedule `{}`: {error}", job.function, job.schedule)
                })?;
        }
        for field in &self.graphql {
            let valid = field.name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
                && field.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !valid {
                return Err(format!("graphql field `{}`: use a camelCase name", field.name));
            }
        }
        if let Some(script) = &self.admin.script
            && (script.contains("..") || script.starts_with('/'))
        {
            return Err("admin.script must be a path inside admin/".into());
        }
        for element in self
            .admin
            .widgets
            .iter()
            .map(|w| &w.element)
            .chain(self.admin.fields.iter().map(|f| &f.element))
        {
            if !valid_element(element) {
                return Err(format!(
                    "`{element}` is not a custom element name (lowercase, with a dash)"
                ));
            }
        }
        if self.limits.timeout_ms == 0 || self.limits.memory_mb == 0 {
            return Err("limits must be positive".into());
        }
        for (index, setting) in self.settings.iter().enumerate() {
            let key = &setting.key;
            let valid_key = !key.is_empty()
                && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                && !key.starts_with(|c: char| c.is_ascii_digit());
            if !valid_key {
                return Err(format!("setting key `{key}`: letters, digits and underscores"));
            }
            if self.settings[..index].iter().any(|other| other.key == *key) {
                return Err(format!("setting `{key}` is declared twice"));
            }
            if !SETTING_TYPES.contains(&setting.kind.as_str()) {
                return Err(format!(
                    "setting `{key}`: unknown type `{}` (one of {})",
                    setting.kind,
                    SETTING_TYPES.join(", ")
                ));
            }
            if setting.kind == "select" && setting.options.is_empty() {
                return Err(format!("setting `{key}`: a select needs options"));
            }
            if let Some(default) = &setting.default {
                setting.check_value(default).map_err(|error| format!("default of {error}"))?;
            }
        }
        Ok(())
    }

    /// Checks settings against the form (any object when the plugin declares none).
    pub fn check_settings(&self, settings: &Value) -> Result<(), String> {
        let Some(object) = settings.as_object() else {
            return Err("settings must be an object".into());
        };
        if self.settings.is_empty() {
            return Ok(());
        }
        if let Some(unknown) =
            object.keys().find(|key| !self.settings.iter().any(|s| &s.key == *key))
        {
            return Err(format!("unknown setting `{unknown}`"));
        }
        for setting in &self.settings {
            match object.get(&setting.key) {
                Some(Value::Null) | None => {
                    if setting.required && setting.default.is_none() {
                        return Err(format!("`{}` is required", setting.key));
                    }
                }
                Some(value) => {
                    setting.check_value(value)?;
                    if setting.required && value.as_str().is_some_and(str::is_empty) {
                        return Err(format!("`{}` is required", setting.key));
                    }
                }
            }
        }
        Ok(())
    }

    /// Stored settings with the declared defaults filled in.
    pub fn effective_settings(&self, stored: &Value) -> Value {
        let mut object = stored.as_object().cloned().unwrap_or_default();
        for setting in &self.settings {
            if let Some(default) = &setting.default
                && object.get(&setting.key).is_none_or(Value::is_null)
            {
                object.insert(setting.key.clone(), default.clone());
            }
        }
        Value::Object(object)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_checks() {
        let manifest: Manifest = toml::from_str(
            r#"
            name = "slugs"
            version = "1.0.0"
            [capabilities]
            read = ["api::article"]
            write = ["api::tag"]
            kv = true
            [[hooks]]
            on = "beforeCreate"
            uid = "api::article"
            function = "before_write"
            [routes]
            function = "handle"
            [[jobs]]
            schedule = "*/5 * * * *"
            function = "tick"
            [admin]
            script = "index.js"
            [[admin.fields]]
            id = "color"
            title = "Color"
            element = "slugs-color"
            type = "string"
            "#,
        )
        .unwrap();
        assert!(manifest.check().is_ok());
        assert!(manifest.capabilities.can_read("api::tag"), "write implies read");
        assert!(!manifest.capabilities.can_write("api::article"));
        let mut bad = manifest.clone();
        bad.hooks[0].on = "beforeExplode".into();
        assert!(bad.check().unwrap_err().contains("unknown hook"));
        let mut bad = manifest.clone();
        bad.jobs[0].schedule = "every minute".into();
        assert!(bad.check().is_err());
        let mut bad = manifest;
        bad.name = "Bad Name".into();
        assert!(bad.check().is_err());
    }

    #[test]
    fn settings_forms() {
        let manifest: Manifest = toml::from_str(
            r#"
            name = "seo"
            version = "1.0.0"
            [[settings]]
            key = "siteUrl"
            label = "Site URL"
            type = "url"
            required = true
            [[settings]]
            key = "maxLength"
            label = "Max length"
            type = "integer"
            min = 10
            max = 300
            default = 160
            [[settings]]
            key = "mode"
            label = "Mode"
            type = "select"
            options = ["strict", "loose"]
            default = "loose"
            "#,
        )
        .unwrap();
        assert!(manifest.check().is_ok());
        let ok = serde_json::json!({ "siteUrl": "https://example.com", "maxLength": 200 });
        assert!(manifest.check_settings(&ok).is_ok());
        assert_eq!(manifest.effective_settings(&ok)["mode"], "loose");
        for bad in [
            serde_json::json!({}),
            serde_json::json!({ "siteUrl": "" }),
            serde_json::json!({ "siteUrl": "ftp://x" }),
            serde_json::json!({ "siteUrl": "https://x", "maxLength": 5 }),
            serde_json::json!({ "siteUrl": "https://x", "maxLength": 20.5 }),
            serde_json::json!({ "siteUrl": "https://x", "mode": "other" }),
            serde_json::json!({ "siteUrl": "https://x", "extra": 1 }),
            serde_json::json!([1]),
        ] {
            assert!(manifest.check_settings(&bad).is_err(), "{bad}");
        }
        let mut broken = manifest;
        broken.settings[1].default = Some(serde_json::json!(1000));
        assert!(broken.check().is_err());
    }
}
