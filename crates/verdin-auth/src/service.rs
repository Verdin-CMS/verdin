//! Admin sessions, users, roles, API tokens and public permissions.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use regex::Regex;
use serde::Serialize;
use time::{Duration, OffsetDateTime};
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, Flavor, SqlValue as V, Tx};
use verdin_migrate::system::{
    ADMIN_PERMISSIONS, ADMIN_ROLES, ADMIN_USER_ROLES, ADMIN_USERS, API_TOKEN_PERMISSIONS,
    API_TOKENS, PUBLIC_PERMISSIONS, SESSIONS, SETTINGS,
};

use crate::crypto::{
    self, ADMIN_AUDIENCE, Claims, ISSUER, decode_jwt, encode_jwt, hash_password, hmac_hex,
    needs_rehash, random_hex, random_token, sha256_hex, verify_password,
};
use crate::permissions::{
    BUILTIN_PERMISSIONS_VERSION, ContentAction, ContentActor, Grants, Permission, PermissionSet,
    SUPER_ADMIN, TokenKind, builtin_additions, builtin_roles,
};

const PERMISSIONS_VERSION_KEY: &str = "builtin_permissions_version";

pub const MIN_SECRET_BYTES: usize = 32;
pub const MIN_PASSWORD: usize = 8;
pub const MAX_PASSWORD: usize = 128;
const API_TOKEN_PREFIX: &str = "vd_";

static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap());

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Forbidden")]
    Forbidden,
    #[error("an admin already exists")]
    AlreadyInitialized,
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Not Found")]
    NotFound,
    #[error("{0}")]
    InvalidConfig(String),
    #[error(transparent)]
    Db(#[from] DbError),
}

pub type Result<T> = std::result::Result<T, AuthError>;

#[derive(Debug, Clone)]
pub struct AuthConfig {
    jwt_secret: Vec<u8>,
    token_pepper: Vec<u8>,
    pub access_ttl: Duration,
    pub refresh_ttl: Duration,
    pub max_failed_logins: i32,
    pub lockout: Duration,
}

