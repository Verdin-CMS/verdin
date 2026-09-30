//! Deploys: build hooks (Netlify, Vercel, Cloudflare Pages, any CI) that the admin's
//! "Deploy" button calls, and the state providers report back through a signed callback
//! URL. Hook URLs are secrets: responses only show their host.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value as Json, json};
use time::OffsetDateTime;
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::{DEPLOY_TARGETS, DEPLOYMENTS};

/// Minimum time between two deploys of a target.
pub const MIN_INTERVAL: time::Duration = time::Duration::seconds(10);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: i64,
    pub name: String,
    /// The hook's host (the URL itself is a secret).
    pub host: String,
    /// `POST` here to report a deploy's state; shown to deploy managers only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callback_path: Option<String>,
    pub last_deployment: Option<Deployment>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub id: i64,
    pub target_id: i64,
    /// `triggered`, `failed` (the hook refused), then what the provider reports:
    /// `building`, `ready` or `error`.
    pub status: String,
    pub http_status: Option<i64>,
    pub message: Option<String>,
    /// The deployed site, when the provider sends it.
    pub url: Option<String>,
    pub triggered_by: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

type DeployError = crate::error::ApiError;

fn db(error: DbError) -> DeployError {
    DeployError::Internal(error.to_string())
}

#[derive(Clone)]
pub struct Deploys {
    inner: Arc<Inner>,
}

struct Inner {
    db: Database,
    client: reqwest::Client,
    allow_private: bool,
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn at(value: &V) -> Option<String> {
    match value {
        V::DateTime(at) => Some(format_datetime(*at)),
        _ => None,
    }
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_default()
}

const DEPLOYMENT_COLUMNS: &str =
    "id, target_id, status, http_status, message, url, triggered_by_id, created_at, updated_at";
const DEPLOYMENT_KINDS: [K; 9] =
    [K::BigInt, K::BigInt, K::Text, K::Int, K::Text, K::Text, K::BigInt, K::DateTime, K::DateTime];

fn deployment(row: Vec<V>) -> Deployment {
    let mut row = row.into_iter();
    let mut next = || row.next().unwrap_or(V::Null(K::Text));
    Deployment {
        id: next().as_i64().unwrap_or_default(),
        target_id: next().as_i64().unwrap_or_default(),
        status: next().into_text().unwrap_or_default(),
        http_status: next().as_i64(),
        message: next().into_text(),
        url: next().into_text(),
        triggered_by: next().as_i64(),
        created_at: at(&next()),
        updated_at: at(&next()),
    }
}

/// The state a provider's notification reports: Netlify's `state`, Vercel's `type`, or a
/// plain `status`.
pub fn reported_status(body: &Json) -> Option<&'static str> {
    let text = body
        .get("status")
        .or_else(|| body.get("state"))
        .or_else(|| body.get("type"))
        .and_then(Json::as_str)?
        .to_ascii_lowercase();
    let text = text.strip_prefix("deployment.").unwrap_or(&text);
    Some(match text {
        "building" | "created" | "started" | "enqueued" | "processing" | "uploading" | "queued" => {
            "building"
        }
        "ready" | "succeeded" | "success" | "deployed" | "promoted" => "ready",
        "error" | "failed" | "failure" | "canceled" | "cancelled" => "error",
        _ => return None,
    })
}

/// ` LIMIT … OFFSET …` for page `page` (from 1) of `page_size` rows.
fn limit(page: u64, page_size: u64) -> String {
    let size = page_size.clamp(1, 1000);
    let offset = page.max(1).saturating_sub(1).saturating_mul(size).min(i64::MAX as u64);
    format!(" LIMIT {size} OFFSET {offset}")
}

