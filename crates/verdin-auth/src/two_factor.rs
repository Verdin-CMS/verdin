//! Two-factor authentication for admins: TOTP (RFC 6238) and recovery codes. Sign-in
//! with a second factor happens in two steps: the password gives a short-lived token,
//! which a code (or a passkey, see `passkeys`) turns into a session.

use hmac::{Hmac, KeyInit, Mac};
use serde::Serialize;
use sha1::Sha1;
use time::OffsetDateTime;
use verdin_db::{ColumnKind as K, SqlValue as V};
use verdin_migrate::system::{ADMIN_PASSKEYS, ADMIN_TWO_FACTOR, ADMIN_USERS};

use super::{AuthError, AuthService, Result, Session, datetime, int, now, text};
use crate::crypto::{self, Claims, ISSUER, decode_jwt, encode_jwt, hmac_hex, verify_password};

/// Audience of the token between the password and the second factor.
const MFA_AUDIENCE: &str = "verdin-admin-mfa";
/// Time to enter the second factor.
const MFA_TTL: time::Duration = time::Duration::minutes(5);
const STEP: i64 = 30;
const DIGITS: u32 = 6;
const SECRET_BYTES: usize = 20;
const RECOVERY_CODES: usize = 10;
/// Unambiguous characters of recovery codes.
const RECOVERY_ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

/// The result of a password sign-in.
#[derive(Debug, Clone)]
pub enum Login {
    Session(Session),
    /// The account has a second factor: present one with `token`.
    SecondFactor {
        token: String,
        methods: Vec<&'static str>,
    },
}

impl Login {
    /// The session, when no second factor was needed.
    pub fn into_session(self) -> Option<Session> {
        match self {
            Self::Session(session) => Some(session),
            Self::SecondFactor { .. } => None,
        }
    }
}

/// An admin's second factors.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorStatus {
    pub totp: bool,
    pub passkeys: Vec<PasskeySummary>,
    pub recovery_codes_left: usize,
    /// One of the admin's roles requires a second factor.
    pub required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeySummary {
    pub id: i64,
    pub name: String,
    pub created_at: Option<String>,
    pub last_used_at: Option<String>,
}

/// A TOTP secret being set up, shown once.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpSetup {
    /// Base32, for manual entry.
    pub secret: String,
    /// `otpauth://totp/…`, for QR codes.
    pub otpauth_url: String,
}

struct Stored {
    secret: Option<Vec<u8>>,
    enabled: bool,
    last_step: Option<i64>,
    recovery: Vec<String>,
}

impl AuthService {
    /// Password verified: a session, or the second step when the account has a factor.
    pub(super) async fn after_password(
        &self,
        user_id: i64,
        user_agent: Option<&str>,
    ) -> Result<Login> {
        let methods = self.second_factors(user_id).await?;
        if methods.is_empty() {
            let user = self.user(user_id).await?;
            return Ok(Login::Session(self.open_session(user, user_agent).await?));
        }
        let issued = OffsetDateTime::now_utc();
        let claims = Claims {
            sub: user_id.to_string(),
            iss: ISSUER.into(),
            aud: MFA_AUDIENCE.into(),
            iat: issued.unix_timestamp(),
            exp: (issued + MFA_TTL).unix_timestamp(),
            ver: None,
        };
        Ok(Login::SecondFactor { token: encode_jwt(&self.config.jwt_secret, &claims), methods })
    }

