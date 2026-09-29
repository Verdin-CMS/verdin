//! Admins' own accounts: invitations, password resets by email, their sessions, and
//! regenerating API tokens. One-time links are random tokens stored as SHA-256 in
//! `vd_admin_tokens`.

use serde::Serialize;
use time::{Duration, OffsetDateTime};
use verdin_db::value::format_datetime;
use verdin_db::{ColumnKind as K, SqlValue as V};
use verdin_migrate::system::{ADMIN_TOKENS, ADMIN_USERS, API_TOKENS, SESSIONS};

use super::{
    API_TOKEN_PREFIX, ApiToken, AuthError, AuthService, Result, Session, UserUpdate, int, now,
};
use crate::crypto::{hmac_hex, random_token, sha256_hex};

/// How long an invitation link works.
pub const INVITE_TTL: Duration = Duration::days(7);
/// How long a password reset link works.
pub const RESET_TTL: Duration = Duration::hours(1);
/// One reset email per account in this time, whatever is asked.
const RESET_THROTTLE: Duration = Duration::minutes(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Invite,
    Reset,
}

impl LinkKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Invite => "invite",
            Self::Reset => "reset",
        }
    }
}

/// One signed-in device of an admin (a refresh token family).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub user_agent: Option<String>,
    pub created_at: String,
    /// When its refresh token was last rotated.
    pub last_used_at: String,
    pub expires_at: String,
}

impl AuthService {
    /// A new one-time link for `user_id` (earlier unused links of that kind stop working);
    /// returns the token to put in the URL.
    pub async fn issue_link(&self, user_id: i64, kind: LinkKind) -> Result<String> {
        let token = random_token();
        let ttl = match kind {
            LinkKind::Invite => INVITE_TTL,
            LinkKind::Reset => RESET_TTL,
        };
        let now = now();
        let mut tx = self.db.begin().await?;
        tx.execute(
            &format!(
                "DELETE FROM {ADMIN_TOKENS} WHERE user_id = ? AND kind = ? AND used_at IS NULL"
            ),
            &[V::BigInt(user_id), V::from(kind.as_str())],
        )
        .await?;
        tx.execute(
            &format!(
                "INSERT INTO {ADMIN_TOKENS} (user_id, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
            ),
            &[
                V::BigInt(user_id),
                V::from(kind.as_str()),
                V::Text(sha256_hex(&token)),
                V::DateTime(now + ttl),
                V::DateTime(now),
            ],
        )
        .await?;
        tx.commit().await?;
        Ok(token)
    }

