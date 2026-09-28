//! Preview links: the `preview` feature maps content types to URL templates of the site that
//! renders them. The admin fills a template from the draft and adds a preview token the site
//! sends back (`x-verdin-preview`) to read that draft through the content API.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use crate::error::ApiError;

const DEFAULT_TTL_MINUTES: i64 = 60;
const MAX_TTL_MINUTES: i64 = 7 * 24 * 60;

/// The `preview` feature settings.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewSettings {
    /// Content type uid → URL template (`https://site/blog/{slug}?locale={locale}`).
    #[serde(default)]
    pub urls: BTreeMap<String, String>,
    /// How long preview tokens last (60 minutes by default).
    #[serde(default)]
    pub ttl_minutes: Option<i64>,
}

impl PreviewSettings {
    pub fn parse(settings: &Value) -> Result<Self, ApiError> {
        if settings.is_null() {
            return Ok(Self::default());
        }
        let parsed: Self = serde_json::from_value(settings.clone())
            .map_err(|error| ApiError::BadRequest(format!("invalid preview settings: {error}")))?;
        for (uid, template) in &parsed.urls {
            let sample = template.replace(['{', '}'], "");
            let valid =
                url::Url::parse(&sample).is_ok_and(|url| matches!(url.scheme(), "http" | "https"));
            if !valid {
                return Err(ApiError::BadRequest(format!(
                    "the preview URL of {uid} must be an http(s) URL"
                )));
            }
        }
        if parsed.ttl_minutes.is_some_and(|ttl| !(1..=MAX_TTL_MINUTES).contains(&ttl)) {
            return Err(ApiError::BadRequest(format!(
                "ttlMinutes must be between 1 and {MAX_TTL_MINUTES}"
            )));
        }
        Ok(parsed)
    }

    pub fn ttl(&self) -> time::Duration {
        time::Duration::minutes(self.ttl_minutes.unwrap_or(DEFAULT_TTL_MINUTES))
    }
}

fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// Fills `{placeholder}`s from the document (top-level scalars) and the extra values
/// (`documentId`, `locale`…); unknown placeholders become empty. `{token}` is the preview
/// token; without that placeholder it is added as the `preview` query parameter.
pub fn fill(template: &str, document: &Value, extra: &[(&str, &str)], token: &str) -> String {
    let mut out = String::with_capacity(template.len() + token.len());
    let mut rest = template;
    let mut has_token = false;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('}') else {
            break;
        };
        let name = &rest[start + 1..start + end];
        let value = if name == "token" {
            has_token = true;
            Some(token.to_owned())
        } else if let Some((_, value)) = extra.iter().find(|(key, _)| *key == name) {
            Some((*value).to_owned())
        } else {
            match document.get(name) {
                Some(Value::String(text)) => Some(text.clone()),
                Some(value @ (Value::Number(_) | Value::Bool(_))) => Some(value.to_string()),
                _ => None,
            }
        };
        out.push_str(&encode(&value.unwrap_or_default()));
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    if !has_token {
        let separator = if out.contains('?') { '&' } else { '?' };
        out = format!("{out}{separator}preview={}", encode(token));
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn fills_templates() {
        let document = json!({ "slug": "hello world", "views": 3, "cover": { "id": 1 } });
        let extra = [("documentId", "abc"), ("locale", "fr")];
        assert_eq!(
            fill("https://site/{locale}/blog/{slug}?v={views}", &document, &extra, "t.k"),
            "https://site/fr/blog/hello+world?v=3&preview=t.k"
        );
        assert_eq!(
            fill("https://site/p/{documentId}/{cover}/{token}", &document, &extra, "t"),
            "https://site/p/abc//t"
        );
    }

    #[test]
    fn validates_settings() {
        assert!(PreviewSettings::parse(&Value::Null).unwrap().urls.is_empty());
        let ok =
            json!({ "urls": { "api::article.article": "https://site/{slug}" }, "ttlMinutes": 10 });
        assert_eq!(PreviewSettings::parse(&ok).unwrap().ttl(), time::Duration::minutes(10));
        for bad in [
            json!({ "urls": { "api::article.article": "javascript:alert(1)" } }),
            json!({ "urls": { "api::article.article": "/relative" } }),
            json!({ "ttlMinutes": 0 }),
            json!({ "other": true }),
        ] {
            assert!(PreviewSettings::parse(&bad).is_err(), "{bad}");
        }
    }
}
