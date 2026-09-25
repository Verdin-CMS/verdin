//! End users of the content API (Strapi's users-permissions): accounts with a local
//! password or an OAuth provider, roles with content grants, JWTs, email confirmation and
//! password reset tokens.

use serde::Serialize;
use time::{Duration, OffsetDateTime};
use verdin_db::{ColumnKind as K, SqlValue as V};
use verdin_migrate::system::{USER_ROLE_PERMISSIONS, USER_ROLES, USERS};

use super::{
    AuthError, AuthService, EMAIL, Result, check_password, datetime, grants_from_rows, int, now,
    text,
};
use crate::crypto::{
    self, Claims, ISSUER, decode_jwt, encode_jwt, hmac_hex, random_token, sha256_hex,
};
use crate::permissions::{ContentAction, Grants};

pub const USERS_AUDIENCE: &str = "verdin-users";
/// The role new accounts get unless the settings name another.
pub const AUTHENTICATED: &str = "authenticated";
const MIN_USERNAME: usize = 3;
const MAX_USERNAME: usize = 100;
const RESET_TTL: Duration = Duration::hours(1);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndUserRole {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
}

/// An end user, as the content API returns it (Strapi's shape).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndUser {
    pub id: i64,
    pub document_id: String,
    pub username: String,
    pub email: String,
    pub provider: String,
    pub confirmed: bool,
    pub blocked: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(skip)]
    pub role: EndUserRole,
    #[serde(skip)]
    token_version: i64,
}

#[derive(Debug, Clone, Default)]
pub struct NewEndUser {
    pub username: String,
    pub email: String,
    /// `None` for OAuth accounts.
    pub password: Option<String>,
    pub provider: String,
    pub confirmed: bool,
    pub blocked: bool,
    /// Role `type`; the default role when `None`.
    pub role: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct EndUserUpdate {
    pub username: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
    pub confirmed: Option<bool>,
    pub blocked: Option<bool>,
    pub role_id: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct EndUserQuery {
    pub page: u64,
    pub page_size: u64,
    pub search: Option<String>,
}

const USER_COLUMNS: &str = "u.id, u.document_id, u.username, u.email, u.provider, u.confirmed, \
    u.blocked, u.created_at, u.updated_at, u.token_version, u.password_hash, r.id, r.name, \
    r.description, r.type";
const USER_KINDS: [K; 15] = [
    K::BigInt,
    K::Text,
    K::Text,
    K::Text,
    K::Text,
    K::Bool,
    K::Bool,
    K::DateTime,
    K::DateTime,
    K::Int,
    K::Text,
    K::BigInt,
    K::Text,
    K::Text,
    K::Text,
];

fn decode_user(row: Vec<V>) -> (EndUser, Option<String>) {
    let mut row = row.into_iter();
    let mut next = || row.next().unwrap_or(V::Null(K::Text));
    let id = int(&next());
    let document_id = text(next()).unwrap_or_default();
    let username = text(next()).unwrap_or_default();
    let email = text(next()).unwrap_or_default();
    let provider = text(next()).unwrap_or_default();
    let confirmed = matches!(next(), V::Bool(true));
    let blocked = matches!(next(), V::Bool(true));
    let created_at = datetime(&next());
    let updated_at = datetime(&next());
    let token_version = int(&next());
    let hash = text(next());
    let role = EndUserRole {
        id: int(&next()),
        name: text(next()).unwrap_or_default(),
        description: text(next()),
        kind: text(next()).unwrap_or_default(),
    };
    let user = EndUser {
        id,
        document_id,
        username,
        email,
        provider,
        confirmed,
        blocked,
        created_at,
        updated_at,
        role,
        token_version,
    };
    (user, hash)
}

fn normalize_email(email: &str) -> Result<String> {
    let email = email.trim().to_lowercase();
    if email.len() > 255 || !EMAIL.is_match(&email) {
        return Err(AuthError::Validation("email must be a valid email".into()));
    }
    Ok(email)
}

fn check_username(username: &str) -> Result<String> {
    let username = username.trim();
    let length = username.chars().count();
    if !(MIN_USERNAME..=MAX_USERNAME).contains(&length) {
        return Err(AuthError::Validation(format!(
            "username must be {MIN_USERNAME} to {MAX_USERNAME} characters"
        )));
    }
    Ok(username.to_owned())
}

/// Passwords of accounts imported from Strapi are bcrypt hashes.
fn verify(password: &str, hash: &str) -> bool {
    if hash.starts_with("$2") {
        return bcrypt::verify(password, hash).unwrap_or(false);
    }
    crypto::verify_password(password, hash)
}

impl AuthService {
    fn users_secret(&self) -> Vec<u8> {
        hmac_hex(&self.config.jwt_secret, "verdin-users-jwt").into_bytes()
    }

    /// An HMAC of `value` (OAuth `state`), under a key of its own.
    pub fn sign(&self, value: &str) -> String {
        hmac_hex(&hmac_hex(&self.config.jwt_secret, "verdin-signatures").into_bytes(), value)
    }

    /// Whether `signature` is [`Self::sign`] of `value` (constant time).
    pub fn verify_signature(&self, value: &str, signature: &str) -> bool {
        let expected = self.sign(value);
        expected.len() == signature.len()
            && expected.bytes().zip(signature.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
    }

    /// Creates the built-in `authenticated` role when missing.
    pub(super) async fn bootstrap_users(&self) -> Result<()> {
        let exists = self
            .db
            .queries()
            .has_rows(
                &format!("SELECT 1 FROM {USER_ROLES} WHERE type = ?"),
                &[V::from(AUTHENTICATED)],
            )
            .await?;
        if !exists {
            let at = now();
            self.db
                .queries()
                .execute(
                    &format!(
                        "INSERT INTO {USER_ROLES} (name, description, type, created_at, updated_at) \
                         VALUES (?, ?, ?, ?, ?)"
                    ),
                    &[
                        V::from("Authenticated"),
                        V::from("Default role given to authenticated users."),
                        V::from(AUTHENTICATED),
                        V::DateTime(at),
                        V::DateTime(at),
                    ],
                )
                .await?;
        }
        Ok(())
    }

    async fn users_where(
        &self,
        filter: &str,
        params: &[V],
    ) -> Result<Vec<(EndUser, Option<String>)>> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT {USER_COLUMNS} FROM {USERS} u JOIN {USER_ROLES} r ON r.id = u.role_id {filter}"
                ),
                params,
                &USER_KINDS,
            )
            .await?;
        Ok(rows.into_iter().map(decode_user).collect())
    }