impl AuthConfig {
    /// Secrets must each be at least 32 bytes.
    pub fn new(jwt_secret: &str, token_pepper: &str) -> Result<Self> {
        for (name, value) in
            [("VERDIN_ADMIN_JWT_SECRET", jwt_secret), ("VERDIN_TOKEN_PEPPER", token_pepper)]
        {
            if value.len() < MIN_SECRET_BYTES {
                return Err(AuthError::InvalidConfig(format!(
                    "{name} must be at least {MIN_SECRET_BYTES} bytes (generate one with `verdin secrets`)"
                )));
            }
        }
        Ok(Self {
            jwt_secret: jwt_secret.as_bytes().to_vec(),
            token_pepper: token_pepper.as_bytes().to_vec(),
            access_ttl: Duration::minutes(15),
            refresh_ttl: Duration::days(30),
            max_failed_logins: 5,
            lockout: Duration::minutes(15),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleSummary {
    pub id: i64,
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    pub id: i64,
    pub email: String,
    pub firstname: Option<String>,
    pub lastname: Option<String>,
    pub is_active: bool,
    pub roles: Vec<RoleSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub builtin: bool,
    pub permissions: Vec<Permission>,
}

/// A logged-in admin: new access token plus a rotated refresh token.
#[derive(Debug, Clone)]
pub struct Session {
    pub user: AdminUser,
    pub access_token: String,
    pub access_expires_at: OffsetDateTime,
    pub refresh_token: String,
    pub refresh_expires_at: OffsetDateTime,
}

/// The admin making a request.
/// Upper bound for a user's stored admin preferences.
pub const MAX_PREFERENCES_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct AdminPrincipal {
    pub user: AdminUser,
    pub permissions: PermissionSet,
}

#[derive(Debug, Clone, Default)]
pub struct NewUser {
    pub email: String,
    pub password: String,
    pub firstname: Option<String>,
    pub lastname: Option<String>,
    pub roles: Vec<i64>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Default)]
pub struct UserUpdate {
    pub email: Option<String>,
    pub password: Option<String>,
    pub firstname: Option<Option<String>>,
    pub lastname: Option<Option<String>>,
    pub roles: Option<Vec<i64>>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenGrant {
    pub subject: String,
    pub action: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiToken {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub kind: TokenKind,
    /// The first characters of the token, to recognise it.
    pub token_prefix: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub permissions: Vec<TokenGrant>,
}

#[derive(Debug, Clone)]
pub struct NewApiToken {
    pub name: String,
    pub description: Option<String>,
    pub kind: TokenKind,
    pub expires_in_days: Option<u32>,
    pub permissions: Vec<(String, ContentAction)>,
}

#[derive(Debug, Clone, Default)]
pub struct ApiTokenUpdate {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub kind: Option<TokenKind>,
    pub permissions: Option<Vec<(String, ContentAction)>>,
}

#[derive(Clone)]
pub struct AuthService {
    db: Database,
    config: Arc<AuthConfig>,
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn text(value: V) -> Option<String> {
    value.into_text()
}

fn int(value: &V) -> i64 {
    value.as_i64().unwrap_or_default()
}

fn datetime(value: &V) -> Option<String> {
    match value {
        V::DateTime(value) => Some(format_datetime(*value)),
        _ => None,
    }
}

fn optional_text(value: Option<String>) -> V {
    value.map_or(V::Null(K::Text), V::Text)
}

/// `FOR UPDATE`, except on SQLite (whose write transactions already lock the database).
/// `key` is reserved in MySQL/MariaDB.
fn quoted_key(flavor: Flavor) -> &'static str {
    if flavor.is_mysql_family() { "`key`" } else { "\"key\"" }
}

fn for_update(flavor: Flavor) -> &'static str {
    if flavor == Flavor::Sqlite { "" } else { " FOR UPDATE" }
}

fn placeholders(count: usize) -> String {
    vec!["?"; count].join(", ")
}

fn normalize_email(email: &str) -> Result<String> {
    let email = email.trim().to_lowercase();
    if email.len() > 255 || !EMAIL.is_match(&email) {
        return Err(AuthError::Validation("email must be a valid address".into()));
    }
    Ok(email)
}

fn check_password(password: &str) -> Result<()> {
    if password.chars().count() < MIN_PASSWORD || password.len() > MAX_PASSWORD {
        return Err(AuthError::Validation(format!(
            "password must be {MIN_PASSWORD} to {MAX_PASSWORD} characters"
        )));
    }
    Ok(())
}

fn conflict_on_unique(error: DbError, message: &str) -> AuthError {
    if error.unique_violation().is_some() {
        AuthError::Conflict(message.into())
    } else {
        AuthError::Db(error)
    }
}

impl AuthService {
    pub fn new(db: Database, config: AuthConfig) -> Self {
        Self { db, config: Arc::new(config) }
    }

    /// Creates missing built-in roles. Idempotent; run at startup after migrations.
    pub async fn bootstrap(&self) -> Result<()> {
        let mut tx = self.db.begin().await?;
        // Installations older than the current built-in permissions get what was added
        // since, once: later edits of those roles are respected.
        let installed = tx.has_rows(&format!("SELECT 1 FROM {ADMIN_ROLES} LIMIT 1"), &[]).await?;
        let version = if installed {
            let rows = tx
                .fetch_all(
                    &format!("SELECT value FROM {SETTINGS} WHERE {} = ?", quoted_key(tx.flavor())),
                    &[V::from(PERMISSIONS_VERSION_KEY)],
                    &[K::Json],
                )
                .await?;
            match rows.first().map(|row| &row[0]) {
                Some(V::Json(value)) => value.as_i64().unwrap_or(1),
                _ => 1,
            }
        } else {
            BUILTIN_PERMISSIONS_VERSION
        };
        for upgrade in (version + 1)..=BUILTIN_PERMISSIONS_VERSION {
            for (code, permissions) in builtin_additions(upgrade) {
                let rows = tx
                    .fetch_all(
                        &format!("SELECT id FROM {ADMIN_ROLES} WHERE code = ? AND builtin = ?"),
                        &[V::from(code), V::Bool(true)],
                        &[K::BigInt],
                    )
                    .await?;
                if let Some(role_id) = rows.first().and_then(|row| row[0].as_i64()) {
                    insert_permissions(&mut tx, role_id, &permissions).await?;
                }
            }
        }
        if version != BUILTIN_PERMISSIONS_VERSION || !installed {
            let key = quoted_key(tx.flavor());
            tx.execute(
                &format!("DELETE FROM {SETTINGS} WHERE {key} = ?"),
                &[V::from(PERMISSIONS_VERSION_KEY)],
            )
            .await?;
            tx.execute(
                &format!("INSERT INTO {SETTINGS} ({key}, value, updated_at) VALUES (?, ?, ?)"),
                &[
                    V::from(PERMISSIONS_VERSION_KEY),
                    V::Json(serde_json::json!(BUILTIN_PERMISSIONS_VERSION)),
                    V::DateTime(now()),
                ],
            )
            .await?;
        }
        for (code, name, description, permissions) in builtin_roles() {
            let exists = tx
                .has_rows(&format!("SELECT 1 FROM {ADMIN_ROLES} WHERE code = ?"), &[V::from(code)])
                .await?;
            if exists {
                continue;
            }
            let now = now();
            let role_id = tx
                .insert_returning_id(
                    &format!(
                        "INSERT INTO {ADMIN_ROLES} (code, name, description, builtin, created_at, updated_at) \
                         VALUES (?, ?, ?, ?, ?, ?)"
                    ),
                    &[V::from(code), V::from(name), V::from(description), V::Bool(true), V::DateTime(now), V::DateTime(now)],
                )
                .await?;
            insert_permissions(&mut tx, role_id, &permissions).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn has_admin(&self) -> Result<bool> {
        Ok(self.db.queries().has_rows(&format!("SELECT 1 FROM {ADMIN_USERS} LIMIT 1"), &[]).await?)
    }

    // ------------------------------------------------------------- sessions

    /// Creates the first admin (a Super Admin) and logs them in. Fails once any admin exists.
    pub async fn register_first_admin(
        &self,
        user: NewUser,
        user_agent: Option<&str>,
    ) -> Result<Session> {
        let mut tx = self.db.begin().await?;
        // Serializes concurrent first registrations on the super admin role row.
        let role = tx
            .fetch_all(
                &format!("SELECT id FROM {ADMIN_ROLES} WHERE code = ?{}", for_update(tx.flavor())),
                &[V::from(SUPER_ADMIN)],
                &[K::BigInt],
            )
            .await?;
        let role_id = role.first().map(|row| int(&row[0])).ok_or_else(|| {
            AuthError::InvalidConfig("built-in roles are missing: run the server bootstrap".into())
        })?;
        if tx.has_rows(&format!("SELECT 1 FROM {ADMIN_USERS} LIMIT 1"), &[]).await? {
            return Err(AuthError::AlreadyInitialized);
        }
        let id =
            insert_user(&mut tx, NewUser { roles: vec![role_id], is_active: true, ..user }).await?;
        tx.commit().await?;
        let user = self.user(id).await?;
        self.open_session(user, user_agent).await
    }

    /// Checks credentials. Every failure is the same `InvalidCredentials`, whether the
    /// email is unknown, the password wrong, the account locked or deactivated.
    pub async fn login(
        &self,
        email: &str,
        password: &str,
        user_agent: Option<&str>,
    ) -> Result<Session> {
        let email = email.trim().to_lowercase();
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, password_hash, is_active, failed_logins, locked_until FROM {ADMIN_USERS} WHERE email = ?"
                ),
                &[V::Text(email)],
                &[K::BigInt, K::Text, K::Bool, K::Int, K::DateTime],
            )
            .await?;
        let Some(mut row) = rows.into_iter().next() else {
            crypto::dummy_verify(password);
            return Err(AuthError::InvalidCredentials);
        };
        let id = int(&row[0]);
        let hash = text(std::mem::replace(&mut row[1], V::Null(K::Text))).unwrap_or_default();
        let active = matches!(row[2], V::Bool(true));
        let failed = row[3].as_i64().unwrap_or_default() as i32;
        let now = now();
        if let V::DateTime(until) = row[4]
            && until > now
        {
            crypto::dummy_verify(password);
            return Err(AuthError::InvalidCredentials);
        }

        if !verify_password(password, &hash) {
            let failed = failed + 1;
            let (failed, locked_until) = if failed >= self.config.max_failed_logins {
                tracing::warn!(user = id, "admin account locked after repeated failed logins");
                (0, V::DateTime(now + self.config.lockout))
            } else {
                (failed, V::Null(K::DateTime))
            };
            self.db
                .queries()
                .execute(
                    &format!(
                        "UPDATE {ADMIN_USERS} SET failed_logins = ?, locked_until = ? WHERE id = ?"
                    ),
                    &[V::Int(failed), locked_until, V::BigInt(id)],
                )
                .await?;
            return Err(AuthError::InvalidCredentials);
        }
        if !active {
            return Err(AuthError::InvalidCredentials);
        }

        let mut sql = format!("UPDATE {ADMIN_USERS} SET failed_logins = 0, locked_until = NULL");
        let mut params = Vec::new();
        if needs_rehash(&hash) {
            sql.push_str(", password_hash = ?");
            params.push(V::Text(hash_password(password)));
        }
        sql.push_str(" WHERE id = ?");
        params.push(V::BigInt(id));
        self.db.queries().execute(&sql, &params).await?;

        let user = self.user(id).await?;
        self.open_session(user, user_agent).await
    }

    /// Rotates a refresh token. Presenting a token that was already rotated is treated as
    /// theft: the whole session family is revoked.
    pub async fn refresh(&self, refresh_token: &str, user_agent: Option<&str>) -> Result<Session> {
        let hash = sha256_hex(refresh_token);
        let mut tx = self.db.begin().await?;
        let rows = tx
            .fetch_all(
                &format!(
                    "SELECT id, user_id, family, expires_at, used_at, revoked_at FROM {SESSIONS} WHERE token_hash = ?{}",
                    for_update(tx.flavor())
                ),
                &[V::Text(hash)],
                &[K::BigInt, K::BigInt, K::Text, K::DateTime, K::DateTime, K::DateTime],
            )
            .await?;
        let Some(row) = rows.into_iter().next() else { return Err(AuthError::Unauthorized) };
        let (session_id, user_id) = (int(&row[0]), int(&row[1]));
        let family = row[2].as_text().unwrap_or_default().to_owned();
        let now = now();

        if !row[5].is_null() {
            return Err(AuthError::Unauthorized);
        }
        if !row[4].is_null() {
            tracing::warn!(
                user = user_id,
                "refresh token reuse detected; revoking the session family"
            );
            tx.execute(
                &format!(
                    "UPDATE {SESSIONS} SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL"
                ),
                &[V::DateTime(now), V::Text(family)],
            )
            .await?;
            tx.commit().await?;
            return Err(AuthError::Unauthorized);
        }
        if matches!(row[3], V::DateTime(expires_at) if expires_at <= now) {
            return Err(AuthError::Unauthorized);
        }
        tx.execute(
            &format!("UPDATE {SESSIONS} SET used_at = ? WHERE id = ?"),
            &[V::DateTime(now), V::BigInt(session_id)],
        )
        .await?;
        let (refresh_token, refresh_expires_at) =
            insert_session(&mut tx, user_id, &family, user_agent, &self.config).await?;
        tx.commit().await?;

        let user = self.user(user_id).await?;
        if !user.is_active {
            self.revoke_user_sessions(user_id).await?;
            return Err(AuthError::Unauthorized);
        }
        let (access_token, access_expires_at) = self.access_token(user_id);
        Ok(Session { user, access_token, access_expires_at, refresh_token, refresh_expires_at })
    }

    /// Revokes the session family of a refresh token (no-op for unknown tokens).
    pub async fn logout(&self, refresh_token: &str) -> Result<()> {
        let hash = sha256_hex(refresh_token);
        self.db
            .queries()
            .execute(
                &format!(
                    "UPDATE {SESSIONS} SET revoked_at = ? WHERE revoked_at IS NULL AND family IN \
                     (SELECT family FROM (SELECT family FROM {SESSIONS} WHERE token_hash = ?) AS matched)"
                ),
                &[V::DateTime(now()), V::Text(hash)],
            )
            .await?;
        Ok(())
    }

    /// Resolves an access token to an active admin and their permissions.
    pub async fn authenticate(&self, access_token: &str) -> Result<AdminPrincipal> {
        let claims = decode_jwt(
            &self.config.jwt_secret,
            access_token,
            ADMIN_AUDIENCE,
            OffsetDateTime::now_utc().unix_timestamp(),
        )
        .ok_or(AuthError::Unauthorized)?;
        let id: i64 = claims.sub.parse().map_err(|_| AuthError::Unauthorized)?;
        let user = match self.user(id).await {
            Ok(user) if user.is_active => user,
            Ok(_) | Err(AuthError::NotFound) => return Err(AuthError::Unauthorized),
            Err(error) => return Err(error),
        };
        let permissions = self.permission_set(id).await?;
        Ok(AdminPrincipal { user, permissions })
    }

    async fn open_session(&self, user: AdminUser, user_agent: Option<&str>) -> Result<Session> {
        let mut tx = self.db.begin().await?;
        let family = random_hex::<16>();
        let (refresh_token, refresh_expires_at) =
            insert_session(&mut tx, user.id, &family, user_agent, &self.config).await?;
        tx.commit().await?;
        let (access_token, access_expires_at) = self.access_token(user.id);
        Ok(Session { user, access_token, access_expires_at, refresh_token, refresh_expires_at })
    }

    fn access_token(&self, user_id: i64) -> (String, OffsetDateTime) {
        let issued = OffsetDateTime::now_utc();
        let expires = issued + self.config.access_ttl;
        let claims = Claims {
            sub: user_id.to_string(),
            iss: ISSUER.into(),
            aud: ADMIN_AUDIENCE.into(),
            iat: issued.unix_timestamp(),
            exp: expires.unix_timestamp(),
        };
        (encode_jwt(&self.config.jwt_secret, &claims), truncate_millis(expires))
    }

    async fn revoke_user_sessions(&self, user_id: i64) -> Result<()> {
        self.db
            .queries()
            .execute(
                &format!(
                    "UPDATE {SESSIONS} SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
                ),
                &[V::DateTime(now()), V::BigInt(user_id)],
            )
            .await?;
        Ok(())
    }

    // ---------------------------------------------------------------- users

    pub async fn users(&self) -> Result<Vec<AdminUser>> {
        self.load_users(None).await
    }

    pub async fn user(&self, id: i64) -> Result<AdminUser> {
        self.load_users(Some(id)).await?.into_iter().next().ok_or(AuthError::NotFound)
    }

    pub async fn user_by_email(&self, email: &str) -> Result<AdminUser> {
        let email = normalize_email(email)?;
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id FROM {ADMIN_USERS} WHERE email = ?"),
                &[V::Text(email)],
                &[K::BigInt],
            )
            .await?;
        let id = rows.first().map(|row| int(&row[0])).ok_or(AuthError::NotFound)?;
        self.user(id).await
    }

    async fn load_users(&self, id: Option<i64>) -> Result<Vec<AdminUser>> {
        let (filter, params) = match id {
            Some(id) => (" WHERE id = ?", vec![V::BigInt(id)]),
            None => ("", Vec::new()),
        };
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, email, firstname, lastname, is_active, created_at, updated_at FROM {ADMIN_USERS}{filter} ORDER BY id"
                ),
                &params,
                &[K::BigInt, K::Text, K::Text, K::Text, K::Bool, K::DateTime, K::DateTime],
            )
            .await?;
        let role_rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT ur.user_id, r.id, r.code, r.name FROM {ADMIN_USER_ROLES} ur \
                     JOIN {ADMIN_ROLES} r ON r.id = ur.role_id ORDER BY r.id"
                ),
                &[],
                &[K::BigInt, K::BigInt, K::Text, K::Text],
            )
            .await?;
        let mut roles: HashMap<i64, Vec<RoleSummary>> = HashMap::new();
        for row in role_rows {
            let mut row = row.into_iter();
            let user = int(&row.next().expect("user_id"));
            let id = int(&row.next().expect("id"));
            let code = row.next().and_then(text).unwrap_or_default();
            let name = row.next().and_then(text).unwrap_or_default();
            roles.entry(user).or_default().push(RoleSummary { id, code, name });
        }
        Ok(rows
            .into_iter()
            .map(|row| {
                let id = int(&row[0]);
                let mut row = row.into_iter();
                row.next();
                AdminUser {
                    id,
                    email: row.next().and_then(text).unwrap_or_default(),
                    firstname: row.next().and_then(text),
                    lastname: row.next().and_then(text),
                    is_active: matches!(row.next(), Some(V::Bool(true))),
                    created_at: row.next().as_ref().and_then(datetime).unwrap_or_default(),
                    updated_at: row.next().as_ref().and_then(datetime).unwrap_or_default(),
                    roles: roles.remove(&id).unwrap_or_default(),
                }
            })
            .collect())
    }

    /// The user's admin panel preferences (an object; `{}` until first saved).
    pub async fn preferences(&self, user_id: i64) -> Result<serde_json::Value> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT preferences FROM {ADMIN_USERS} WHERE id = ?"),
                &[V::BigInt(user_id)],
                &[K::Json],
            )
            .await?;
        let row = rows.into_iter().next().ok_or(AuthError::NotFound)?;
        Ok(match row.into_iter().next() {
            Some(V::Json(value)) if value.is_object() => value,
            _ => serde_json::json!({}),
        })
    }

    /// Replaces the user's preferences: a JSON object of at most [`MAX_PREFERENCES_BYTES`].
    pub async fn set_preferences(&self, user_id: i64, value: serde_json::Value) -> Result<()> {
        if !value.is_object() {
            return Err(AuthError::Validation("preferences must be an object".into()));
        }
        if value.to_string().len() > MAX_PREFERENCES_BYTES {
            return Err(AuthError::Validation(format!(
                "preferences exceed {} KiB",
                MAX_PREFERENCES_BYTES / 1024
            )));
        }
        let updated = self
            .db
            .queries()
            .execute(
                &format!("UPDATE {ADMIN_USERS} SET preferences = ? WHERE id = ?"),
                &[V::Json(value), V::BigInt(user_id)],
            )
            .await?;
        if updated == 0 {
            return Err(AuthError::NotFound);
        }
        Ok(())
    }

    pub async fn create_user(&self, user: NewUser) -> Result<AdminUser> {
        if user.roles.is_empty() {
            return Err(AuthError::Validation("a user needs at least one role".into()));
        }
        let mut tx = self.db.begin().await?;
        let id = insert_user(&mut tx, user).await?;
        tx.commit().await?;
        self.user(id).await
    }

    pub async fn update_user(&self, id: i64, update: UserUpdate) -> Result<AdminUser> {
        let mut tx = self.db.begin().await?;
        if !tx
            .has_rows(
                &format!("SELECT 1 FROM {ADMIN_USERS} WHERE id = ?{}", for_update(tx.flavor())),
                &[V::BigInt(id)],
            )
            .await?
        {
            return Err(AuthError::NotFound);
        }
        let mut assignments = vec!["updated_at = ?".to_owned()];
        let mut params = vec![V::DateTime(now())];
        if let Some(email) = &update.email {
            assignments.push("email = ?".into());
            params.push(V::Text(normalize_email(email)?));
        }
        if let Some(password) = &update.password {
            check_password(password)?;
            assignments.push("password_hash = ?".into());
            params.push(V::Text(hash_password(password)));
        }
        if let Some(firstname) = update.firstname.clone() {
            assignments.push("firstname = ?".into());
            params.push(optional_text(firstname));
        }
        if let Some(lastname) = update.lastname.clone() {
            assignments.push("lastname = ?".into());
            params.push(optional_text(lastname));
        }
        if let Some(active) = update.is_active {
            assignments.push("is_active = ?".into());
            params.push(V::Bool(active));
        }
        params.push(V::BigInt(id));
        tx.execute(
            &format!("UPDATE {ADMIN_USERS} SET {} WHERE id = ?", assignments.join(", ")),
            &params,
        )
        .await
        .map_err(|error| conflict_on_unique(error, "email is already used"))?;
        if let Some(roles) = &update.roles {
            if roles.is_empty() {
                return Err(AuthError::Validation("a user needs at least one role".into()));
            }
            set_user_roles(&mut tx, id, roles).await?;
        }
        ensure_active_super_admin(&mut tx).await?;
        tx.commit().await?;
        if update.password.is_some() || update.is_active == Some(false) {
            self.revoke_user_sessions(id).await?;
        }
        self.user(id).await
    }

    pub async fn delete_user(&self, id: i64) -> Result<()> {
        let mut tx = self.db.begin().await?;
        let deleted = tx
            .execute(&format!("DELETE FROM {ADMIN_USERS} WHERE id = ?"), &[V::BigInt(id)])
            .await?;
        if deleted == 0 {
            return Err(AuthError::NotFound);
        }
        ensure_active_super_admin(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Effective permissions of a user (union of their roles).
    pub async fn permission_set(&self, user_id: i64) -> Result<PermissionSet> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT r.code, p.action, p.subject, p.conditions, p.fields FROM {ADMIN_USER_ROLES} ur \
                     JOIN {ADMIN_ROLES} r ON r.id = ur.role_id \
                     LEFT JOIN {ADMIN_PERMISSIONS} p ON p.role_id = r.id WHERE ur.user_id = ?"
                ),
                &[V::BigInt(user_id)],
                &[K::Text, K::Text, K::Text, K::Text, K::Text],
            )
            .await?;
        let mut set = PermissionSet::default();
        for row in rows {
            let mut row = row.into_iter();
            if row.next().and_then(text).as_deref() == Some(SUPER_ADMIN) {
                set.super_admin = true;
            }
            if let Some(action) = row.next().and_then(text) {
                let subject = row.next().and_then(text);
                let conditions = row
                    .next()
                    .and_then(text)
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_default();
                let fields =
                    row.next().and_then(text).and_then(|json| serde_json::from_str(&json).ok());
                let permission = Permission { action, subject, conditions, fields };
                if !set.permissions.contains(&permission) {
                    set.permissions.push(permission);
                }
            }
        }
        Ok(set)
    }

    // ---------------------------------------------------------------- roles

    pub async fn roles(&self) -> Result<Vec<Role>> {
        self.load_roles(None).await
    }

    pub async fn role(&self, id: i64) -> Result<Role> {
        self.load_roles(Some(id)).await?.into_iter().next().ok_or(AuthError::NotFound)
    }

    pub async fn role_by_code(&self, code: &str) -> Result<Role> {
        self.roles().await?.into_iter().find(|role| role.code == code).ok_or(AuthError::NotFound)
    }

    async fn load_roles(&self, id: Option<i64>) -> Result<Vec<Role>> {
        let (filter, params) = match id {
            Some(id) => (" WHERE id = ?", vec![V::BigInt(id)]),
            None => ("", Vec::new()),
        };
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, code, name, description, builtin FROM {ADMIN_ROLES}{filter} ORDER BY id"),
                &params,
                &[K::BigInt, K::Text, K::Text, K::Text, K::Bool],
            )
            .await?;
        let permission_rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT role_id, action, subject, conditions, fields FROM {ADMIN_PERMISSIONS} ORDER BY id"),
                &[],
                &[K::BigInt, K::Text, K::Text, K::Text, K::Text],
            )
            .await?;
        let mut permissions: HashMap<i64, Vec<Permission>> = HashMap::new();
        for row in permission_rows {
            let mut row = row.into_iter();
            let role = int(&row.next().expect("role_id"));
            let action = row.next().and_then(text).unwrap_or_default();
            let subject = row.next().and_then(text);
            let conditions = row
                .next()
                .and_then(text)
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default();
            let fields =
                row.next().and_then(text).and_then(|json| serde_json::from_str(&json).ok());
            permissions.entry(role).or_default().push(Permission {
                action,
                subject,
                conditions,
                fields,
            });
        }
        Ok(rows
            .into_iter()
            .map(|row| {
                let id = int(&row[0]);
                let mut row = row.into_iter().skip(1);
                Role {
                    id,
                    code: row.next().and_then(text).unwrap_or_default(),
                    name: row.next().and_then(text).unwrap_or_default(),
                    description: row.next().and_then(text),
                    builtin: matches!(row.next(), Some(V::Bool(true))),
                    permissions: permissions.remove(&id).unwrap_or_default(),
                }
            })
            .collect())
    }

    pub async fn create_role(
        &self,
        code: &str,
        name: &str,
        description: Option<String>,
        permissions: Vec<Permission>,
    ) -> Result<Role> {
        let valid_code = !code.is_empty()
            && code.len() <= 64
            && code.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !valid_code {
            return Err(AuthError::Validation("role code must be kebab-case (a-z, 0-9, -)".into()));
        }
        if name.trim().is_empty() {
            return Err(AuthError::Validation("role name must not be empty".into()));
        }
        validate_permissions(&permissions)?;
        let mut tx = self.db.begin().await?;
        let now = now();
        let id = tx
            .insert_returning_id(
                &format!(
                    "INSERT INTO {ADMIN_ROLES} (code, name, description, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
                ),
                &[V::from(code), V::from(name.trim()), optional_text(description), V::Bool(false), V::DateTime(now), V::DateTime(now)],
            )
            .await
            .map_err(|error| conflict_on_unique(error, "role code is already used"))?;
        insert_permissions(&mut tx, id, &permissions).await?;
        tx.commit().await?;
        self.role(id).await
    }

    pub async fn update_role(
        &self,
        id: i64,
        name: Option<String>,
        description: Option<Option<String>>,
        permissions: Option<Vec<Permission>>,
    ) -> Result<Role> {
        let role = self.role(id).await?;
        if role.code == SUPER_ADMIN && permissions.is_some() {
            return Err(AuthError::Validation(
                "the Super Admin role always has every permission".into(),
            ));
        }
        let mut tx = self.db.begin().await?;
        let mut assignments = vec!["updated_at = ?".to_owned()];
        let mut params = vec![V::DateTime(now())];
        if let Some(name) = name {
            if name.trim().is_empty() {
                return Err(AuthError::Validation("role name must not be empty".into()));
            }
            assignments.push("name = ?".into());
            params.push(V::Text(name.trim().to_owned()));
        }
        if let Some(description) = description {
            assignments.push("description = ?".into());
            params.push(optional_text(description));
        }
        params.push(V::BigInt(id));
        tx.execute(
            &format!("UPDATE {ADMIN_ROLES} SET {} WHERE id = ?", assignments.join(", ")),
            &params,
        )
        .await?;
        if let Some(permissions) = permissions {
            validate_permissions(&permissions)?;
            tx.execute(
                &format!("DELETE FROM {ADMIN_PERMISSIONS} WHERE role_id = ?"),
                &[V::BigInt(id)],
            )
            .await?;
            insert_permissions(&mut tx, id, &permissions).await?;
        }
        tx.commit().await?;
        self.role(id).await
    }

    pub async fn delete_role(&self, id: i64) -> Result<()> {
        let role = self.role(id).await?;
        if role.builtin {
            return Err(AuthError::Validation("built-in roles cannot be deleted".into()));
        }
        let in_use = self
            .db
            .queries()
            .has_rows(
                &format!("SELECT 1 FROM {ADMIN_USER_ROLES} WHERE role_id = ?"),
                &[V::BigInt(id)],
            )
            .await?;
        if in_use {
            return Err(AuthError::Conflict("the role is still assigned to users".into()));
        }
        self.db
            .queries()
            .execute(&format!("DELETE FROM {ADMIN_ROLES} WHERE id = ?"), &[V::BigInt(id)])
            .await?;
        Ok(())
    }

    // ----------------------------------------------------------- API tokens

    pub async fn api_tokens(&self) -> Result<Vec<ApiToken>> {
        self.load_tokens(None).await
    }

    pub async fn api_token(&self, id: i64) -> Result<ApiToken> {
        self.load_tokens(Some(id)).await?.into_iter().next().ok_or(AuthError::NotFound)
    }

    async fn load_tokens(&self, id: Option<i64>) -> Result<Vec<ApiToken>> {
        let (filter, params) = match id {
            Some(id) => (" WHERE id = ?", vec![V::BigInt(id)]),
            None => ("", Vec::new()),
        };
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, name, description, kind, token_prefix, expires_at, last_used_at, created_at FROM {API_TOKENS}{filter} ORDER BY id"
                ),
                &params,
                &[K::BigInt, K::Text, K::Text, K::Text, K::Text, K::DateTime, K::DateTime, K::DateTime],
            )
            .await?;
        let grant_rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT token_id, subject, action FROM {API_TOKEN_PERMISSIONS} ORDER BY id"
                ),
                &[],
                &[K::BigInt, K::Text, K::Text],
            )
            .await?;
        let mut grants: HashMap<i64, Vec<TokenGrant>> = HashMap::new();
        for row in grant_rows {
            let mut row = row.into_iter();
            let token = int(&row.next().expect("token_id"));
            let subject = row.next().and_then(text).unwrap_or_default();
            let action = row.next().and_then(text).unwrap_or_default();
            grants.entry(token).or_default().push(TokenGrant { subject, action });
        }
        Ok(rows
            .into_iter()
            .map(|row| {
                let id = int(&row[0]);
                ApiToken {
                    id,
                    name: row[1].as_text().unwrap_or_default().to_owned(),
                    description: row[2].as_text().map(str::to_owned),
                    kind: row[3].as_text().and_then(TokenKind::parse).unwrap_or(TokenKind::Custom),
                    token_prefix: row[4].as_text().unwrap_or_default().to_owned(),
                    expires_at: datetime(&row[5]),
                    last_used_at: datetime(&row[6]),
                    created_at: datetime(&row[7]).unwrap_or_default(),
                    permissions: grants.remove(&id).unwrap_or_default(),
                }
            })
            .collect())
    }

    /// Creates a token and returns it with its secret, which is never shown again.
    pub async fn create_api_token(&self, token: NewApiToken) -> Result<(ApiToken, String)> {
        if token.name.trim().is_empty() || token.name.len() > 255 {
            return Err(AuthError::Validation("token name must be 1 to 255 characters".into()));
        }
        let secret = format!("{API_TOKEN_PREFIX}{}", random_token());
        let now = now();
        let expires_at = token.expires_in_days.map_or(V::Null(K::DateTime), |days| {
            V::DateTime(now + Duration::days(i64::from(days)))
        });
        let mut tx = self.db.begin().await?;
        let id = tx
            .insert_returning_id(
                &format!(
                    "INSERT INTO {API_TOKENS} (name, description, kind, token_hash, token_prefix, expires_at, created_at, updated_at) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::Text(token.name.trim().to_owned()),
                    optional_text(token.description),
                    V::from(token.kind.as_str()),
                    V::Text(hmac_hex(&self.config.token_pepper, &secret)),
                    V::Text(secret.chars().take(10).collect()),
                    expires_at,
                    V::DateTime(now),
                    V::DateTime(now),
                ],
            )
            .await
            .map_err(|error| conflict_on_unique(error, "token name is already used"))?;
        insert_token_grants(&mut tx, id, &token.permissions).await?;
        tx.commit().await?;
        Ok((self.api_token(id).await?, secret))
    }

    pub async fn update_api_token(&self, id: i64, update: ApiTokenUpdate) -> Result<ApiToken> {
        self.api_token(id).await?;
        let mut tx = self.db.begin().await?;
        let mut assignments = vec!["updated_at = ?".to_owned()];
        let mut params = vec![V::DateTime(now())];
        if let Some(name) = update.name {
            if name.trim().is_empty() {
                return Err(AuthError::Validation("token name must not be empty".into()));
            }
            assignments.push("name = ?".into());
            params.push(V::Text(name.trim().to_owned()));
        }
        if let Some(description) = update.description {
            assignments.push("description = ?".into());
            params.push(optional_text(description));
        }
        if let Some(kind) = update.kind {
            assignments.push("kind = ?".into());
            params.push(V::from(kind.as_str()));
        }
        params.push(V::BigInt(id));
        tx.execute(
            &format!("UPDATE {API_TOKENS} SET {} WHERE id = ?", assignments.join(", ")),
            &params,
        )
        .await
        .map_err(|error| conflict_on_unique(error, "token name is already used"))?;
        if let Some(permissions) = update.permissions {
            tx.execute(
                &format!("DELETE FROM {API_TOKEN_PERMISSIONS} WHERE token_id = ?"),
                &[V::BigInt(id)],
            )
            .await?;
            insert_token_grants(&mut tx, id, &permissions).await?;
        }
        tx.commit().await?;
        self.api_token(id).await
    }

    pub async fn delete_api_token(&self, id: i64) -> Result<()> {
        let deleted = self
            .db
            .queries()
            .execute(&format!("DELETE FROM {API_TOKENS} WHERE id = ?"), &[V::BigInt(id)])
            .await?;
        if deleted == 0 { Err(AuthError::NotFound) } else { Ok(()) }
    }

    /// Who is calling the content API: the public role without a token, the token's
    /// grants with one. Unknown or expired tokens are `Unauthorized`.
    pub async fn content_actor(&self, bearer: Option<&str>) -> Result<ContentActor> {
        let Some(token) = bearer else {
            return Ok(ContentActor::Public(self.public_grants().await?));
        };
        let hash = hmac_hex(&self.config.token_pepper, token);
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, kind, expires_at, last_used_at FROM {API_TOKENS} WHERE token_hash = ?"),
                &[V::Text(hash)],
                &[K::BigInt, K::Text, K::DateTime, K::DateTime],
            )
            .await?;
        let row = rows.into_iter().next().ok_or(AuthError::Unauthorized)?;
        let id = int(&row[0]);
        let kind = row[1].as_text().and_then(TokenKind::parse).ok_or(AuthError::Unauthorized)?;
        let now = now();
        if matches!(row[2], V::DateTime(expires_at) if expires_at <= now) {
            return Err(AuthError::Unauthorized);
        }
        // Record usage at most once a minute per token.
        let stale = match row[3] {
            V::DateTime(last) => now - last > Duration::minutes(1),
            _ => true,
        };
        if stale {
            self.db
                .queries()
                .execute(
                    &format!("UPDATE {API_TOKENS} SET last_used_at = ? WHERE id = ?"),
                    &[V::DateTime(now), V::BigInt(id)],
                )
                .await?;
        }
        let grants =
            if kind == TokenKind::Custom { self.token_grants(id).await? } else { Grants::new() };
        Ok(ContentActor::Token { id, kind, grants })
    }

    async fn token_grants(&self, id: i64) -> Result<Grants> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT subject, action FROM {API_TOKEN_PERMISSIONS} WHERE token_id = ?"),
                &[V::BigInt(id)],
                &[K::Text, K::Text],
            )
            .await?;
        Ok(grants_from_rows(rows))
    }

    // --------------------------------------------------- public permissions

    pub async fn public_grants(&self) -> Result<Grants> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT subject, action FROM {PUBLIC_PERMISSIONS}"),
                &[],
                &[K::Text, K::Text],
            )
            .await?;
        Ok(grants_from_rows(rows))
    }

    pub async fn set_public_grants(&self, grants: &[(String, ContentAction)]) -> Result<()> {
        let mut tx = self.db.begin().await?;
        tx.execute(&format!("DELETE FROM {PUBLIC_PERMISSIONS}"), &[]).await?;
        let mut seen = std::collections::HashSet::new();
        for (subject, action) in grants {
            if seen.insert((subject.clone(), *action)) {
                tx.execute(
                    &format!("INSERT INTO {PUBLIC_PERMISSIONS} (subject, action) VALUES (?, ?)"),
                    &[V::Text(subject.clone()), V::from(action.as_str())],
                )
                .await?;
            }
        }
        tx.commit().await?;
        Ok(())
    }

    // ------------------------------------------------------------------ CLI

    /// Creates a Super Admin (CLI). Unlike registration, works when admins already exist.
    pub async fn create_super_admin(&self, email: &str, password: &str) -> Result<AdminUser> {
        let role = self.role_by_code(SUPER_ADMIN).await?;
        self.create_user(NewUser {
            email: email.into(),
            password: password.into(),
            roles: vec![role.id],
            is_active: true,
            ..NewUser::default()
        })
        .await
    }

    /// Sets a password (CLI), clears any lockout and revokes the user's sessions.
    pub async fn reset_password(&self, email: &str, password: &str) -> Result<()> {
        let user = self.user_by_email(email).await?;
        check_password(password)?;
        self.db
            .queries()
            .execute(
                &format!("UPDATE {ADMIN_USERS} SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?"),
                &[V::Text(hash_password(password)), V::DateTime(now()), V::BigInt(user.id)],
            )
            .await?;
        self.revoke_user_sessions(user.id).await
    }
}

