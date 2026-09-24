//! Serde mirror of the on-disk JSON format. Strict: unknown keys are errors.

use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RawContentType {
    #[serde(rename = "$schema")]
    pub _schema: Option<String>,
    pub kind: String,
    pub singular_name: String,
    pub plural_name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub collection_name: Option<String>,
    #[serde(default)]
    pub options: RawOptions,
    #[serde(default)]
    pub attributes: IndexMap<String, RawAttribute>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RawOptions {
    pub draft_and_publish: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RawComponent {
    #[serde(rename = "$schema")]
    pub _schema: Option<String>,
    pub display_name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub attributes: IndexMap<String, RawAttribute>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RawAttribute {
    #[serde(rename = "type")]
    pub ty: String,
    pub required: Option<bool>,
    pub private: Option<bool>,
    pub configurable: Option<bool>,
    pub default: Option<Value>,
    pub unique: Option<bool>,
    pub min_length: Option<u32>,
    pub max_length: Option<u32>,
    pub regex: Option<String>,
    pub target_field: Option<String>,
    pub min: Option<Value>,
    pub max: Option<Value>,
    pub precision: Option<u8>,
    pub scale: Option<u8>,
    #[serde(rename = "enum")]
    pub enum_values: Option<Vec<String>>,
    pub relation: Option<String>,
    pub target: Option<String>,
    pub inversed_by: Option<String>,
    pub mapped_by: Option<String>,
    pub component: Option<String>,
    pub repeatable: Option<bool>,
    pub components: Option<Vec<String>>,
}

impl RawAttribute {
    /// Names (as written in JSON) of the type-specific options that are present.
    pub fn present_options(&self) -> Vec<&'static str> {
        let options = [
            ("unique", self.unique.is_some()),
            ("minLength", self.min_length.is_some()),
            ("maxLength", self.max_length.is_some()),
            ("regex", self.regex.is_some()),
            ("targetField", self.target_field.is_some()),
            ("min", self.min.is_some()),
            ("max", self.max.is_some()),
            ("precision", self.precision.is_some()),
            ("scale", self.scale.is_some()),
            ("enum", self.enum_values.is_some()),
            ("relation", self.relation.is_some()),
            ("target", self.target.is_some()),
            ("inversedBy", self.inversed_by.is_some()),
            ("mappedBy", self.mapped_by.is_some()),
            ("component", self.component.is_some()),
            ("repeatable", self.repeatable.is_some()),
            ("components", self.components.is_some()),
            ("default", self.default.is_some()),
        ];
        options.into_iter().filter(|(_, present)| *present).map(|(name, _)| name).collect()
    }
}