impl Deploys {
    pub fn new(db: Database, allow_private: bool) -> Self {
        let mut client = reqwest::Client::builder()
            .user_agent(concat!("Verdin-Deploy/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy();
        if !allow_private {
            client = client.dns_resolver(Arc::new(crate::webhooks::PublicResolver));
        }
        let client = client.build().expect("the HTTP client builds");
        Self { inner: Arc::new(Inner { db, client, allow_private }) }
    }

    fn check(&self, name: &str, url: &str) -> Result<(), DeployError> {
        if name.trim().is_empty() || name.chars().count() > 255 {
            return Err(DeployError::BadRequest("the name needs 1 to 255 characters".into()));
        }
        crate::webhooks::check_url(url, self.inner.allow_private).map_err(DeployError::BadRequest)
    }

    /// Every target, oldest first (the deploy button, the schedulers).
    pub async fn targets(&self, with_callbacks: bool) -> Result<Vec<Target>, DeployError> {
        self.load_targets(with_callbacks, "", &[], "").await
    }

    /// A page of targets (`page` from 1), oldest first, and how many there are.
    pub async fn targets_page(
        &self,
        with_callbacks: bool,
        page: u64,
        page_size: u64,
    ) -> Result<(Vec<Target>, u64), DeployError> {
        let targets = self.load_targets(with_callbacks, "", &[], &limit(page, page_size)).await?;
        Ok((targets, self.count(DEPLOY_TARGETS, "", &[]).await?))
    }

    async fn count(&self, table: &str, filter: &str, params: &[V]) -> Result<u64, DeployError> {
        Ok(self
            .inner
            .db
            .queries()
            .fetch_all(&format!("SELECT COUNT(*) FROM {table}{filter}"), params, &[K::BigInt])
            .await
            .map_err(db)?
            .first()
            .and_then(|row| row[0].as_i64())
            .unwrap_or_default()
            .max(0) as u64)
    }

    async fn load_targets(
        &self,
        with_callbacks: bool,
        filter: &str,
        params: &[V],
        limit: &str,
    ) -> Result<Vec<Target>, DeployError> {
        let rows = self
            .inner
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, name, url, secret, created_at, updated_at FROM {DEPLOY_TARGETS}{filter} ORDER BY id{limit}"),
                params,
                &[K::BigInt, K::Text, K::Text, K::Text, K::DateTime, K::DateTime],
            )
            .await.map_err(db)?;
        let mut targets = Vec::with_capacity(rows.len());
        for row in rows {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            let id = next().as_i64().unwrap_or_default();
            let name = next().into_text().unwrap_or_default();
            let url = next().into_text().unwrap_or_default();
            let secret = next().into_text().unwrap_or_default();
            let (created_at, updated_at) = (at(&next()), at(&next()));
            let last_deployment = self.latest_deployment(id).await?;
            targets.push(Target {
                id,
                name,
                host: host_of(&url),
                callback_path: with_callbacks.then(|| format!("/deploy/callback/{id}/{secret}")),
                last_deployment,
                created_at,
                updated_at,
            });
        }
        Ok(targets)
    }

    pub async fn target(&self, id: i64, with_callback: bool) -> Result<Target, DeployError> {
        self.load_targets(with_callback, " WHERE id = ?", &[V::BigInt(id)], "")
            .await?
            .into_iter()
            .next()
            .ok_or(DeployError::NotFound)
    }

    pub async fn create_target(&self, name: &str, url: &str) -> Result<Target, DeployError> {
        self.check(name, url)?;
        let now = now();
        let id = self
            .inner
            .db
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {DEPLOY_TARGETS} (name, url, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
                ),
                &[
                    V::Text(name.trim().into()),
                    V::Text(url.into()),
                    V::Text(verdin_auth::crypto::random_hex::<32>()),
                    V::DateTime(now),
                    V::DateTime(now),
                ],
            )
            .await.map_err(db)?;
        self.target(id, true).await
    }