fn grants_from_rows(rows: Vec<Vec<V>>) -> Grants {
    rows.into_iter()
        .filter_map(|row| {
            let mut row = row.into_iter();
            let subject = row.next().and_then(text)?;
            let action = ContentAction::parse(&row.next().and_then(text)?)?;
            Some((subject, action))
        })
        .collect()
}

fn validate_permissions(permissions: &[Permission]) -> Result<()> {
    permissions
        .iter()
        .try_for_each(|permission| permission.validate().map_err(AuthError::Validation))
}

async fn insert_user(tx: &mut Tx, user: NewUser) -> Result<i64> {
    let email = normalize_email(&user.email)?;
    check_password(&user.password)?;
    let now = now();
    let id = tx
        .insert_returning_id(
            &format!(
                "INSERT INTO {ADMIN_USERS} (email, firstname, lastname, password_hash, is_active, failed_logins, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
            ),
            &[
                V::Text(email),
                optional_text(user.firstname.filter(|name| !name.trim().is_empty())),
                optional_text(user.lastname.filter(|name| !name.trim().is_empty())),
                V::Text(hash_password(&user.password)),
                V::Bool(user.is_active),
                V::DateTime(now),
                V::DateTime(now),
            ],
        )
        .await
        .map_err(|error| conflict_on_unique(error, "email is already used"))?;
    set_user_roles(tx, id, &user.roles).await?;
    Ok(id)
}

