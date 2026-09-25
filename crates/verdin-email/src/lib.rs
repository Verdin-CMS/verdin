//! Email delivery: account confirmations, password resets and admin notifications.
//! Providers: `log` (writes the message to the log; the default), `smtp`, `resend` and
//! `postmark`. Passwords and API keys come from the environment only.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use lettre::message::{Mailbox, MultiPart, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("email is not configured: {0}")]
    Config(String),
    #[error("invalid address `{0}`")]
    Address(String),
    #[error("could not send the email: {0}")]
    Send(String),
}

pub type Result<T> = std::result::Result<T, EmailError>;

/// `[email]` in `verdin.toml`.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EmailConfig {
    /// `log`, `smtp`, `resend` or `postmark`.
    pub provider: String,
    /// Sender, e.g. `Verdin <no-reply@example.com>`.
    pub from: String,
    pub reply_to: Option<String>,
    pub smtp: SmtpConfig,
}

impl Default for EmailConfig {
    fn default() -> Self {
        Self {
            provider: "log".into(),
            from: "Verdin <no-reply@localhost>".into(),
            reply_to: None,
            smtp: SmtpConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    /// `starttls` (default), `tls` (implicit, usually port 465) or `none` (local relays).
    pub security: String,
}

impl Default for SmtpConfig {
    fn default() -> Self {
        Self { host: "localhost".into(), port: 587, username: None, security: "starttls".into() }
    }
}

/// Secrets, read from the environment by the caller.
#[derive(Debug, Clone, Default)]
pub struct EmailSecrets {
    /// `VERDIN_EMAIL_SMTP_PASSWORD`.
    pub smtp_password: Option<String>,
    /// `VERDIN_EMAIL_API_KEY` (Resend, Postmark).
    pub api_key: Option<String>,
}

impl EmailSecrets {
    pub fn from_env() -> Self {
        let read = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
        Self {
            smtp_password: read("VERDIN_EMAIL_SMTP_PASSWORD"),
            api_key: read("VERDIN_EMAIL_API_KEY"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub to: String,
    pub subject: String,
    pub text: String,
    pub html: Option<String>,
}

#[derive(Clone)]
enum Provider {
    Log,
    Smtp(AsyncSmtpTransport<Tokio1Executor>),
    Resend {
        key: String,
        client: reqwest::Client,
    },
    Postmark {
        token: String,
        client: reqwest::Client,
    },
    /// Tests: messages are kept in memory.
    Memory(Arc<std::sync::Mutex<Vec<Message>>>),
}

#[derive(Clone)]
pub struct Mailer {
    provider: Provider,
    from: Mailbox,
    reply_to: Option<Mailbox>,
    name: &'static str,
}

fn mailbox(address: &str) -> Result<Mailbox> {
    address.parse().map_err(|_| EmailError::Address(address.to_owned()))
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("the HTTP client builds")
}

impl Mailer {
    pub fn new(config: &EmailConfig, secrets: &EmailSecrets) -> Result<Self> {
        let from = mailbox(&config.from)?;
        let reply_to = config.reply_to.as_deref().map(mailbox).transpose()?;
        let key = |name: &str| {
            secrets.api_key.clone().ok_or_else(|| {
                EmailError::Config(format!("the {name} provider needs VERDIN_EMAIL_API_KEY"))
            })
        };
        let (provider, name) = match config.provider.as_str() {
            "log" => (Provider::Log, "log"),
            "smtp" => {
                let smtp = &config.smtp;
                let mut builder = match smtp.security.as_str() {
                    "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp.host),
                    "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp.host),
                    "none" => {
                        Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&smtp.host))
                    }
                    other => {
                        return Err(EmailError::Config(format!(
                            "[email.smtp].security must be starttls, tls or none (got `{other}`)"
                        )));
                    }
                }
                .map_err(|error| EmailError::Config(error.to_string()))?
                .port(smtp.port)
                .timeout(Some(Duration::from_secs(15)));
                if let Some(username) = &smtp.username {
                    let password = secrets.smtp_password.clone().ok_or_else(|| {
                        EmailError::Config(
                            "[email.smtp].username needs VERDIN_EMAIL_SMTP_PASSWORD".into(),
                        )
                    })?;
                    builder = builder.credentials(Credentials::new(username.clone(), password));
                }
                (Provider::Smtp(builder.build()), "smtp")
            }
            "resend" => (Provider::Resend { key: key("resend")?, client: http_client() }, "resend"),
            "postmark" => {
                (Provider::Postmark { token: key("postmark")?, client: http_client() }, "postmark")
            }
            other => {
                return Err(EmailError::Config(format!(
                    "[email].provider must be log, smtp, resend or postmark (got `{other}`)"
                )));
            }
        };
        Ok(Self { provider, from, reply_to, name })
    }

    /// A mailer that keeps messages in memory, and the list they go to.
    pub fn memory() -> (Self, Arc<std::sync::Mutex<Vec<Message>>>) {
        let sent = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mailer = Self {
            provider: Provider::Memory(sent.clone()),
            from: mailbox("Verdin <no-reply@localhost>").expect("valid address"),
            reply_to: None,
            name: "memory",
        };
        (mailer, sent)
    }

    pub fn provider(&self) -> &'static str {
        self.name
    }

    pub fn from(&self) -> String {
        self.from.to_string()
    }

    pub async fn send(&self, message: &Message) -> Result<()> {
        let to = mailbox(&message.to)?;
        match &self.provider {
            Provider::Log => {
                tracing::info!(
                    to = %message.to,
                    subject = %message.subject,
                    body = %message.text,
                    "email (log provider: not sent)"
                );
                Ok(())
            }
            Provider::Memory(sent) => {
                sent.lock().expect("sent lock").push(message.clone());
                Ok(())
            }
            Provider::Smtp(transport) => {
                let mut builder = lettre::Message::builder()
                    .from(self.from.clone())
                    .to(to)
                    .subject(&message.subject);
                if let Some(reply_to) = &self.reply_to {
                    builder = builder.reply_to(reply_to.clone());
                }
                let email = match &message.html {
                    Some(html) => builder.multipart(MultiPart::alternative_plain_html(
                        message.text.clone(),
                        html.clone(),
                    )),
                    None => builder.header(ContentType::TEXT_PLAIN).body(message.text.clone()),
                }
                .map_err(|error| EmailError::Send(error.to_string()))?;
                transport.send(email).await.map_err(|error| EmailError::Send(error.to_string()))?;
                Ok(())
            }
            Provider::Resend { key, client } => {
                let mut body = json!({
                    "from": self.from.to_string(),
                    "to": [message.to],
                    "subject": message.subject,
                    "text": message.text,
                });
                if let Some(html) = &message.html {
                    body["html"] = json!(html);
                }
                if let Some(reply_to) = &self.reply_to {
                    body["reply_to"] = json!(reply_to.to_string());
                }
                post(client.post("https://api.resend.com/emails").bearer_auth(key).json(&body))
                    .await
            }
            Provider::Postmark { token, client } => {
                let mut body = json!({
                    "From": self.from.to_string(),
                    "To": message.to,
                    "Subject": message.subject,
                    "TextBody": message.text,
                    "MessageStream": "outbound",
                });
                if let Some(html) = &message.html {
                    body["HtmlBody"] = json!(html);
                }
                if let Some(reply_to) = &self.reply_to {
                    body["ReplyTo"] = json!(reply_to.to_string());
                }
                post(
                    client
                        .post("https://api.postmarkapp.com/email")
                        .header("X-Postmark-Server-Token", token)
                        .header("Accept", "application/json")
                        .json(&body),
                )
                .await
            }
        }
    }
}

async fn post(request: reqwest::RequestBuilder) -> Result<()> {
    let response = request.send().await.map_err(|error| EmailError::Send(error.to_string()))?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let text: String = response.text().await.unwrap_or_default().chars().take(300).collect();
    Err(EmailError::Send(format!("HTTP {status}: {text}")))
}

/// Fills `{{name}}` placeholders; `escape` HTML-escapes the values (for HTML bodies).
pub fn render(template: &str, values: &BTreeMap<&str, String>, escape: bool) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let name = after[..end].trim();
        match values.get(name) {
            Some(value) if escape => out.push_str(&html_escape(value)),
            Some(value) => out.push_str(value),
            None => {}
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

pub fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates() {
        let values =
            BTreeMap::from([("name", "<Ada>".to_owned()), ("url", "https://x?a=1&b=2".to_owned())]);
        assert_eq!(
            render("Hi {{ name }}, go to {{url}}.{{missing}}", &values, false),
            "Hi <Ada>, go to https://x?a=1&b=2."
        );
        assert_eq!(render("<p>{{name}}</p>", &values, true), "<p>&lt;Ada&gt;</p>");
        assert_eq!(render("unclosed {{name", &values, false), "unclosed {{name");
    }

    #[test]
    fn configuration() {
        let config = EmailConfig { provider: "resend".into(), ..Default::default() };
        assert!(matches!(
            Mailer::new(&config, &EmailSecrets::default()),
            Err(EmailError::Config(_))
        ));
        let secrets = EmailSecrets { api_key: Some("re_123".into()), ..Default::default() };
        assert_eq!(Mailer::new(&config, &secrets).unwrap().provider(), "resend");
        let bad = EmailConfig { from: "not an address".into(), ..Default::default() };
        assert!(matches!(Mailer::new(&bad, &EmailSecrets::default()), Err(EmailError::Address(_))));
        let smtp = EmailConfig {
            provider: "smtp".into(),
            smtp: SmtpConfig { username: Some("me".into()), ..Default::default() },
            ..Default::default()
        };
        assert!(matches!(Mailer::new(&smtp, &EmailSecrets::default()), Err(EmailError::Config(_))));
    }

    /// Against Mailpit (`docker/compose.dev.yml`): `VERDIN_TEST_SMTP=localhost:1025`.
    #[tokio::test]
    async fn smtp_delivery() {
        let Ok(address) = std::env::var("VERDIN_TEST_SMTP") else { return };
        let (host, port) = address.split_once(':').unwrap_or((&address, "1025"));
        let config = EmailConfig {
            provider: "smtp".into(),
            from: "Verdin tests <tests@verdin.local>".into(),
            reply_to: Some("help@verdin.local".into()),
            smtp: SmtpConfig {
                host: host.into(),
                port: port.parse().unwrap(),
                username: None,
                security: "none".into(),
            },
        };
        let mailer = Mailer::new(&config, &EmailSecrets::default()).unwrap();
        let subject = format!("smtp test {}", std::process::id());
        mailer
            .send(&Message {
                to: "ada@example.com".into(),
                subject: subject.clone(),
                text: "plain".into(),
                html: Some("<p>html</p>".into()),
            })
            .await
            .unwrap();
        let api = format!(
            "http://{host}:8025/api/v1/search?query=subject:%22{}%22",
            subject.replace(' ', "%20")
        );
        let found: serde_json::Value = reqwest::get(&api).await.unwrap().json().await.unwrap();
        assert_eq!(found["messages_count"], 1, "{found}");
    }

    #[tokio::test]
    async fn memory_and_log() {
        let (mailer, sent) = Mailer::memory();
        let message = Message {
            to: "ada@example.com".into(),
            subject: "Hi".into(),
            text: "Hello".into(),
            html: None,
        };
        mailer.send(&message).await.unwrap();
        assert_eq!(sent.lock().unwrap().as_slice(), std::slice::from_ref(&message));
        let log = Mailer::new(&EmailConfig::default(), &EmailSecrets::default()).unwrap();
        log.send(&message).await.unwrap();
        assert!(matches!(
            mailer.send(&Message { to: "nope".into(), ..message }).await,
            Err(EmailError::Address(_))
        ));
    }
}