    /// The admin a valid (unused, unexpired) link belongs to.
    pub async fn link_user(&self, token: &str, kind: LinkKind) -> Result<super::AdminUser> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT user_id FROM {ADMIN_TOKENS} WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?"
                ),
                &[V::Text(sha256_hex(token)), V::from(kind.as_str()), V::DateTime(now())],
                &[K::BigInt],
            )
            .await?;
        let row = rows.into_iter().next().ok_or(AuthError::NotFound)?;
        let user = self.user(int(&row[0])).await?;
        if !user.is_active {
            return Err(AuthError::NotFound);
        }
        Ok(user)
    }

    /// Uses a link: sets the password (and the names, for invitations), unlocks the
    /// account and ends its other sessions.
    pub async fn use_link(
        &self,
        token: &str,
        kind: LinkKind,
        password: &str,
        update: UserUpdate,
    ) -> Result<super::AdminUser> {
        super::check_password(password)?;
        let user = self.link_user(token, kind).await?;
        let claimed = self
            .db
            .queries()
            .execute(
                &format!(
                    "UPDATE {ADMIN_TOKENS} SET used_at = ? WHERE token_hash = ? AND used_at IS NULL"
                ),
                &[V::DateTime(now()), V::Text(sha256_hex(token))],
            )
            .await?;
        if claimed != 1 {
            return Err(AuthError::NotFound);
        }
        let update = UserUpdate { password: Some(password.to_owned()), ..update };
        let user = self.update_user(user.id, update).await?;
        self.db
            .queries()
            .execute(
                &format!(
                    "UPDATE {ADMIN_USERS} SET failed_logins = 0, locked_until = NULL WHERE id = ?"
                ),
                &[V::BigInt(user.id)],
            )
            .await?;
        Ok(user)
    }

    /// Accepts an invitation and signs the admin in (through their second factor, when
    /// they have one).
    pub async fn accept_invitation(
        &self,
        token: &str,
        password: &str,
        update: UserUpdate,
        user_agent: Option<&str>,
    ) -> Result<super::Login> {
        let user = self.use_link(token, LinkKind::Invite, password, update).await?;
        self.after_password(user.id, user_agent).await
    }

    /// A reset link for the active admin with this email, unless one was sent moments
    /// ago. `None` says nothing to send (callers answer the same either way).
    pub async fn request_reset(&self, email: &str) -> Result<Option<(super::AdminUser, String)>> {
        let user = match self.user_by_email(&email.trim().to_lowercase()).await {
            Ok(user) if user.is_active => user,
            Ok(_) | Err(AuthError::NotFound) => return Ok(None),
            Err(error) => return Err(error),
        };
        let recent = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT 1 FROM {ADMIN_TOKENS} WHERE user_id = ? AND kind = ? AND created_at > ?"
                ),
                &[
                    V::BigInt(user.id),
                    V::from(LinkKind::Reset.as_str()),
                    V::DateTime(now() - RESET_THROTTLE),
                ],
                &[K::Int],
            )
            .await?;
        if !recent.is_empty() {
            return Ok(None);
        }
        let token = self.issue_link(user.id, LinkKind::Reset).await?;
        Ok(Some((user, token)))
    }

    /// Whether the admin ever signed in (sessions predating `signed_in_at` count too).
    pub async fn has_signed_in(&self, user_id: i64) -> Result<bool> {
        Ok(self
            .db
            .queries()
            .has_rows(
                &format!(
                    "SELECT 1 FROM {ADMIN_USERS} WHERE id = ? AND (signed_in_at IS NOT NULL OR EXISTS (SELECT 1 FROM {SESSIONS} WHERE user_id = ?))"
                ),
                &[V::BigInt(user_id), V::BigInt(user_id)],
            )
            .await?)
    }

    /// Whether the admin has never set a password of their own (an invitation is pending).
    pub async fn invitation_pending(&self, user_id: i64) -> Result<bool> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT 1 FROM {ADMIN_TOKENS} WHERE user_id = ? AND kind = ? AND used_at IS NULL AND expires_at > ?"
                ),
                &[V::BigInt(user_id), V::from(LinkKind::Invite.as_str()), V::DateTime(now())],
                &[K::Int],
            )
            .await?;
        Ok(!rows.is_empty())
    }

    /// Whether `password` is the admin's current one (to confirm sensitive changes).
    pub async fn check_current_password(&self, user_id: i64, password: &str) -> Result<bool> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT password_hash FROM {ADMIN_USERS} WHERE id = ?"),
                &[V::BigInt(user_id)],
                &[K::Text],
            )
            .await?;
        let hash = rows.into_iter().next().and_then(|row| super::text(row[0].clone()));
        Ok(hash.is_some_and(|hash| crate::crypto::verify_password(password, &hash)))
    }

    /// A new session for an admin who just proved who they are (after a password change).
    pub async fn start_session(&self, user_id: i64, user_agent: Option<&str>) -> Result<Session> {
        let user = self.user(user_id).await?;
        self.open_session(user, user_agent).await
    }

    // ------------------------------------------------------------- sessions

    /// The admin's signed-in devices, most recently used first.
    pub async fn sessions(&self, user_id: i64) -> Result<Vec<SessionInfo>> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT family, MAX(user_agent), MIN(created_at), MAX(created_at), MAX(expires_at) FROM {SESSIONS} \
                     WHERE user_id = ? GROUP BY family \
                     HAVING SUM(CASE WHEN revoked_at IS NULL AND used_at IS NULL AND expires_at > ? THEN 1 ELSE 0 END) > 0 \
                     ORDER BY MAX(created_at) DESC"
                ),
                &[V::BigInt(user_id), V::DateTime(now())],
                &[K::Text, K::Text, K::DateTime, K::DateTime, K::DateTime],
            )
            .await?;
        let at = |value: &V| match value {
            V::DateTime(at) => format_datetime(*at),
            _ => String::new(),
        };
        Ok(rows
            .into_iter()
            .map(|row| SessionInfo {
                id: super::text(row[0].clone()).unwrap_or_default(),
                user_agent: super::text(row[1].clone()),
                created_at: at(&row[2]),
                last_used_at: at(&row[3]),
                expires_at: at(&row[4]),
            })
            .collect())
    }

    /// The session (family) a refresh token belongs to.
    pub async fn session_of(&self, refresh_token: &str) -> Result<Option<String>> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT family FROM {SESSIONS} WHERE token_hash = ?"),
                &[V::Text(sha256_hex(refresh_token))],
                &[K::Text],
            )
            .await?;
        Ok(rows.into_iter().next().and_then(|row| super::text(row[0].clone())))
    }

    /// Signs one of the admin's devices out.
    pub async fn revoke_session(&self, user_id: i64, family: &str) -> Result<()> {
        let revoked = self
            .db
            .queries()
            .execute(
                &format!(
                    "UPDATE {SESSIONS} SET revoked_at = ? WHERE user_id = ? AND family = ? AND revoked_at IS NULL"
                ),
                &[V::DateTime(now()), V::BigInt(user_id), V::Text(family.to_owned())],
            )
            .await?;
        if revoked == 0 { Err(AuthError::NotFound) } else { Ok(()) }
    }

    // ----------------------------------------------------------- API tokens

    /// A new secret for an API token; the old one stops working at once.
    pub async fn regenerate_api_token(&self, id: i64) -> Result<(ApiToken, String)> {
        let secret = format!("{API_TOKEN_PREFIX}{}", random_token());
        let updated = self
            .db
            .queries()
            .execute(
                &format!(
                    "UPDATE {API_TOKENS} SET token_hash = ?, token_prefix = ?, last_used_at = NULL, updated_at = ? WHERE id = ?"
                ),
                &[
                    V::Text(hmac_hex(&self.config.token_pepper, &secret)),
                    V::Text(secret.chars().take(10).collect()),
                    V::DateTime(now()),
                    V::BigInt(id),
                ],
            )
            .await?;
        if updated == 0 {
            return Err(AuthError::NotFound);
        }
        Ok((self.api_token(id).await?, secret))
    }
}

/// When a link made now expires (for emails).
pub fn expires(kind: LinkKind) -> OffsetDateTime {
    now()
        + match kind {
            LinkKind::Invite => INVITE_TTL,
            LinkKind::Reset => RESET_TTL,
        }
}