async fn set_user_roles(tx: &mut Tx, user_id: i64, roles: &[i64]) -> Result<()> {
    if !roles.is_empty() {
        let found = tx
            .fetch_all(
                &format!(
                    "SELECT id FROM {ADMIN_ROLES} WHERE id IN ({})",
                    placeholders(roles.len())
                ),
                &roles.iter().map(|id| V::BigInt(*id)).collect::<Vec<_>>(),
                &[K::BigInt],
            )
            .await?;
        let mut unique_roles = roles.to_vec();
        unique_roles.sort_unstable();
        unique_roles.dedup();
        if found.len() != unique_roles.len() {
            return Err(AuthError::Validation("unknown role".into()));
        }
    }
    tx.execute(&format!("DELETE FROM {ADMIN_USER_ROLES} WHERE user_id = ?"), &[V::BigInt(user_id)])
        .await?;
    let mut seen = std::collections::HashSet::new();
    for role in roles {
        if seen.insert(*role) {
            tx.execute(
                &format!("INSERT INTO {ADMIN_USER_ROLES} (user_id, role_id) VALUES (?, ?)"),
                &[V::BigInt(user_id), V::BigInt(*role)],
            )
            .await?;
        }
    }
    Ok(())
}

/// Refuses changes that would leave no active Super Admin.
async fn ensure_active_super_admin(tx: &mut Tx) -> Result<()> {
    let exists = tx
        .has_rows(
            &format!(
                "SELECT 1 FROM {ADMIN_USERS} u JOIN {ADMIN_USER_ROLES} ur ON ur.user_id = u.id \
                 JOIN {ADMIN_ROLES} r ON r.id = ur.role_id WHERE r.code = ? AND u.is_active = ?"
            ),
            &[V::from(SUPER_ADMIN), V::Bool(true)],
        )
        .await?;
    if exists {
        Ok(())
    } else {
        Err(AuthError::Validation("at least one active Super Admin must remain".into()))
    }
}

