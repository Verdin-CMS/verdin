//! AI actions (`[ai]`, the `ai` feature): translation, alt text, summaries and SEO
//! suggestions, with the provider and key of the installation (`VERDIN_AI_KEY`).
//! Nothing is saved: the admin shows suggestions for the editor to apply.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use serde_json::{Value as Json, json};

/// `[ai]` in `verdin.toml`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AiConfig {
    pub provider: AiProvider,
    /// The model; `anthropic` defaults to `claude-sonnet-5`, others must name one.
    pub model: Option<String>,
    /// Another endpoint: a proxy, or a local server for `openai-compatible` (Ollama,
    /// LM Studio, vLLM: `http://localhost:11434/v1`).
    pub base_url: Option<String>,
    /// Longest answer, in tokens (default 2048).
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiProvider {
    #[default]
    None,
    Anthropic,
    Openai,
    OpenaiCompatible,
}

/// Part of a prompt.
pub enum Part {
    Text(String),
    Image { mime: String, bytes: Vec<u8> },
}

#[derive(Clone)]
pub struct Ai {
    inner: Arc<Inner>,
}

struct Inner {
    provider: AiProvider,
    model: String,
    base_url: String,
    key: Option<String>,
    max_tokens: u32,
    client: reqwest::Client,
    /// Requests per admin and minute.
    limiter: crate::limiter::RateLimiter,
}

impl Ai {
    /// `None` without a provider; an error when the provider lacks what it needs.
    pub fn new(config: &AiConfig, key: Option<String>) -> Result<Option<Self>, String> {
        let key = key.filter(|key| !key.is_empty());
        let (default_base, default_model) = match config.provider {
            AiProvider::None => return Ok(None),
            AiProvider::Anthropic => ("https://api.anthropic.com", Some("claude-sonnet-5")),
            AiProvider::Openai => ("https://api.openai.com/v1", None),
            AiProvider::OpenaiCompatible => ("", None),
        };
        let model = config
            .model
            .clone()
            .or(default_model.map(str::to_owned))
            .ok_or("[ai].model is required for this provider")?;
        let base_url = config.base_url.clone().unwrap_or_else(|| default_base.to_owned());
        if base_url.is_empty() {
            return Err("[ai].base_url is required for openai-compatible".into());
        }
        if key.is_none() && config.provider != AiProvider::OpenaiCompatible {
            return Err("VERDIN_AI_KEY is not set".into());
        }
        let client = reqwest::Client::builder()
            .user_agent(concat!("Verdin/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Some(Self {
            inner: Arc::new(Inner {
                provider: config.provider,
                model,
                base_url: base_url.trim_end_matches('/').to_owned(),
                key,
                max_tokens: config.max_tokens.unwrap_or(2048),
                client,
                limiter: crate::limiter::RateLimiter::new(30, Duration::from_secs(60)),
            }),
        }))
    }

    pub fn provider(&self) -> AiProvider {
        self.inner.provider
    }

    pub fn model(&self) -> &str {
        &self.inner.model
    }

    /// Counts a request of `user_id`; `false` over 30 a minute.
    pub fn allow(&self, user_id: i64) -> bool {
        self.inner.limiter.allow(&user_id.to_string())
    }

    /// The model's answer to `parts`, following `system`.
    pub async fn complete(&self, system: &str, parts: Vec<Part>) -> Result<String, String> {
        let inner = &self.inner;
        let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
        let request = match inner.provider {
            AiProvider::None => return Err("AI is not configured".into()),
            AiProvider::Anthropic => {
                let content: Vec<Json> = parts
                    .iter()
                    .map(|part| match part {
                        Part::Text(text) => json!({ "type": "text", "text": text }),
                        Part::Image { mime, bytes } => json!({
                            "type": "image",
                            "source": { "type": "base64", "media_type": mime, "data": encode(bytes) }
                        }),
                    })
                    .collect();
                inner
                    .client
                    .post(format!("{}/v1/messages", inner.base_url))
                    .header("x-api-key", inner.key.as_deref().unwrap_or_default())
                    .header("anthropic-version", "2023-06-01")
                    .json(&json!({
                        "model": inner.model,
                        "max_tokens": inner.max_tokens,
                        "system": system,
                        "messages": [{ "role": "user", "content": content }],
                    }))
            }
            AiProvider::Openai | AiProvider::OpenaiCompatible => {
                let content: Vec<Json> = parts
                    .iter()
                    .map(|part| match part {
                        Part::Text(text) => json!({ "type": "text", "text": text }),
                        Part::Image { mime, bytes } => json!({
                            "type": "image_url",
                            "image_url": { "url": format!("data:{mime};base64,{}", encode(bytes)) }
                        }),
                    })
                    .collect();
                let request = inner
                    .client
                    .post(format!("{}/chat/completions", inner.base_url))
                    .json(&json!({
                        "model": inner.model,
                        "max_tokens": inner.max_tokens,
                        "messages": [
                            { "role": "system", "content": system },
                            { "role": "user", "content": content },
                        ],
                    }));
                match &inner.key {
                    Some(key) => request.bearer_auth(key),
                    None => request,
                }
            }
        };
        let response = request.send().await.map_err(|error| crate::webhooks::describe(&error))?;
        let status = response.status();
        let body: Json = response.json().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = body
                .pointer("/error/message")
                .and_then(Json::as_str)
                .unwrap_or("the provider refused the request");
            return Err(format!("{status}: {message}"));
        }
        let text = match inner.provider {
            AiProvider::Anthropic => body["content"].as_array().map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|block| block["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            }),
            _ => {
                body.pointer("/choices/0/message/content").and_then(Json::as_str).map(str::to_owned)
            }
        };
        text.filter(|text| !text.trim().is_empty()).ok_or_else(|| "the model gave no answer".into())
    }

    /// The model's answer as a JSON object (the first `{…}` in it).
    pub async fn complete_json(&self, system: &str, parts: Vec<Part>) -> Result<Json, String> {
        let system = format!("{system}\nReply with a single JSON object and nothing else.");
        let text = self.complete(&system, parts).await?;
        first_object(&text).ok_or_else(|| "the model did not answer in JSON".into())
    }
}

