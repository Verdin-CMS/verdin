//! The daily email of unseen changes: admins who opt in (preference `digest: "daily"`) get,
//! once a day at `[digest].hour_utc`, how many entries changed since they last looked, per
//! content type they can read.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde_json::Value;
use time::OffsetDateTime;
use verdin_auth::{AdminPrincipal, AuthService};
use verdin_content::DocumentService;
use verdin_email::{Mailer, Message};
use verdin_query::Limits;

use crate::error::ApiError;

#[derive(Clone)]
pub struct Digest {
    inner: Arc<Inner>,
}

struct Inner {
    auth: AuthService,
    mailer: Mailer,
    /// Link in the email (`https://cms.example.com/admin/`).
    admin_url: String,
    hour_utc: u8,
    /// The current Document Service and query limits (replaced when the app is rebuilt).
    context: RwLock<Option<(DocumentService, Limits)>>,
}

/// One admin's unseen entries: `(display name, count)` by content type.
pub type Unseen = Vec<(String, u64)>;

impl Digest {
    pub fn new(auth: AuthService, mailer: Mailer, admin_url: String, hour_utc: u8) -> Self {
        Self {
            inner: Arc::new(Inner {
                auth,
                mailer,
                admin_url,
                hour_utc: hour_utc.min(23),
                context: RwLock::new(None),
            }),
        }
    }

    pub fn set_context(&self, service: DocumentService, limits: Limits) {
        *self.inner.context.write().expect("digest context") = Some((service, limits));
    }

    /// Whether an admin's preferences ask for the digest.
    pub fn wants(preferences: &Value) -> bool {
        preferences["digest"] == "daily"
    }

    pub async fn unseen(&self, principal: &AdminPrincipal) -> Result<Unseen, ApiError> {
        let Some((service, limits)) = self.inner.context.read().expect("digest context").clone()
        else {
            return Ok(Vec::new());
        };
        let counts = crate::admin::engagement::unseen(&service, &limits, principal).await?;
        let registry = service.registry();
        Ok(counts
            .into_iter()
            .filter_map(|(uid, count)| {
                let count = count.as_u64().filter(|count| *count > 0)?;
                let name = registry
                    .get(&uid)
                    .map_or_else(|_| uid.clone(), |model| model.content_type.display_name.clone());
                Some((name, count))
            })
            .collect())
    }

    fn message(&self, to: &str, name: &str, unseen: &Unseen) -> Message {
        let total: u64 = unseen.iter().map(|(_, count)| count).sum();
        let lines: String =
            unseen.iter().map(|(type_name, count)| format!("- {type_name}: {count}\n")).collect();
        let items: String = unseen
            .iter()
            .map(|(type_name, count)| {
                let mut values = BTreeMap::new();
                values.insert("name", type_name.clone());
                values.insert("count", count.to_string());
                verdin_email::render("<li>{{name}}: <strong>{{count}}</strong></li>", &values, true)
            })
            .collect();
        let mut values = BTreeMap::new();
        values.insert("name", name.to_owned());
        values.insert("url", self.inner.admin_url.clone());
        let intro = verdin_email::render("Hello {{name}},", &values, true);
        let link = verdin_email::render("<a href=\"{{url}}\">Open Verdin</a>", &values, true);
        Message {
            to: to.to_owned(),
            subject: format!(
                "{total} {} waiting for you in Verdin",
                if total == 1 { "change" } else { "changes" }
            ),
            text: format!(
                "Hello {name},\n\nEntries changed since you last looked at them:\n\n{lines}\n{}\n\n\
                 You get this email because you asked for a daily digest (profile preferences).\n",
                self.inner.admin_url
            ),
            html: Some(format!(
                "<p>{intro}</p><p>Entries changed since you last looked at them:</p><ul>{items}</ul>\
                 <p>{link}</p><p style=\"color:#666\">You get this email because you asked for a \
                 daily digest (profile preferences).</p>"
            )),
        }
    }