async fn insert_permissions(tx: &mut Tx, role_id: i64, permissions: &[Permission]) -> Result<()> {
    for permission in permissions {
        let conditions = if permission.conditions.is_empty() {
            V::Null(K::Text)
        } else {
            V::Text(serde_json::to_string(&permission.conditions).expect("strings serialize"))
        };
        let fields = match &permission.fields {
            Some(fields) => V::Text(serde_json::to_string(fields).expect("strings serialize")),
            None => V::Null(K::Text),
        };
        tx.execute(
            &format!("INSERT INTO {ADMIN_PERMISSIONS} (role_id, action, subject, conditions, fields) VALUES (?, ?, ?, ?, ?)"),
            &[V::BigInt(role_id), V::Text(permission.action.clone()), optional_text(permission.subject.clone()), conditions, fields],
        )
        .await?;
    }
    Ok(())
}

async fn insert_token_grants(
    tx: &mut Tx,
    token_id: i64,
    grants: &[(String, ContentAction)],
) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    for (subject, action) in grants {
        if seen.insert((subject.clone(), *action)) {
            tx.execute(
                &format!("INSERT INTO {API_TOKEN_PERMISSIONS} (token_id, subject, action) VALUES (?, ?, ?)"),
                &[V::BigInt(token_id), V::Text(subject.clone()), V::from(action.as_str())],
            )
            .await?;
        }
    }
    Ok(())
}

async fn insert_session(
    tx: &mut Tx,
    user_id: i64,
    family: &str,
    user_agent: Option<&str>,
    config: &AuthConfig,
) -> Result<(String, OffsetDateTime)> {
    let token = random_token();
    let now = now();
    let expires_at = now + config.refresh_ttl;
    let user_agent = user_agent.map(|agent| agent.chars().take(255).collect::<String>());
    tx.execute(
        &format!(
            "INSERT INTO {SESSIONS} (user_id, family, token_hash, expires_at, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ),
        &[
            V::BigInt(user_id),
            V::from(family),
            V::Text(sha256_hex(&token)),
            V::DateTime(expires_at),
            optional_text(user_agent),
            V::DateTime(now),
        ],
    )
    .await?;
    Ok((token, expires_at))
}
