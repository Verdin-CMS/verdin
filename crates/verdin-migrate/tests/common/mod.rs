#![allow(dead_code)]

use serde_json::Value;
use verdin_migrate::DbModel;
use verdin_schema::{Schema, Source};

#[allow(unused_imports)]
pub use verdin_testkit::TestDb;

pub fn content_type(name: &str, plural: &str, attributes: Value) -> Source {
    Source::content_type(
        name,
        serde_json::json!({
            "kind": "collectionType",
            "singularName": name,
            "pluralName": plural,
            "displayName": name,
            "options": { "draftAndPublish": true },
            "attributes": attributes,
        })
        .to_string(),
    )
}

pub fn model(sources: &[Source]) -> DbModel {
    verdin_migrate::derive_model(&Schema::parse(sources).unwrap())
}