/// The first JSON object in `text` (models sometimes wrap it in prose or fences).
pub fn first_object(text: &str) -> Option<Json> {
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut quoted = false;
    let mut escaped = false;
    for (offset, c) in text[start..].char_indices() {
        match c {
            _ if escaped => escaped = false,
            '\\' if quoted => escaped = true,
            '"' => quoted = !quoted,
            '{' if !quoted => depth += 1,
            '}' if !quoted => {
                depth -= 1;
                if depth == 0 {
                    return serde_json::from_str(&text[start..=start + offset])
                        .ok()
                        .filter(Json::is_object);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_json_in_answers() {
        assert_eq!(first_object("Sure! ```json\n{\"a\": \"}\"}\n```"), Some(json!({ "a": "}" })));
        assert_eq!(first_object("{\"a\": {\"b\": 1}} and more"), Some(json!({ "a": { "b": 1 } })));
        assert_eq!(first_object("no json"), None);
    }

    #[test]
    fn checks_what_providers_need() {
        let anthropic = AiConfig { provider: AiProvider::Anthropic, ..Default::default() };
        assert!(Ai::new(&anthropic, None).is_err(), "a key");
        let ai = Ai::new(&anthropic, Some("k".into())).unwrap().unwrap();
        assert_eq!(ai.model(), "claude-sonnet-5");
        let openai = AiConfig { provider: AiProvider::Openai, ..Default::default() };
        assert!(Ai::new(&openai, Some("k".into())).is_err(), "a model");
        let local = AiConfig {
            provider: AiProvider::OpenaiCompatible,
            model: Some("llama3".into()),
            base_url: Some("http://localhost:11434/v1".into()),
            ..Default::default()
        };
        assert!(Ai::new(&local, None).unwrap().is_some(), "local servers need no key");
        assert!(Ai::new(&AiConfig::default(), None).unwrap().is_none());
    }

    #[tokio::test]
    async fn speaks_anthropic_messages() {
        use axum::http::HeaderMap;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = axum::Router::new().route(
            "/v1/messages",
            axum::routing::post(
                |headers: HeaderMap, axum::Json(request): axum::Json<Json>| async move {
                    assert_eq!(headers["x-api-key"], "secret");
                    assert_eq!(headers["anthropic-version"], "2023-06-01");
                    assert_eq!(request["model"], "claude-sonnet-5");
                    assert!(request["system"].as_str().unwrap().contains("JSON"));
                    assert_eq!(
                        request["messages"][0]["content"][0]["source"]["media_type"],
                        "image/png"
                    );
                    axum::Json(json!({ "content": [{ "type": "text", "text": "{\"ok\": true}" }] }))
                },
            ),
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let config = AiConfig {
            provider: AiProvider::Anthropic,
            base_url: Some(base),
            ..Default::default()
        };
        let ai = Ai::new(&config, Some("secret".into())).unwrap().unwrap();
        let answer = ai
            .complete_json(
                "Task.",
                vec![Part::Image { mime: "image/png".into(), bytes: vec![1, 2] }],
            )
            .await
            .unwrap();
        assert_eq!(answer, json!({ "ok": true }));
    }
}