    /// Renames a target, or points it at another hook (`url`).
    pub async fn update_target(
        &self,
        id: i64,
        name: Option<&str>,
        url: Option<&str>,
    ) -> Result<Target, DeployError> {
        let current = self.target(id, false).await?;
        let name = name.unwrap_or(&current.name);
        let mut assignments = vec!["name = ?", "updated_at = ?"];
        let mut params = vec![V::Text(name.trim().into()), V::DateTime(now())];
        if let Some(url) = url {
            self.check(name, url)?;
            assignments.push("url = ?");
            params.push(V::Text(url.into()));
        } else {
            self.check(name, "https://example.com")?;
        }
        params.push(V::BigInt(id));
        self.inner
            .db
            .queries()
            .execute(
                &format!("UPDATE {DEPLOY_TARGETS} SET {} WHERE id = ?", assignments.join(", ")),
                &params,
            )
            .await
            .map_err(db)?;
        self.target(id, true).await
    }

    pub async fn delete_target(&self, id: i64) -> Result<(), DeployError> {
        let deleted = self
            .inner
            .db
            .queries()
            .execute(&format!("DELETE FROM {DEPLOY_TARGETS} WHERE id = ?"), &[V::BigInt(id)])
            .await
            .map_err(db)?;
        if deleted == 0 { Err(DeployError::NotFound) } else { Ok(()) }
    }

    /// A page of deployments (`page` from 1), newest first, of one target or all, and how
    /// many there are.
    pub async fn deployments(
        &self,
        target: Option<i64>,
        page: u64,
        page_size: u64,
    ) -> Result<(Vec<Deployment>, u64), DeployError> {
        let (filter, params) = match target {
            Some(id) => (" WHERE target_id = ?", vec![V::BigInt(id)]),
            None => ("", Vec::new()),
        };
        let deployments = self.load_deployments(filter, &params, &limit(page, page_size)).await?;
        Ok((deployments, self.count(DEPLOYMENTS, filter, &params).await?))
    }

    async fn latest_deployment(&self, target: i64) -> Result<Option<Deployment>, DeployError> {
        Ok(self
            .load_deployments(" WHERE target_id = ?", &[V::BigInt(target)], " LIMIT 1")
            .await?
            .into_iter()
            .next())
    }