    /// Emails every active admin who asked for it and has something unseen; returns how many
    /// were sent.
    pub async fn send_all(&self) -> Result<usize, ApiError> {
        let auth = &self.inner.auth;
        let mut sent = 0;
        for user in auth.users().await? {
            if !user.is_active || !Self::wants(&auth.preferences(user.id).await?) {
                continue;
            }
            let permissions = auth.permission_set(user.id).await?;
            let principal = AdminPrincipal { user, permissions };
            let unseen = self.unseen(&principal).await?;
            if unseen.is_empty() {
                continue;
            }
            let user = &principal.user;
            let name = user.firstname.clone().unwrap_or_else(|| user.email.clone());
            match self.inner.mailer.send(&self.message(&user.email, &name, &unseen)).await {
                Ok(()) => sent += 1,
                Err(error) => tracing::warn!(%error, user = user.id, "could not send the digest"),
            }
        }
        Ok(sent)
    }

    /// Takes today's run: with several instances, only the first one to insert today's
    /// marker sends the digest.
    pub async fn claim(&self, day: time::Date) -> Result<bool, ApiError> {
        let Some(db) = self
            .inner
            .context
            .read()
            .expect("digest context")
            .as_ref()
            .map(|(service, _)| service.db().clone())
        else {
            return Ok(false);
        };
        let key = if db.flavor().is_mysql_family() { "`key`" } else { "\"key\"" };
        let at = verdin_db::value::truncate_millis(OffsetDateTime::now_utc());
        let marker = format!("digest.sent:{day}");
        let inserted = db
            .queries()
            .execute(
                &format!(
                    "INSERT INTO {} ({key}, value, updated_at) VALUES (?, ?, ?)",
                    verdin_migrate::system::SETTINGS
                ),
                &[
                    verdin_db::SqlValue::Text(marker),
                    verdin_db::SqlValue::Json(Value::Bool(true)),
                    verdin_db::SqlValue::DateTime(at),
                ],
            )
            .await;
        match inserted {
            Ok(_) => {
                // Markers older than a week are of no use.
                let old = format!("digest.sent:{}", day - time::Duration::days(7));
                let _ = db
                    .queries()
                    .execute(
                        &format!(
                            "DELETE FROM {} WHERE {key} LIKE 'digest.sent:%' AND {key} < ?",
                            verdin_migrate::system::SETTINGS
                        ),
                        &[verdin_db::SqlValue::Text(old)],
                    )
                    .await;
                Ok(true)
            }
            Err(error) if error.unique_violation().is_some() => Ok(false),
            Err(error) => Err(ApiError::Internal(error.to_string())),
        }
    }

    pub fn spawn(&self) -> tokio::task::JoinHandle<()> {
        let digest = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(until_next(digest.inner.hour_utc, OffsetDateTime::now_utc()))
                    .await;
                match digest.claim(OffsetDateTime::now_utc().date()).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(error) => {
                        tracing::warn!(?error, "could not take the daily digest run");
                        continue;
                    }
                }
                match digest.send_all().await {
                    Ok(sent) => tracing::info!(sent, "daily digest sent"),
                    Err(error) => tracing::warn!(?error, "daily digest failed"),
                }
            }
        })
    }
}

/// Time until the next `hour:00` UTC.
fn until_next(hour: u8, now: OffsetDateTime) -> Duration {
    let today = now.replace_time(time::Time::from_hms(hour, 0, 0).expect("hour below 24"));
    let next = if today > now { today } else { today + time::Duration::days(1) };
    Duration::try_from(next - now).unwrap_or(Duration::from_secs(3600))
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    #[test]
    fn schedules_and_opts_in() {
        let now = datetime!(2026-09-28 07:30 UTC);
        assert_eq!(until_next(8, now), Duration::from_secs(1800));
        assert_eq!(until_next(7, now), Duration::from_secs(23 * 3600 + 1800));
        assert!(Digest::wants(&serde_json::json!({ "digest": "daily" })));
        assert!(!Digest::wants(&serde_json::json!({})));
    }
}
