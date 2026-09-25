//! `plugin.toml`: what a plugin is, what it may do and what it hooks into.

use std::path::Path;

use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub admin: Admin,
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
        Ok(())
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
}