    async fn load_deployments(
        &self,
        filter: &str,
        params: &[V],
        limit: &str,
    ) -> Result<Vec<Deployment>, DeployError> {
        let rows = self
            .inner
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT {DEPLOYMENT_COLUMNS} FROM {DEPLOYMENTS}{filter} ORDER BY id DESC{limit}"
                ),
                params,
                &DEPLOYMENT_KINDS,
            )
            .await
            .map_err(db)?;
        Ok(rows.into_iter().map(deployment).collect())
    }

    /// Calls the target's hook and records the deploy.
    pub async fn trigger(
        &self,
        id: i64,
        by: Option<i64>,
        by_email: &str,
    ) -> Result<Deployment, DeployError> {
        let rows = self
            .inner
            .db
            .queries()
            .fetch_all(
                &format!("SELECT url FROM {DEPLOY_TARGETS} WHERE id = ?"),
                &[V::BigInt(id)],
                &[K::Text],
            )
            .await
            .map_err(db)?;
        let url = rows
            .into_iter()
            .next()
            .and_then(|row| row.into_iter().next()?.into_text())
            .ok_or(DeployError::NotFound)?;
        let last = self
            .inner
            .db
            .queries()
            .fetch_all(
                &format!("SELECT created_at FROM {DEPLOYMENTS} WHERE target_id = ? ORDER BY id DESC LIMIT 1"),
                &[V::BigInt(id)],
                &[K::DateTime],
            )
            .await.map_err(db)?;
        if let Some(V::DateTime(created)) =
            last.into_iter().next().and_then(|row| row.into_iter().next())
            && now() - created < MIN_INTERVAL
        {
            return Err(DeployError::TooManyRequests);
        }
        let (status, http_status, message) =
            match crate::webhooks::check_url(&url, self.inner.allow_private) {
                Err(error) => ("failed", None, Some(error)),
                Ok(()) => {
                    let body = json!({ "trigger": "verdin", "triggeredBy": by_email });
                    match self.inner.client.post(&url).json(&body).send().await {
                        Ok(response) if response.status().is_success() => {
                            ("triggered", Some(i64::from(response.status().as_u16())), None)
                        }
                        Ok(response) => (
                            "failed",
                            Some(i64::from(response.status().as_u16())),
                            Some(format!("the hook answered {}", response.status())),
                        ),
                        Err(error) => ("failed", None, Some(crate::webhooks::describe(&error))),
                    }
                }
            };
        let now = now();
        let deployment = self
            .inner
            .db
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {DEPLOYMENTS} (target_id, status, http_status, message, triggered_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::BigInt(id),
                    V::Text(status.into()),
                    http_status.map_or(V::Null(K::Int), |code| V::Int(code as i32)),
                    message.map_or(V::Null(K::Text), V::Text),
                    by.map_or(V::Null(K::BigInt), V::BigInt),
                    V::DateTime(now),
                    V::DateTime(now),
                ],
            )
            .await.map_err(db)?;
        self.deployment(deployment).await?.ok_or(DeployError::NotFound)
    }

    async fn deployment(&self, id: i64) -> Result<Option<Deployment>, DeployError> {
        let rows = self
            .inner
            .db
            .queries()
            .fetch_all(
                &format!("SELECT {DEPLOYMENT_COLUMNS} FROM {DEPLOYMENTS} WHERE id = ?"),
                &[V::BigInt(id)],
                &DEPLOYMENT_KINDS,
            )
            .await
            .map_err(db)?;
        Ok(rows.into_iter().next().map(deployment))
    }

    /// A provider reports the state of the target's latest deploy. `false` when the secret
    /// does not match.
    pub async fn report(&self, id: i64, secret: &str, body: &Json) -> Result<bool, DeployError> {
        let rows = self
            .inner
            .db
            .queries()
            .fetch_all(
                &format!("SELECT secret FROM {DEPLOY_TARGETS} WHERE id = ?"),
                &[V::BigInt(id)],
                &[K::Text],
            )
            .await
            .map_err(db)?;
        let Some(expected) =
            rows.into_iter().next().and_then(|row| row.into_iter().next()?.into_text())
        else {
            return Ok(false);
        };
        let matches =
            verdin_auth::crypto::sha256_hex(secret) == verdin_auth::crypto::sha256_hex(&expected);
        if !matches {
            return Ok(false);
        }
        let Some(status) = reported_status(body) else {
            return Err(DeployError::BadRequest("send `status`: building, ready or error".into()));
        };
        let url = ["url", "deploy_ssl_url", "ssl_url", "deploymentUrl"]
            .iter()
            .find_map(|key| body.get(key).and_then(Json::as_str))
            .or_else(|| body.pointer("/payload/deployment/url").and_then(Json::as_str))
            .filter(|url| url.len() <= 2048)
            .map(|url| if url.contains("://") { url.to_owned() } else { format!("https://{url}") });
        let message = ["message", "error_message"]
            .iter()
            .find_map(|key| body.get(key).and_then(Json::as_str))
            .map(|text| text.chars().take(1000).collect::<String>());
        let Some(latest) = self.latest_deployment(id).await? else {
            return Ok(true);
        };
        self.inner
            .db
            .queries()
            .execute(
                &format!(
                    "UPDATE {DEPLOYMENTS} SET status = ?, url = COALESCE(?, url), message = COALESCE(?, message), updated_at = ? WHERE id = ?"
                ),
                &[
                    V::Text(status.into()),
                    url.map_or(V::Null(K::Text), V::Text),
                    message.map_or(V::Null(K::Text), V::Text),
                    V::DateTime(now()),
                    V::BigInt(latest.id),
                ],
            )
            .await.map_err(db)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_provider_states() {
        assert_eq!(reported_status(&json!({ "state": "building" })), Some("building"));
        assert_eq!(reported_status(&json!({ "state": "ready" })), Some("ready"));
        assert_eq!(reported_status(&json!({ "type": "deployment.succeeded" })), Some("ready"));
        assert_eq!(reported_status(&json!({ "type": "deployment.error" })), Some("error"));
        assert_eq!(reported_status(&json!({ "status": "Failed" })), Some("error"));
        assert_eq!(reported_status(&json!({ "status": "dancing" })), None);
    }
}
