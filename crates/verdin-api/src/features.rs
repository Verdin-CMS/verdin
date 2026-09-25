//! Optional features that admins switch on and off at runtime (Settings → Features), like
//! Strapi's plugins. The catalog lists what exists and what is coming; the host persists
//! the switches and rebuilds the app when they change.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::BoxFuture;
use crate::error::ApiError;

/// One entry of the catalog.
#[derive(Debug, Clone, Copy)]
pub struct FeatureSpec {
    pub id: &'static str,
    /// Implemented in this version (others are shown as coming).
    pub available: bool,
    /// Planned release for features not available yet.
    pub planned: Option<&'static str>,
    pub default_enabled: bool,
    /// Always on: part of the core, listed for completeness.
    pub core: bool,
}

pub const OPENAPI: &str = "openapi";
pub const GRAPHQL: &str = "graphql";
pub const WEBHOOKS: &str = "webhooks";
pub const HISTORY: &str = "history";

/// Every feature, in display order.
pub const CATALOG: &[FeatureSpec] = &[
    FeatureSpec { id: "media", available: true, planned: None, default_enabled: true, core: true },
    FeatureSpec { id: OPENAPI, available: true, planned: None, default_enabled: true, core: false },
    FeatureSpec {
        id: GRAPHQL,
        available: true,
        planned: None,
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: WEBHOOKS,
        available: true,
        planned: None,
        default_enabled: true,
        core: false,
    },
    FeatureSpec {
        id: "i18n",
        available: false,
        planned: Some("0.3"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec { id: HISTORY, available: true, planned: None, default_enabled: true, core: false },
    FeatureSpec {
        id: "importer",
        available: false,
        planned: Some("0.3"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: "users",
        available: false,
        planned: Some("0.4"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: "email",
        available: false,
        planned: Some("0.4"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: "plugins",
        available: false,
        planned: Some("0.5"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: "sso",
        available: false,
        planned: Some("0.6"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: "audit",
        available: false,
        planned: Some("0.6"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: "review",
        available: false,
        planned: Some("0.6"),
        default_enabled: false,
        core: false,
    },
    FeatureSpec {
        id: "releases",
        available: false,
        planned: Some("0.6"),
        default_enabled: false,
        core: false,
    },
];

pub fn spec(id: &str) -> Option<&'static FeatureSpec> {
    CATALOG.iter().find(|spec| spec.id == id)
}

/// A feature's switch and options, as stored (`vd_settings`, key `features`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FeatureState {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub settings: Value,
}

/// Stored switches; features never switched keep their default.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FeatureStates(pub BTreeMap<String, FeatureState>);

impl FeatureStates {
    pub fn enabled(&self, id: &str) -> bool {
        let Some(spec) = spec(id) else { return false };
        if spec.core {
            return true;
        }
        spec.available && self.0.get(id).map_or(spec.default_enabled, |state| state.enabled)
    }

    pub fn settings(&self, id: &str) -> &Value {
        static NULL: Value = Value::Null;
        self.0.get(id).map_or(&NULL, |state| &state.settings)
    }

    /// The catalog with current states, for the admin.
    pub fn catalog_json(&self) -> Value {
        Value::Array(
            CATALOG
                .iter()
                .map(|spec| {
                    json!({
                        "id": spec.id,
                        "available": spec.available,
                        "planned": spec.planned,
                        "core": spec.core,
                        "enabled": self.enabled(spec.id),
                        "settings": self.settings(spec.id),
                    })
                })
                .collect(),
        )
    }
}

/// Owns the feature switches: persists them and applies changes to the running app.
pub trait FeatureHost: Send + Sync {
    fn states(&self) -> FeatureStates;
    /// Validates, stores and applies a change (the app is rebuilt in place).
    fn update(&self, id: String, state: FeatureState) -> BoxFuture<'_, Result<(), ApiError>>;
}

/// Checks that a feature can take `state`.
pub fn validate(id: &str, state: &FeatureState) -> Result<(), ApiError> {
    let spec = spec(id).ok_or(ApiError::NotFound)?;
    if spec.core {
        return Err(ApiError::BadRequest(format!("`{id}` is part of the core and always on")));
    }
    if !spec.available && state.enabled {
        let when =
            spec.planned.map(|version| format!(" (planned for {version})")).unwrap_or_default();
        return Err(ApiError::BadRequest(format!("`{id}` is not available yet{when}")));
    }
    if !state.settings.is_null() && !state.settings.is_object() {
        return Err(ApiError::BadRequest("settings must be an object".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_validation() {
        let mut states = FeatureStates::default();
        assert!(states.enabled(OPENAPI), "on by default");
        assert!(states.enabled("media"), "core");
        assert!(states.enabled(WEBHOOKS), "on by default");
        assert!(!states.enabled("users"));
        states.0.insert(OPENAPI.into(), FeatureState { enabled: false, settings: Value::Null });
        assert!(!states.enabled(OPENAPI));
        states.0.insert("users".into(), FeatureState { enabled: true, settings: Value::Null });
        assert!(!states.enabled("users"), "unavailable features stay off");

        let on = FeatureState { enabled: true, settings: Value::Null };
        assert!(validate(OPENAPI, &on).is_ok());
        assert!(matches!(validate("users", &on), Err(ApiError::BadRequest(_))));
        assert!(matches!(validate("media", &on), Err(ApiError::BadRequest(_))));
        assert!(matches!(validate("nope", &on), Err(ApiError::NotFound)));
        let bad = FeatureState { enabled: true, settings: json!([1]) };
        assert!(matches!(validate(OPENAPI, &bad), Err(ApiError::BadRequest(_))));
        assert_eq!(states.catalog_json().as_array().unwrap().len(), CATALOG.len());
    }
}