    /// The second factors an account signs in with.
    async fn second_factors(&self, user_id: i64) -> Result<Vec<&'static str>> {
        let status = self.two_factor_status(user_id).await?;
        let mut methods = Vec::new();
        if status.totp {
            methods.push("totp");
        }
        if !status.passkeys.is_empty() {
            methods.push("passkey");
        }
        if !methods.is_empty() && status.recovery_codes_left > 0 {
            methods.push("recovery");
        }
        Ok(methods)
    }

    /// The user behind a second-step token.
    pub fn second_step_user(&self, token: &str) -> Result<i64> {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let claims = decode_jwt(&self.config.jwt_secret, token, MFA_AUDIENCE, now)
            .ok_or(AuthError::Unauthorized)?;
        claims.sub.parse().map_err(|_| AuthError::Unauthorized)
    }

    /// Second step with a TOTP or recovery code.
    pub async fn login_with_code(
        &self,
        token: &str,
        code: &str,
        user_agent: Option<&str>,
    ) -> Result<Session> {
        let user_id = self.second_step_user(token)?;
        self.ensure_not_locked(user_id).await?;
        let code: String = code.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
        let accepted = if code.len() == DIGITS as usize && code.chars().all(|c| c.is_ascii_digit())
        {
            self.check_totp(user_id, &code).await?
        } else {
            self.use_recovery_code(user_id, &code).await?
        };
        if !accepted {
            self.record_failed_login(user_id).await?;
            return Err(AuthError::InvalidCredentials);
        }
        self.finish_second_step(user_id, user_agent).await
    }

    pub(super) async fn finish_second_step(
        &self,
        user_id: i64,
        user_agent: Option<&str>,
    ) -> Result<Session> {
        self.db
            .queries()
            .execute(
                &format!(
                    "UPDATE {ADMIN_USERS} SET failed_logins = 0, locked_until = NULL WHERE id = ?"
                ),
                &[V::BigInt(user_id)],
            )
            .await?;
        let user = self.user(user_id).await?;
        if !user.is_active {
            return Err(AuthError::InvalidCredentials);
        }
        self.open_session(user, user_agent).await
    }

    pub async fn two_factor_status(&self, user_id: i64) -> Result<TwoFactorStatus> {
        let stored = self.stored(user_id).await?;
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, name, created_at, last_used_at FROM {ADMIN_PASSKEYS} WHERE user_id = ? ORDER BY id"
                ),
                &[V::BigInt(user_id)],
                &[K::BigInt, K::Text, K::DateTime, K::DateTime],
            )
            .await?;
        let passkeys = rows
            .into_iter()
            .map(|row| {
                let id = int(&row[0]);
                let mut row = row.into_iter().skip(1);
                PasskeySummary {
                    id,
                    name: row.next().and_then(text).unwrap_or_default(),
                    created_at: row.next().as_ref().and_then(datetime),
                    last_used_at: row.next().as_ref().and_then(datetime),
                }
            })
            .collect();
        let user = self.user(user_id).await?;
        Ok(TwoFactorStatus {
            totp: stored.as_ref().is_some_and(|stored| stored.enabled),
            passkeys,
            recovery_codes_left: stored.map_or(0, |stored| stored.recovery.len()),
            required: user.two_factor_required,
        })
    }

    /// Starts setting up TOTP (replacing a pending setup): the secret to scan.
    pub async fn totp_setup(&self, user_id: i64, password: &str) -> Result<TotpSetup> {
        self.confirm_password(user_id, password).await?;
        if self.stored(user_id).await?.is_some_and(|stored| stored.enabled) {
            return Err(AuthError::Conflict("TOTP is already enabled".into()));
        }
        let secret = crypto::random_bytes::<SECRET_BYTES>();
        let sealed = self.seal(user_id, &secret);
        self.upsert(
            user_id,
            &[("totp_secret", V::Text(sealed)), ("totp_enabled_at", V::Null(K::DateTime))],
        )
        .await?;
        let user = self.user(user_id).await?;
        let encoded = base32(&secret);
        let label = format!("Verdin:{}", user.email);
        Ok(TotpSetup {
            otpauth_url: format!(
                "otpauth://totp/{}?secret={encoded}&issuer=Verdin&algorithm=SHA1&digits={DIGITS}&period={STEP}",
                percent(&label)
            ),
            secret: encoded,
        })
    }

    /// Enables TOTP with a first code; returns fresh recovery codes (shown once).
    pub async fn totp_enable(&self, user_id: i64, code: &str) -> Result<Vec<String>> {
        let stored = self
            .stored(user_id)
            .await?
            .ok_or_else(|| AuthError::Validation("start the TOTP setup first".into()))?;
        if stored.enabled {
            return Err(AuthError::Conflict("TOTP is already enabled".into()));
        }
        let secret = stored
            .secret
            .ok_or_else(|| AuthError::Validation("start the TOTP setup first".into()))?;
        let Some(step) = matching_step(&secret, code.trim(), now().unix_timestamp(), None) else {
            return Err(AuthError::Validation("the code is not valid".into()));
        };
        let codes = recovery_codes();
        self.upsert(
            user_id,
            &[
                ("totp_enabled_at", V::DateTime(now())),
                ("totp_last_step", V::BigInt(step)),
                ("recovery_codes", V::Text(self.hashed_codes(&codes))),
            ],
        )
        .await?;
        Ok(codes)
    }

    /// Turns TOTP off (recovery codes go too when no passkey is left).
    pub async fn totp_disable(&self, user_id: i64, password: &str) -> Result<()> {
        self.confirm_password(user_id, password).await?;
        let passkeys = !self.two_factor_status(user_id).await?.passkeys.is_empty();
        let mut changes = vec![
            ("totp_secret", V::Null(K::Text)),
            ("totp_enabled_at", V::Null(K::DateTime)),
            ("totp_last_step", V::Null(K::BigInt)),
        ];
        if !passkeys {
            changes.push(("recovery_codes", V::Null(K::Text)));
        }
        self.upsert(user_id, &changes).await
    }

    /// New recovery codes, replacing the old ones.
    pub async fn regenerate_recovery_codes(
        &self,
        user_id: i64,
        password: &str,
    ) -> Result<Vec<String>> {
        self.confirm_password(user_id, password).await?;
        if self.second_factors(user_id).await?.is_empty() {
            return Err(AuthError::Validation("set up a second factor first".into()));
        }
        let codes = recovery_codes();
        self.upsert(user_id, &[("recovery_codes", V::Text(self.hashed_codes(&codes)))]).await?;
        Ok(codes)
    }

    /// Fresh recovery codes when the account has none left (a first factor was added).
    pub(super) async fn ensure_recovery_codes(&self, user_id: i64) -> Result<Option<Vec<String>>> {
        if self.stored(user_id).await?.is_some_and(|stored| !stored.recovery.is_empty()) {
            return Ok(None);
        }
        let codes = recovery_codes();
        self.upsert(user_id, &[("recovery_codes", V::Text(self.hashed_codes(&codes)))]).await?;
        Ok(Some(codes))
    }

    /// Removes every second factor of an account (an admin who lost them).
    pub async fn reset_two_factor(&self, user_id: i64) -> Result<()> {
        self.user(user_id).await?;
        let mut tx = self.db.begin().await?;
        for table in [ADMIN_TWO_FACTOR, ADMIN_PASSKEYS] {
            tx.execute(&format!("DELETE FROM {table} WHERE user_id = ?"), &[V::BigInt(user_id)])
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub(super) async fn confirm_password(&self, user_id: i64, password: &str) -> Result<()> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT password_hash FROM {ADMIN_USERS} WHERE id = ?"),
                &[V::BigInt(user_id)],
                &[K::Text],
            )
            .await?;
        let hash = rows.into_iter().next().and_then(|row| row.into_iter().next()).and_then(text);
        match hash {
            Some(hash) if verify_password(password, &hash) => Ok(()),
            _ => Err(AuthError::Validation("the password is not correct".into())),
        }
    }

    async fn check_totp(&self, user_id: i64, code: &str) -> Result<bool> {
        let Some(stored) = self.stored(user_id).await?.filter(|stored| stored.enabled) else {
            return Ok(false);
        };
        let Some(secret) = stored.secret else { return Ok(false) };
        let Some(step) = matching_step(&secret, code, now().unix_timestamp(), stored.last_step)
        else {
            return Ok(false);
        };
        // A code works once.
        let updated = self
            .db
            .queries()
            .execute(
                &format!(
                    "UPDATE {ADMIN_TWO_FACTOR} SET totp_last_step = ? WHERE user_id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)"
                ),
                &[V::BigInt(step), V::BigInt(user_id), V::BigInt(step)],
            )
            .await?;
        Ok(updated == 1)
    }

    async fn use_recovery_code(&self, user_id: i64, code: &str) -> Result<bool> {
        let Some(stored) = self.stored(user_id).await? else { return Ok(false) };
        let hash = self.code_hash(&code.to_lowercase());
        let Some(index) = stored.recovery.iter().position(|stored| *stored == hash) else {
            return Ok(false);
        };
        let mut left = stored.recovery;
        left.remove(index);
        let before = serde_json::to_string(&{
            let mut all = left.clone();
            all.insert(index, hash);
            all
        })
        .expect("strings serialize");
        let after = serde_json::to_string(&left).expect("strings serialize");
        // Compare-and-set: two sign-ins cannot spend the same code.
        let updated = self
            .db
            .queries()
            .execute(
                &format!(
                    "UPDATE {ADMIN_TWO_FACTOR} SET recovery_codes = ?, updated_at = ? WHERE user_id = ? AND recovery_codes = ?"
                ),
                &[V::Text(after), V::DateTime(now()), V::BigInt(user_id), V::Text(before)],
            )
            .await?;
        Ok(updated == 1)
    }

    async fn stored(&self, user_id: i64) -> Result<Option<Stored>> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT totp_secret, totp_enabled_at, totp_last_step, recovery_codes FROM {ADMIN_TWO_FACTOR} WHERE user_id = ?"
                ),
                &[V::BigInt(user_id)],
                &[K::Text, K::DateTime, K::BigInt, K::Text],
            )
            .await?;
        let Some(row) = rows.into_iter().next() else { return Ok(None) };
        let mut row = row.into_iter();
        let secret = row.next().and_then(text).and_then(|sealed| self.open(user_id, &sealed));
        let enabled = matches!(row.next(), Some(V::DateTime(_)));
        let last_step = row.next().and_then(|value| value.as_i64());
        let recovery = row
            .next()
            .and_then(text)
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();
        Ok(Some(Stored { secret, enabled, last_step, recovery }))
    }

    async fn upsert(&self, user_id: i64, changes: &[(&str, V)]) -> Result<()> {
        let now = now();
        let mut tx = self.db.begin().await?;
        let exists = tx
            .has_rows(
                &format!("SELECT 1 FROM {ADMIN_TWO_FACTOR} WHERE user_id = ?"),
                &[V::BigInt(user_id)],
            )
            .await?;
        if !exists {
            tx.execute(
                &format!(
                    "INSERT INTO {ADMIN_TWO_FACTOR} (user_id, created_at, updated_at) VALUES (?, ?, ?)"
                ),
                &[V::BigInt(user_id), V::DateTime(now), V::DateTime(now)],
            )
            .await?;
        }
        let mut assignments = vec!["updated_at = ?".to_owned()];
        let mut params = vec![V::DateTime(now)];
        for (column, value) in changes {
            assignments.push(format!("{column} = ?"));
            params.push(value.clone());
        }
        params.push(V::BigInt(user_id));
        tx.execute(
            &format!("UPDATE {ADMIN_TWO_FACTOR} SET {} WHERE user_id = ?", assignments.join(", ")),
            &params,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// `v1:<nonce>:<secret XOR keystream>`, the keystream derived from the token pepper.
    fn seal(&self, user_id: i64, secret: &[u8]) -> String {
        let nonce = crypto::random_hex::<16>();
        let sealed: Vec<u8> =
            secret.iter().zip(self.keystream(user_id, &nonce)).map(|(a, b)| a ^ b).collect();
        format!("v1:{nonce}:{}", hex(&sealed))
    }

    fn open(&self, user_id: i64, sealed: &str) -> Option<Vec<u8>> {
        let mut parts = sealed.splitn(3, ':');
        if parts.next()? != "v1" {
            return None;
        }
        let nonce = parts.next()?;
        let bytes = unhex(parts.next()?)?;
        Some(bytes.iter().zip(self.keystream(user_id, nonce)).map(|(a, b)| a ^ b).collect())
    }

    fn keystream(&self, user_id: i64, nonce: &str) -> Vec<u8> {
        let hex = hmac_hex(&self.config.token_pepper, &format!("totp:{user_id}:{nonce}"));
        unhex(&hex).expect("hex")
    }

    fn code_hash(&self, code: &str) -> String {
        hmac_hex(&self.config.token_pepper, &format!("recovery:{code}"))
    }

    fn hashed_codes(&self, codes: &[String]) -> String {
        let hashes: Vec<String> =
            codes.iter().map(|code| self.code_hash(&code.replace('-', ""))).collect();
        serde_json::to_string(&hashes).expect("strings serialize")
    }
}

/// The step (`time / 30`) whose code is `code`, within one step of `now` and after
/// `last` (codes are single use).
fn matching_step(secret: &[u8], code: &str, now: i64, last: Option<i64>) -> Option<i64> {
    let current = now.div_euclid(STEP);
    (current - 1..=current + 1)
        .filter(|step| last.is_none_or(|last| *step > last))
        .find(|step| constant_eq(totp(secret, *step).as_bytes(), code.as_bytes()))
}

fn totp(secret: &[u8], step: i64) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC takes any key");
    mac.update(&(step as u64).to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let value = u32::from_be_bytes([
        digest[offset] & 0x7f,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]);
    format!("{:0width$}", value % 10u32.pow(DIGITS), width = DIGITS as usize)
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn recovery_codes() -> Vec<String> {
    (0..RECOVERY_CODES)
        .map(|_| {
            let bytes = crypto::random_bytes::<10>();
            let chars: String = bytes
                .iter()
                .map(|byte| RECOVERY_ALPHABET[*byte as usize % RECOVERY_ALPHABET.len()] as char)
                .collect();
            format!("{}-{}", &chars[..5], &chars[5..])
        })
        .collect()
}

/// RFC 4648 base32, without padding.
fn base32(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::new();
    let (mut buffer, mut bits) = (0u32, 0);
    for byte in bytes {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn percent(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b':' | b'@' => {
                (byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok()).collect()
}

/// The code of a secret shown by [`AuthService::totp_setup`] at a Unix time (tests,
/// authenticator apps).
pub fn totp_code(base32_secret: &str, at: i64) -> Option<String> {
    let secret = unbase32(base32_secret)?;
    Some(totp(&secret, at.div_euclid(STEP)))
}

fn unbase32(text: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = Vec::new();
    let (mut buffer, mut bits) = (0u32, 0);
    for c in text.trim_end_matches('=').bytes() {
        let value = ALPHABET.iter().position(|a| *a == c.to_ascii_uppercase())? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc6238_vectors() {
        // RFC 6238 appendix B (SHA-1, 8 digits there; the last 6 here).
        let secret = b"12345678901234567890";
        assert_eq!(totp(secret, 59 / STEP), "287082");
        assert_eq!(totp(secret, 1_111_111_109 / STEP), "081804");
        assert_eq!(totp(secret, 2_000_000_000 / STEP), "279037");
        assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
        assert_eq!(unbase32("MZXW6YTBOI").unwrap(), b"foobar");
    }

    #[test]
    fn codes_are_single_use_within_the_window() {
        let secret = b"12345678901234567890";
        let now = 1_111_111_109;
        let code = totp(secret, now / STEP);
        assert_eq!(matching_step(secret, &code, now, None), Some(now / STEP));
        assert_eq!(matching_step(secret, &code, now + 30, None), Some(now / STEP), "one step late");
        assert_eq!(matching_step(secret, &code, now + 90, None), None, "too late");
        assert_eq!(matching_step(secret, &code, now, Some(now / STEP)), None, "already used");
    }
}