    async fn user_where(
        &self,
        filter: &str,
        params: &[V],
    ) -> Result<Option<(EndUser, Option<String>)>> {
        Ok(self.users_where(filter, params).await?.into_iter().next())
    }

    pub async fn end_user(&self, id: i64) -> Result<EndUser> {
        self.user_where("WHERE u.id = ?", &[V::BigInt(id)])
            .await?
            .map(|(user, _)| user)
            .ok_or(AuthError::NotFound)
    }

    // ------------------------------------------------------------- roles

    pub async fn end_user_roles(&self) -> Result<Vec<(EndUserRole, Grants, i64)>> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT r.id, r.name, r.description, r.type, \
                     (SELECT COUNT(*) FROM {USERS} u WHERE u.role_id = r.id) \
                     FROM {USER_ROLES} r ORDER BY r.id"
                ),
                &[],
                &[K::BigInt, K::Text, K::Text, K::Text, K::BigInt],
            )
            .await?;
        let mut out = Vec::new();
        for row in rows {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            let role = EndUserRole {
                id: int(&next()),
                name: text(next()).unwrap_or_default(),
                description: text(next()),
                kind: text(next()).unwrap_or_default(),
            };
            let users = int(&next());
            let grants = self.role_grants(role.id).await?;
            out.push((role, grants, users));
        }
        Ok(out)
    }

    async fn role_grants(&self, role_id: i64) -> Result<Grants> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT subject, action FROM {USER_ROLE_PERMISSIONS} WHERE role_id = ?"),
                &[V::BigInt(role_id)],
                &[K::Text, K::Text],
            )
            .await?;
        Ok(grants_from_rows(rows))
    }

    async fn role_by_type(&self, kind: &str) -> Result<i64> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id FROM {USER_ROLES} WHERE type = ?"),
                &[V::from(kind)],
                &[K::BigInt],
            )
            .await?;
        rows.first().map(|row| int(&row[0])).ok_or(AuthError::NotFound)
    }

    /// Creates (`id: None`) or updates a role and replaces its grants.
    pub async fn save_end_user_role(
        &self,
        id: Option<i64>,
        name: &str,
        description: Option<&str>,
        grants: &[(String, ContentAction)],
    ) -> Result<i64> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 255 {
            return Err(AuthError::Validation("name must have 1 to 255 characters".into()));
        }
        let at = now();
        let mut tx = self.db.begin().await?;
        let id = match id {
            Some(id) => {
                let updated = tx
                    .execute(
                        &format!("UPDATE {USER_ROLES} SET name = ?, description = ?, updated_at = ? WHERE id = ?"),
                        &[V::from(name), description.map_or(V::Null(K::Text), V::from), V::DateTime(at), V::BigInt(id)],
                    )
                    .await?;
                if updated == 0 {
                    return Err(AuthError::NotFound);
                }
                id
            }
            None => {
                let slug: String = name
                    .to_lowercase()
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                    .collect::<String>()
                    .split('-')
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>()
                    .join("-");
                let kind = if slug.is_empty() { "role".to_owned() } else { slug };
                let taken = tx
                    .has_rows(
                        &format!("SELECT 1 FROM {USER_ROLES} WHERE type = ?"),
                        &[V::from(kind.as_str())],
                    )
                    .await?;
                let kind = if taken {
                    format!("{kind}-{}", random_token()[..6].to_lowercase())
                } else {
                    kind
                };
                tx.insert_returning_id(
                    &format!(
                        "INSERT INTO {USER_ROLES} (name, description, type, created_at, updated_at) \
                         VALUES (?, ?, ?, ?, ?)"
                    ),
                    &[
                        V::from(name),
                        description.map_or(V::Null(K::Text), V::from),
                        V::Text(kind),
                        V::DateTime(at),
                        V::DateTime(at),
                    ],
                )
                .await?
            }
        };
        tx.execute(
            &format!("DELETE FROM {USER_ROLE_PERMISSIONS} WHERE role_id = ?"),
            &[V::BigInt(id)],
        )
        .await?;
        let mut seen = std::collections::HashSet::new();
        for (subject, action) in grants {
            if seen.insert((subject.clone(), *action)) {
                tx.execute(
                    &format!(
                        "INSERT INTO {USER_ROLE_PERMISSIONS} (role_id, subject, action) VALUES (?, ?, ?)"
                    ),
                    &[V::BigInt(id), V::Text(subject.clone()), V::from(action.as_str())],
                )
                .await?;
            }
        }
        tx.commit().await?;
        Ok(id)
    }

    /// Deletes a custom role; its users move to `authenticated`.
    pub async fn delete_end_user_role(&self, id: i64) -> Result<()> {
        let default = self.role_by_type(AUTHENTICATED).await?;
        if id == default {
            return Err(AuthError::Validation("the authenticated role cannot be deleted".into()));
        }
        let mut tx = self.db.begin().await?;
        tx.execute(
            &format!("UPDATE {USERS} SET role_id = ? WHERE role_id = ?"),
            &[V::BigInt(default), V::BigInt(id)],
        )
        .await?;
        tx.execute(
            &format!("DELETE FROM {USER_ROLE_PERMISSIONS} WHERE role_id = ?"),
            &[V::BigInt(id)],
        )
        .await?;
        let deleted =
            tx.execute(&format!("DELETE FROM {USER_ROLES} WHERE id = ?"), &[V::BigInt(id)]).await?;
        if deleted == 0 {
            return Err(AuthError::NotFound);
        }
        tx.commit().await?;
        Ok(())
    }

    // ------------------------------------------------------------- accounts

    /// Creates an account; returns it and, when it still needs confirming, the email
    /// confirmation token to send.
    pub async fn create_end_user(
        &self,
        user: NewEndUser,
        default_role: &str,
    ) -> Result<(EndUser, Option<String>)> {
        let username = check_username(&user.username)?;
        let email = normalize_email(&user.email)?;
        let hash = match &user.password {
            Some(password) => {
                check_password(password)?;
                Some(crypto::hash_password(password))
            }
            None => None,
        };
        let taken = self
            .db
            .queries()
            .has_rows(
                &format!("SELECT 1 FROM {USERS} WHERE email = ? OR username = ?"),
                &[V::Text(email.clone()), V::Text(username.clone())],
            )
            .await?;
        if taken {
            return Err(AuthError::Conflict("Email or Username are already taken".into()));
        }
        let role = self.role_by_type(user.role.as_deref().unwrap_or(default_role)).await?;
        let (confirmation, stored) = if user.confirmed {
            (None, V::Null(K::Text))
        } else {
            let token = random_token();
            let hash = sha256_hex(&token);
            (Some(token), V::Text(hash))
        };
        let at = now();
        let id = self
            .db
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {USERS} (document_id, username, email, password_hash, provider, \
                     confirmed, blocked, role_id, token_version, confirmation_token, reset_token, \
                     reset_expires_at, created_at, updated_at) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::Text(crypto::random_hex::<13>()),
                    V::Text(username),
                    V::Text(email),
                    hash.map_or(V::Null(K::Text), V::Text),
                    V::Text(if user.provider.is_empty() { "local".into() } else { user.provider }),
                    V::Bool(user.confirmed),
                    V::Bool(user.blocked),
                    V::BigInt(role),
                    V::Int(0),
                    stored,
                    V::Null(K::Text),
                    V::Null(K::DateTime),
                    V::DateTime(at),
                    V::DateTime(at),
                ],
            )
            .await
            .map_err(|error| match error.unique_violation() {
                Some(_) => AuthError::Conflict("Email or Username are already taken".into()),
                None => AuthError::Db(error),
            })?;
        Ok((self.end_user(id).await?, confirmation))
    }

    /// Local login by email or username.
    pub async fn login_end_user(&self, identifier: &str, password: &str) -> Result<EndUser> {
        let identifier = identifier.trim();
        let found = self
            .user_where(
                "WHERE u.provider = 'local' AND (u.email = ? OR u.username = ?)",
                &[V::Text(identifier.to_lowercase()), V::Text(identifier.to_owned())],
            )
            .await?;
        let Some((user, Some(hash))) = found else {
            crypto::dummy_verify(password);
            return Err(AuthError::InvalidCredentials);
        };
        if !verify(password, &hash) {
            return Err(AuthError::InvalidCredentials);
        }
        if hash.starts_with("$2") || crypto::needs_rehash(&hash) {
            self.db
                .queries()
                .execute(
                    &format!("UPDATE {USERS} SET password_hash = ? WHERE id = ?"),
                    &[V::Text(crypto::hash_password(password)), V::BigInt(user.id)],
                )
                .await?;
        }
        Ok(user)
    }

    /// A JWT for the content API.
    pub fn end_user_jwt(&self, user: &EndUser, ttl: Duration) -> String {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        encode_jwt(
            &self.users_secret(),
            &Claims {
                sub: user.id.to_string(),
                iss: ISSUER.into(),
                aud: USERS_AUDIENCE.into(),
                iat: now,
                exp: now + ttl.whole_seconds(),
                ver: Some(user.token_version),
            },
        )
    }

    /// The user a JWT belongs to (not blocked, token not revoked).
    pub async fn authenticate_end_user(&self, jwt: &str) -> Result<EndUser> {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let claims = decode_jwt(&self.users_secret(), jwt, USERS_AUDIENCE, now)
            .ok_or(AuthError::Unauthorized)?;
        let id: i64 = claims.sub.parse().map_err(|_| AuthError::Unauthorized)?;
        let user = self.end_user(id).await.map_err(|_| AuthError::Unauthorized)?;
        if user.blocked || claims.ver != Some(user.token_version) {
            return Err(AuthError::Unauthorized);
        }
        Ok(user)
    }

    pub(super) async fn end_user_actor(&self, jwt: &str) -> Result<(EndUser, Grants)> {
        let user = self.authenticate_end_user(jwt).await?;
        let grants = self.role_grants(user.role.id).await?;
        Ok((user, grants))
    }

    pub async fn confirm_end_user(&self, token: &str) -> Result<EndUser> {
        let (user, _) = self
            .user_where("WHERE u.confirmation_token = ?", &[V::Text(sha256_hex(token))])
            .await?
            .ok_or_else(|| AuthError::Validation("Invalid token".into()))?;
        self.db
            .queries()
            .execute(
                &format!("UPDATE {USERS} SET confirmed = ?, confirmation_token = NULL, updated_at = ? WHERE id = ?"),
                &[V::Bool(true), V::DateTime(now()), V::BigInt(user.id)],
            )
            .await?;
        self.end_user(user.id).await
    }

    /// A new confirmation token for an unconfirmed account (`None` when there is nothing to
    /// confirm; callers answer the same either way).
    pub async fn new_confirmation(&self, email: &str) -> Result<Option<(EndUser, String)>> {
        let Ok(email) = normalize_email(email) else { return Ok(None) };
        let Some((user, _)) = self.user_where("WHERE u.email = ?", &[V::Text(email)]).await? else {
            return Ok(None);
        };
        if user.confirmed || user.blocked {
            return Ok(None);
        }
        let token = random_token();
        self.db
            .queries()
            .execute(
                &format!("UPDATE {USERS} SET confirmation_token = ? WHERE id = ?"),
                &[V::Text(sha256_hex(&token)), V::BigInt(user.id)],
            )
            .await?;
        Ok(Some((user, token)))
    }

    /// A password reset code for a local account (`None` when there is none).
    pub async fn forgot_password(&self, email: &str) -> Result<Option<(EndUser, String)>> {
        let Ok(email) = normalize_email(email) else { return Ok(None) };
        let Some((user, _)) = self
            .user_where("WHERE u.email = ? AND u.provider = 'local'", &[V::Text(email)])
            .await?
        else {
            return Ok(None);
        };
        if user.blocked {
            return Ok(None);
        }
        let token = random_token();
        self.db
            .queries()
            .execute(
                &format!("UPDATE {USERS} SET reset_token = ?, reset_expires_at = ? WHERE id = ?"),
                &[V::Text(sha256_hex(&token)), V::DateTime(now() + RESET_TTL), V::BigInt(user.id)],
            )
            .await?;
        Ok(Some((user, token)))
    }

    /// Sets a new password with a reset code; revokes issued JWTs.
    pub async fn reset_end_user_password(&self, code: &str, password: &str) -> Result<EndUser> {
        check_password(password)?;
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, reset_expires_at FROM {USERS} WHERE reset_token = ?"),
                &[V::Text(sha256_hex(code))],
                &[K::BigInt, K::DateTime],
            )
            .await?;
        let invalid = || AuthError::Validation("Incorrect code provided".into());
        let row = rows.into_iter().next().ok_or_else(invalid)?;
        if !matches!(row[1], V::DateTime(expires) if expires > now()) {
            return Err(invalid());
        }
        let id = int(&row[0]);
        self.set_end_user_password(id, password).await?;
        self.end_user(id).await
    }

    async fn set_end_user_password(&self, id: i64, password: &str) -> Result<()> {
        self.db
            .queries()
            .execute(
                &format!(
                    "UPDATE {USERS} SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL, \
                     token_version = token_version + 1, updated_at = ? WHERE id = ?"
                ),
                &[V::Text(crypto::hash_password(password)), V::DateTime(now()), V::BigInt(id)],
            )
            .await?;
        Ok(())
    }

    /// Changes the password of a signed-in user; revokes issued JWTs.
    pub async fn change_end_user_password(
        &self,
        id: i64,
        current: &str,
        password: &str,
    ) -> Result<EndUser> {
        let (_, hash) = self
            .user_where("WHERE u.id = ?", &[V::BigInt(id)])
            .await?
            .ok_or(AuthError::NotFound)?;
        if !hash.is_some_and(|hash| verify(current, &hash)) {
            return Err(AuthError::Validation("The provided current password is invalid".into()));
        }
        check_password(password)?;
        self.set_end_user_password(id, password).await?;
        self.end_user(id).await
    }

    /// The account of an OAuth sign-in: found by email, or created (confirmed).
    pub async fn oauth_end_user(
        &self,
        provider: &str,
        email: &str,
        username: &str,
        default_role: &str,
    ) -> Result<EndUser> {
        let email = normalize_email(email)?;
        if let Some((user, _)) =
            self.user_where("WHERE u.email = ?", &[V::Text(email.clone())]).await?
        {
            if user.provider != provider {
                return Err(AuthError::Conflict("Email is already taken.".into()));
            }
            if user.blocked {
                return Err(AuthError::Forbidden);
            }
            return Ok(user);
        }
        let mut name: String =
            username.chars().filter(|c| !c.is_control()).take(MAX_USERNAME).collect();
        if name.chars().count() < MIN_USERNAME {
            name = email.split('@').next().unwrap_or("user").to_owned();
        }
        if self
            .db
            .queries()
            .has_rows(
                &format!("SELECT 1 FROM {USERS} WHERE username = ?"),
                &[V::Text(name.clone())],
            )
            .await?
        {
            name = format!("{name}-{}", random_token()[..6].to_lowercase());
        }
        let (user, _) = self
            .create_end_user(
                NewEndUser {
                    username: name,
                    email,
                    password: None,
                    provider: provider.into(),
                    confirmed: true,
                    ..Default::default()
                },
                default_role,
            )
            .await?;
        Ok(user)
    }

    /// An account brought over from Strapi as it was (its bcrypt hash keeps working and
    /// is upgraded at the next login).
    #[allow(clippy::too_many_arguments)]
    pub async fn import_end_user(
        &self,
        username: &str,
        email: &str,
        password_hash: Option<&str>,
        provider: &str,
        confirmed: bool,
        blocked: bool,
        role_id: i64,
    ) -> Result<i64> {
        let at = now();
        Ok(self
            .db
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {USERS} (document_id, username, email, password_hash, provider, \
                     confirmed, blocked, role_id, token_version, created_at, updated_at) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::Text(crypto::random_hex::<13>()),
                    V::Text(check_username(username)?),
                    V::Text(normalize_email(email)?),
                    password_hash.map_or(V::Null(K::Text), V::from),
                    V::from(provider),
                    V::Bool(confirmed),
                    V::Bool(blocked),
                    V::BigInt(role_id),
                    V::Int(0),
                    V::DateTime(at),
                    V::DateTime(at),
                ],
            )
            .await?)
    }

    /// The id of the role of `type` (`authenticated`, custom slugs).
    pub async fn end_user_role_id(&self, kind: &str) -> Result<i64> {
        self.role_by_type(kind).await
    }

    // ------------------------------------------------------------- admin

    pub async fn end_users(&self, query: &EndUserQuery) -> Result<(Vec<EndUser>, i64)> {
        let (filter, params) =
            match query.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(search) => {
                    let like = format!("%{}%", search.to_lowercase().replace(['%', '_'], ""));
                    (
                        "WHERE LOWER(u.username) LIKE ? OR u.email LIKE ?",
                        vec![V::Text(like.clone()), V::Text(like)],
                    )
                }
                None => ("", Vec::new()),
            };
        let size = query.page_size.clamp(1, 100);
        let offset = (query.page.max(1) - 1) * size;
        let users = self
            .users_where(
                &format!("{filter} ORDER BY u.id DESC LIMIT {size} OFFSET {offset}"),
                &params,
            )
            .await?
            .into_iter()
            .map(|(user, _)| user)
            .collect();
        let total = self
            .db
            .queries()
            .fetch_all(&format!("SELECT COUNT(*) FROM {USERS} u {filter}"), &params, &[K::BigInt])
            .await?
            .first()
            .map_or(0, |row| int(&row[0]));
        Ok((users, total))
    }

    pub async fn update_end_user(&self, id: i64, update: EndUserUpdate) -> Result<EndUser> {
        let current = self.end_user(id).await?;
        let mut sets: Vec<String> = Vec::new();
        let mut params: Vec<V> = Vec::new();
        let mut revoke = false;
        if let Some(username) = &update.username {
            sets.push("username = ?".into());
            params.push(V::Text(check_username(username)?));
        }
        if let Some(email) = &update.email {
            sets.push("email = ?".into());
            params.push(V::Text(normalize_email(email)?));
        }
        if let Some(password) = &update.password {
            check_password(password)?;
            sets.push("password_hash = ?".into());
            params.push(V::Text(crypto::hash_password(password)));
            revoke = true;
        }
        if let Some(confirmed) = update.confirmed {
            sets.push("confirmed = ?".into());
            params.push(V::Bool(confirmed));
        }
        if let Some(blocked) = update.blocked {
            sets.push("blocked = ?".into());
            params.push(V::Bool(blocked));
            revoke |= blocked && !current.blocked;
        }
        if let Some(role_id) = update.role_id {
            let exists = self
                .db
                .queries()
                .has_rows(
                    &format!("SELECT 1 FROM {USER_ROLES} WHERE id = ?"),
                    &[V::BigInt(role_id)],
                )
                .await?;
            if !exists {
                return Err(AuthError::Validation("unknown role".into()));
            }
            sets.push("role_id = ?".into());
            params.push(V::BigInt(role_id));
        }
        if revoke {
            sets.push("token_version = token_version + 1".into());
        }
        sets.push("updated_at = ?".into());
        params.push(V::DateTime(now()));
        params.push(V::BigInt(id));
        self.db
            .queries()
            .execute(&format!("UPDATE {USERS} SET {} WHERE id = ?", sets.join(", ")), &params)
            .await
            .map_err(|error| match error.unique_violation() {
                Some(_) => AuthError::Conflict("Email or Username are already taken".into()),
                None => AuthError::Db(error),
            })?;
        self.end_user(id).await
    }

    pub async fn delete_end_user(&self, id: i64) -> Result<()> {
        let deleted = self
            .db
            .queries()
            .execute(&format!("DELETE FROM {USERS} WHERE id = ?"), &[V::BigInt(id)])
            .await?;
        if deleted == 0 { Err(AuthError::NotFound) } else { Ok(()) }
    }
}
