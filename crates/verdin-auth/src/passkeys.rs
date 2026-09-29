//! Passkeys (WebAuthn Level 2) as a second factor: registration and assertion checks for
//! ES256, EdDSA and RS256 credentials. Attestation statements are not verified (options
//! ask for `none`): a passkey proves possession, not its make.
//!
//! Challenges are stateless — signed with the JWT secret, bound to the user and purpose,
//! valid five minutes — and single use on the instance that checks them.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value as Json, json};
use sha2::{Digest, Sha256};
use verdin_db::{ColumnKind as K, SqlValue as V};
use verdin_migrate::system::{ADMIN_PASSKEYS, SPENT_CHALLENGES};

use super::two_factor::PasskeySummary;
use super::{AuthError, AuthService, Result, Session, int, now, text};
use crate::crypto::{self, hmac_hex};

const CHALLENGE_TTL: i64 = 300;
const TIMEOUT_MS: i64 = 300_000;
const MAX_PASSKEYS: usize = 20;
const ES256: i64 = -7;
const EDDSA: i64 = -8;
const RS256: i64 = -257;

/// Who passkeys are for: the admin panel's origin.
#[derive(Debug, Clone)]
pub struct RelyingParty {
    /// The host (`cms.example.com`).
    pub id: String,
    /// `https://cms.example.com` (with the port, if any).
    pub origin: String,
    pub name: String,
}

impl RelyingParty {
    /// From the public URL of the instance.
    pub fn from_url(url: &str, name: &str) -> Option<Self> {
        let (scheme, rest) = url.split_once("://")?;
        let authority = rest.split(['/', '?', '#']).next()?;
        let host = match authority.rsplit_once(':') {
            Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) => host,
            _ => authority,
        };
        if host.is_empty() {
            return None;
        }
        Some(Self {
            id: host.to_lowercase(),
            origin: format!("{}://{}", scheme.to_lowercase(), authority.to_lowercase()),
            name: name.to_owned(),
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Purpose {
    Create,
    Get,
}

impl Purpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Get => "get",
        }
    }
}

impl AuthService {
    /// `navigator.credentials.create` options for a new passkey.
    pub async fn passkey_registration_options(
        &self,
        user_id: i64,
        password: &str,
        rp: &RelyingParty,
    ) -> Result<Json> {
        self.confirm_password(user_id, password).await?;
        let user = self.user(user_id).await?;
        let existing = self.credentials(user_id).await?;
        if existing.len() >= MAX_PASSKEYS {
            return Err(AuthError::Validation(format!("at most {MAX_PASSKEYS} passkeys")));
        }
        let (token, challenge) = self.challenge(user_id, Purpose::Create);
        let display = [user.firstname.clone(), user.lastname.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let algorithms: Vec<Json> = [ES256, EDDSA, RS256]
            .iter()
            .map(|alg| json!({ "type": "public-key", "alg": alg }))
            .collect();
        Ok(json!({
            "challengeToken": token,
            "publicKey": {
                "challenge": challenge,
                "rp": { "id": rp.id, "name": rp.name },
                "user": {
                    "id": URL_SAFE_NO_PAD.encode(user_id.to_be_bytes()),
                    "name": user.email,
                    "displayName": if display.is_empty() { user.email.clone() } else { display },
                },
                "pubKeyCredParams": algorithms,
                "timeout": TIMEOUT_MS,
                "attestation": "none",
                "authenticatorSelection": { "residentKey": "preferred", "userVerification": "preferred" },
                "excludeCredentials": existing
                    .iter()
                    .map(|credential| json!({ "type": "public-key", "id": credential.credential_id }))
                    .collect::<Vec<_>>(),
            }
        }))
    }

    /// Stores the passkey the browser created (`PublicKeyCredential` as JSON, base64url).
    pub async fn add_passkey(
        &self,
        user_id: i64,
        rp: &RelyingParty,
        challenge_token: &str,
        name: &str,
        credential: &Json,
    ) -> Result<(PasskeySummary, Option<Vec<String>>)> {
        let challenge = self.redeem(challenge_token, user_id, Purpose::Create).await?;
        let response = &credential["response"];
        let client_data = field_bytes(response, "clientDataJSON")?;
        check_client_data(&client_data, "webauthn.create", &challenge, rp)?;
        let attestation = decode_cbor(&field_bytes(response, "attestationObject")?)?;
        let auth_data = attestation
            .get_text("authData")
            .and_then(Cbor::as_bytes)
            .ok_or_else(|| invalid("attestationObject has no authData"))?;
        let parsed = AuthData::parse(auth_data)?;
        parsed.check(rp)?;
        let credential = parsed.credential.ok_or_else(|| invalid("no credential in authData"))?;
        PublicKey::from_cose(&credential.public_key)?;
        let name = name.trim();
        let name = if name.is_empty() { "Passkey" } else { name };
        if name.chars().count() > 100 {
            return Err(AuthError::Validation("the name is at most 100 characters".into()));
        }
        let id = URL_SAFE_NO_PAD.encode(&credential.id);
        self.db
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {ADMIN_PASSKEYS} (user_id, credential_id, public_key, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::BigInt(user_id),
                    V::Text(id),
                    V::Text(URL_SAFE_NO_PAD.encode(&credential.public_key)),
                    V::BigInt(i64::from(parsed.sign_count)),
                    V::Text(name.to_owned()),
                    V::DateTime(now()),
                ],
            )
            .await
            .map_err(|error| {
                if error.unique_violation().is_some() {
                    AuthError::Conflict("this passkey is already registered".into())
                } else {
                    AuthError::Db(error)
                }
            })?;
        // The first factor comes with recovery codes, as TOTP's does.
        let codes = self.ensure_recovery_codes(user_id).await?;
        let status = self.two_factor_status(user_id).await?;
        let summary = status.passkeys.last().cloned().ok_or(AuthError::NotFound)?;
        Ok((summary, codes))
    }

    pub async fn remove_passkey(&self, user_id: i64, id: i64, password: &str) -> Result<()> {
        self.confirm_password(user_id, password).await?;
        let deleted = self
            .db
            .queries()
            .execute(
                &format!("DELETE FROM {ADMIN_PASSKEYS} WHERE id = ? AND user_id = ?"),
                &[V::BigInt(id), V::BigInt(user_id)],
            )
            .await?;
        if deleted == 0 { Err(AuthError::NotFound) } else { Ok(()) }
    }

    /// `navigator.credentials.get` options for the second sign-in step.
    pub async fn passkey_login_options(&self, token: &str, rp: &RelyingParty) -> Result<Json> {
        let user_id = self.second_step_user(token)?;
        let credentials = self.credentials(user_id).await?;
        if credentials.is_empty() {
            return Err(AuthError::Validation("this account has no passkey".into()));
        }
        let (challenge_token, challenge) = self.challenge(user_id, Purpose::Get);
        Ok(json!({
            "challengeToken": challenge_token,
            "publicKey": {
                "challenge": challenge,
                "rpId": rp.id,
                "timeout": TIMEOUT_MS,
                "userVerification": "preferred",
                "allowCredentials": credentials
                    .iter()
                    .map(|credential| json!({ "type": "public-key", "id": credential.credential_id }))
                    .collect::<Vec<_>>(),
            }
        }))
    }

    /// Second step with a passkey assertion.
    pub async fn login_with_passkey(
        &self,
        token: &str,
        rp: &RelyingParty,
        challenge_token: &str,
        credential: &Json,
        user_agent: Option<&str>,
    ) -> Result<Session> {
        let user_id = self.second_step_user(token)?;
        self.ensure_not_locked(user_id).await?;
        match self.verify_assertion(user_id, rp, challenge_token, credential).await {
            Ok(()) => self.finish_second_step(user_id, user_agent).await,
            Err(AuthError::Validation(message)) => {
                tracing::info!(user = user_id, %message, "passkey assertion refused");
                self.record_failed_login(user_id).await?;
                Err(AuthError::InvalidCredentials)
            }
            Err(error) => Err(error),
        }
    }

    async fn verify_assertion(
        &self,
        user_id: i64,
        rp: &RelyingParty,
        challenge_token: &str,
        credential: &Json,
    ) -> Result<()> {
        let challenge = self.redeem(challenge_token, user_id, Purpose::Get).await?;
        let id = credential["id"].as_str().ok_or_else(|| invalid("the credential has no id"))?;
        let stored = self
            .credentials(user_id)
            .await?
            .into_iter()
            .find(|stored| stored.credential_id == id)
            .ok_or_else(|| invalid("unknown passkey"))?;
        let response = &credential["response"];
        let client_data = field_bytes(response, "clientDataJSON")?;
        check_client_data(&client_data, "webauthn.get", &challenge, rp)?;
        let auth_data = field_bytes(response, "authenticatorData")?;
        let parsed = AuthData::parse(&auth_data)?;
        parsed.check(rp)?;
        let signature = field_bytes(response, "signature")?;
        let key = URL_SAFE_NO_PAD
            .decode(&stored.public_key)
            .map_err(|_| invalid("stored key is corrupt"))?;
        let mut signed = auth_data.clone();
        signed.extend_from_slice(&Sha256::digest(&client_data));
        PublicKey::from_cose(&key)?.verify(&signed, &signature)?;
        // A counter that does not grow means a cloned authenticator (0 = no counter).
        let count = i64::from(parsed.sign_count);
        if (count != 0 || stored.sign_count != 0) && count <= stored.sign_count {
            return Err(invalid("the signature counter went back"));
        }
        self.db
            .queries()
            .execute(
                &format!(
                    "UPDATE {ADMIN_PASSKEYS} SET sign_count = ?, last_used_at = ? WHERE id = ?"
                ),
                &[V::BigInt(count), V::DateTime(now()), V::BigInt(stored.id)],
            )
            .await?;
        Ok(())
    }

    async fn credentials(&self, user_id: i64) -> Result<Vec<StoredCredential>> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, credential_id, public_key, sign_count FROM {ADMIN_PASSKEYS} WHERE user_id = ? ORDER BY id"
                ),
                &[V::BigInt(user_id)],
                &[K::BigInt, K::Text, K::Text, K::BigInt],
            )
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let id = int(&row[0]);
                let sign_count = int(&row[3]);
                let mut row = row.into_iter().skip(1);
                StoredCredential {
                    id,
                    credential_id: row.next().and_then(text).unwrap_or_default(),
                    public_key: row.next().and_then(text).unwrap_or_default(),
                    sign_count,
                }
            })
            .collect())
    }

    /// A fresh challenge and the token that carries it.
    fn challenge(&self, user_id: i64, purpose: Purpose) -> (String, String) {
        let challenge = URL_SAFE_NO_PAD.encode(crypto::random_bytes::<32>());
        let expires = now().unix_timestamp() + CHALLENGE_TTL;
        let payload = format!("{}.{user_id}.{}.{expires}", purpose.as_str(), challenge);
        let mac = hmac_hex(&self.config.jwt_secret, &format!("passkey:{payload}"));
        (format!("{payload}.{mac}"), challenge)
    }

    /// The challenge of a valid, unspent token for `user_id` and `purpose`.
    async fn redeem(&self, token: &str, user_id: i64, purpose: Purpose) -> Result<Vec<u8>> {
        let (payload, mac) = token.rsplit_once('.').ok_or(AuthError::Unauthorized)?;
        let expected = hmac_hex(&self.config.jwt_secret, &format!("passkey:{payload}"));
        if !constant_eq(expected.as_bytes(), mac.as_bytes()) {
            return Err(AuthError::Unauthorized);
        }
        let parts: Vec<&str> = payload.split('.').collect();
        let [kind, user, challenge, expires] = parts.as_slice() else {
            return Err(AuthError::Unauthorized);
        };
        let expires: i64 = expires.parse().map_err(|_| AuthError::Unauthorized)?;
        let now = now().unix_timestamp();
        if *kind != purpose.as_str() || user.parse::<i64>().ok() != Some(user_id) || expires < now {
            return Err(AuthError::Unauthorized);
        }
        let mut queries = self.db.queries();
        queries
            .execute(
                &format!("DELETE FROM {SPENT_CHALLENGES} WHERE expires_at < ?"),
                &[V::BigInt(now)],
            )
            .await?;
        // The unique index lets one answer through, on any instance.
        let hash = crypto::sha256_hex(challenge);
        queries
            .execute(
                &format!(
                    "INSERT INTO {SPENT_CHALLENGES} (challenge_hash, expires_at) VALUES (?, ?)"
                ),
                &[V::Text(hash), V::BigInt(expires)],
            )
            .await
            .map_err(|_| AuthError::Unauthorized)?;
        URL_SAFE_NO_PAD.decode(challenge).map_err(|_| AuthError::Unauthorized)
    }
}

struct StoredCredential {
    id: i64,
    credential_id: String,
    public_key: String,
    sign_count: i64,
}

fn invalid(message: &str) -> AuthError {
    AuthError::Validation(format!("invalid passkey response: {message}"))
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn field_bytes(response: &Json, name: &str) -> Result<Vec<u8>> {
    let text = response[name].as_str().ok_or_else(|| invalid(&format!("missing {name}")))?;
    URL_SAFE_NO_PAD
        .decode(text.trim_end_matches('='))
        .map_err(|_| invalid(&format!("{name} is not base64url")))
}

fn check_client_data(bytes: &[u8], kind: &str, challenge: &[u8], rp: &RelyingParty) -> Result<()> {
    let data: Json = serde_json::from_slice(bytes).map_err(|_| invalid("clientDataJSON"))?;
    if data["type"] != kind {
        return Err(invalid("wrong ceremony type"));
    }
    let given = data["challenge"]
        .as_str()
        .and_then(|c| URL_SAFE_NO_PAD.decode(c.trim_end_matches('=')).ok());
    if given.as_deref() != Some(challenge) {
        return Err(invalid("wrong challenge"));
    }
    if data["origin"].as_str() != Some(rp.origin.as_str()) {
        return Err(invalid("wrong origin"));
    }
    if data["crossOrigin"] == true {
        return Err(invalid("cross-origin ceremonies are refused"));
    }
    Ok(())
}

struct AttestedCredential {
    id: Vec<u8>,
    /// COSE_Key, as sent.
    public_key: Vec<u8>,
}

struct AuthData {
    rp_id_hash: [u8; 32],
    flags: u8,
    sign_count: u32,
    credential: Option<AttestedCredential>,
}

impl AuthData {
    fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 37 {
            return Err(invalid("authenticator data is too short"));
        }
        let rp_id_hash: [u8; 32] = bytes[..32].try_into().expect("32 bytes");
        let flags = bytes[32];
        let sign_count = u32::from_be_bytes(bytes[33..37].try_into().expect("4 bytes"));
        let credential = if flags & 0x40 != 0 {
            let rest = &bytes[37..];
            if rest.len() < 18 {
                return Err(invalid("attested credential data is too short"));
            }
            let length = usize::from(u16::from_be_bytes([rest[16], rest[17]]));
            let id = rest.get(18..18 + length).ok_or_else(|| invalid("credential id"))?.to_vec();
            let key_bytes = &rest[18 + length..];
            let mut position = 0;
            decode_at(key_bytes, &mut position, 0)?;
            Some(AttestedCredential { id, public_key: key_bytes[..position].to_vec() })
        } else {
            None
        };
        Ok(Self { rp_id_hash, flags, sign_count, credential })
    }

    fn check(&self, rp: &RelyingParty) -> Result<()> {
        if self.rp_id_hash[..] != Sha256::digest(rp.id.as_bytes())[..] {
            return Err(invalid("wrong relying party"));
        }
        if self.flags & 0x01 == 0 {
            return Err(invalid("the user was not present"));
        }
        Ok(())
    }
}

enum PublicKey {
    Es256(p256::ecdsa::VerifyingKey),
    EdDsa(ed25519_dalek::VerifyingKey),
    Rs256 { n: num_bigint::BigUint, e: num_bigint::BigUint, bytes: usize },
}

impl PublicKey {
    fn from_cose(bytes: &[u8]) -> Result<Self> {
        let key = decode_cbor(bytes)?;
        let int = |label: i64| key.get_int(label).and_then(Cbor::as_int);
        let data = |label: i64| key.get_int(label).and_then(Cbor::as_bytes);
        match (int(1), int(3)) {
            // EC2, P-256.
            (Some(2), Some(ES256)) if int(-1) == Some(1) => {
                let (x, y) =
                    (data(-2).ok_or_else(|| invalid("x"))?, data(-3).ok_or_else(|| invalid("y"))?);
                if x.len() != 32 || y.len() != 32 {
                    return Err(invalid("P-256 coordinates"));
                }
                let mut point = vec![0x04];
                point.extend_from_slice(x);
                point.extend_from_slice(y);
                p256::ecdsa::VerifyingKey::from_sec1_bytes(&point)
                    .map(Self::Es256)
                    .map_err(|_| invalid("P-256 key"))
            }
            // OKP, Ed25519.
            (Some(1), Some(EDDSA)) if int(-1) == Some(6) => {
                let x: [u8; 32] = data(-2)
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| invalid("Ed25519 key"))?;
                ed25519_dalek::VerifyingKey::from_bytes(&x)
                    .map(Self::EdDsa)
                    .map_err(|_| invalid("Ed25519 key"))
            }
            (Some(3), Some(RS256)) => {
                let n = data(-1).ok_or_else(|| invalid("RSA modulus"))?;
                let e = data(-2).ok_or_else(|| invalid("RSA exponent"))?;
                let n_value = num_bigint::BigUint::from_bytes_be(n);
                if n_value.bits() < 2048 {
                    return Err(invalid("RSA keys need at least 2048 bits"));
                }
                Ok(Self::Rs256 {
                    bytes: n_value.bits().div_ceil(8) as usize,
                    n: n_value,
                    e: num_bigint::BigUint::from_bytes_be(e),
                })
            }
            _ => Err(invalid("unsupported key type (ES256, EdDSA and RS256 are)")),
        }
    }

    fn verify(&self, message: &[u8], signature: &[u8]) -> Result<()> {
        let valid = match self {
            Self::Es256(key) => {
                use p256::ecdsa::signature::Verifier;
                p256::ecdsa::Signature::from_der(signature)
                    .is_ok_and(|signature| key.verify(message, &signature).is_ok())
            }
            Self::EdDsa(key) => ed25519_dalek::Signature::from_slice(signature)
                .is_ok_and(|signature| key.verify_strict(message, &signature).is_ok()),
            Self::Rs256 { n, e, bytes } => {
                // EMSA-PKCS1-v1_5 with SHA-256 (RFC 8017 §9.2).
                const PREFIX: [u8; 19] = [
                    0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04,
                    0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
                ];
                let s = num_bigint::BigUint::from_bytes_be(signature);
                if signature.len() != *bytes || &s >= n {
                    false
                } else {
                    let m = s.modpow(e, n).to_bytes_be();
                    let mut expected = vec![0x00, 0x01];
                    expected.resize(bytes - PREFIX.len() - 32 - 1, 0xff);
                    expected.push(0x00);
                    expected.extend_from_slice(&PREFIX);
                    expected.extend_from_slice(&Sha256::digest(message));
                    let mut padded = vec![0u8; bytes.saturating_sub(m.len())];
                    padded.extend_from_slice(&m);
                    constant_eq(&padded, &expected)
                }
            }
        };
        if valid { Ok(()) } else { Err(invalid("bad signature")) }
    }
}

/// The CBOR subset WebAuthn uses (RFC 8949): integers, byte and text strings, arrays,
/// maps and simple values; definite lengths only.
#[derive(Debug, Clone, PartialEq)]
enum Cbor {
    Int(i128),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<Cbor>),
    Map(Vec<(Cbor, Cbor)>),
    Simple(u8),
}

impl Cbor {
    fn as_int(&self) -> Option<i64> {
        match self {
            Self::Int(value) => i64::try_from(*value).ok(),
            _ => None,
        }
    }

    fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Self::Bytes(bytes) => Some(bytes),
            _ => None,
        }
    }

    fn get_int(&self, label: i64) -> Option<&Cbor> {
        self.get(&Cbor::Int(i128::from(label)))
    }

    fn get_text(&self, label: &str) -> Option<&Cbor> {
        self.get(&Cbor::Text(label.to_owned()))
    }

    fn get(&self, key: &Cbor) -> Option<&Cbor> {
        match self {
            Self::Map(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

fn decode_cbor(bytes: &[u8]) -> Result<Cbor> {
    let mut position = 0;
    decode_at(bytes, &mut position, 0)
}

fn decode_at(bytes: &[u8], position: &mut usize, depth: usize) -> Result<Cbor> {
    if depth > 8 {
        return Err(invalid("CBOR nests too deep"));
    }
    let initial = *bytes.get(*position).ok_or_else(|| invalid("truncated CBOR"))?;
    *position += 1;
    let (major, info) = (initial >> 5, initial & 0x1f);
    let mut read = |count: usize| -> Result<u64> {
        let slice =
            bytes.get(*position..*position + count).ok_or_else(|| invalid("truncated CBOR"))?;
        *position += count;
        Ok(slice.iter().fold(0u64, |acc, byte| (acc << 8) | u64::from(*byte)))
    };
    let argument = match info {
        0..=23 => u64::from(info),
        24 => read(1)?,
        25 => read(2)?,
        26 => read(4)?,
        27 => read(8)?,
        _ => return Err(invalid("indefinite or reserved CBOR lengths")),
    };
    let length = |value: u64| -> Result<usize> {
        usize::try_from(value)
            .ok()
            .filter(|n| *n <= bytes.len())
            .ok_or_else(|| invalid("CBOR length"))
    };
    Ok(match major {
        0 => Cbor::Int(i128::from(argument)),
        1 => Cbor::Int(-1 - i128::from(argument)),
        2 | 3 => {
            let length = length(argument)?;
            let slice = bytes
                .get(*position..*position + length)
                .ok_or_else(|| invalid("truncated CBOR"))?;
            *position += length;
            if major == 2 {
                Cbor::Bytes(slice.to_vec())
            } else {
                Cbor::Text(String::from_utf8(slice.to_vec()).map_err(|_| invalid("CBOR text"))?)
            }
        }
        4 => {
            let items = (0..length(argument)?)
                .map(|_| decode_at(bytes, position, depth + 1))
                .collect::<Result<Vec<_>>>()?;
            Cbor::Array(items)
        }
        5 => {
            let mut entries = Vec::new();
            for _ in 0..length(argument)? {
                let key = decode_at(bytes, position, depth + 1)?;
                let value = decode_at(bytes, position, depth + 1)?;
                entries.push((key, value));
            }
            Cbor::Map(entries)
        }
        7 if info < 24 => Cbor::Simple(info),
        _ => return Err(invalid("unsupported CBOR item")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_cbor() {
        // {1: 2, 3: -7, -2: h'01', "a": [true, "x"]}
        let bytes =
            [0xa4, 0x01, 0x02, 0x03, 0x26, 0x21, 0x41, 0x01, 0x61, b'a', 0x82, 0xf5, 0x61, b'x'];
        let value = decode_cbor(&bytes).unwrap();
        assert_eq!(value.get_int(1).and_then(Cbor::as_int), Some(2));
        assert_eq!(value.get_int(3).and_then(Cbor::as_int), Some(-7));
        assert_eq!(value.get_int(-2).and_then(Cbor::as_bytes), Some(&[1u8][..]));
        assert!(matches!(value.get_text("a"), Some(Cbor::Array(items)) if items.len() == 2));
        assert!(decode_cbor(&[0x5f]).is_err(), "indefinite lengths");
        assert!(decode_cbor(&[0x5a, 0xff, 0xff, 0xff, 0xff]).is_err(), "lengths past the end");
    }

    #[test]
    fn relying_party_from_url() {
        let rp = RelyingParty::from_url("https://CMS.example.com:8443/admin", "Verdin").unwrap();
        assert_eq!(rp.id, "cms.example.com");
        assert_eq!(rp.origin, "https://cms.example.com:8443");
        let local = RelyingParty::from_url("http://localhost:1337", "Verdin").unwrap();
        assert_eq!(
            (local.id.as_str(), local.origin.as_str()),
            ("localhost", "http://localhost:1337")
        );
    }

    fn cbor_head(major: u8, value: usize, out: &mut Vec<u8>) {
        match value {
            0..=23 => out.push((major << 5) | value as u8),
            24..=255 => out.extend([(major << 5) | 24, value as u8]),
            _ => {
                out.push((major << 5) | 25);
                out.extend((value as u16).to_be_bytes());
            }
        }
    }

    fn cbor_int(value: i64, out: &mut Vec<u8>) {
        if value >= 0 {
            cbor_head(0, value as usize, out)
        } else {
            cbor_head(1, (-1 - value) as usize, out)
        }
    }

    /// A COSE key map of integer labels to integers or byte strings.
    fn cose(entries: &[(i64, std::result::Result<i64, Vec<u8>>)]) -> Vec<u8> {
        let mut out = Vec::new();
        cbor_head(5, entries.len(), &mut out);
        for (label, value) in entries {
            cbor_int(*label, &mut out);
            match value {
                Ok(int) => cbor_int(*int, &mut out),
                Err(bytes) => {
                    cbor_head(2, bytes.len(), &mut out);
                    out.extend_from_slice(bytes);
                }
            }
        }
        out
    }

    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
            .collect()
    }

    const MESSAGE: &[u8] = b"verdin passkey test";

    #[test]
    fn verifies_rs256_signatures() {
        // `openssl genpkey -algorithm RSA` and `openssl dgst -sha256 -sign`.
        let n = unhex(
            "95e60220671d38c60d0b43a3a63ba7c89ab3c4f33ec9dda27bf31a26158c72fdf3b53fc5743ccef4bf0fab1fefe3bcf3f28f3d34d726a48fefef205c768ae033b716d4d4bbf320e05974576c4660273a6f87aeb2bf13b8a511f0aefb0563e4fcd7913f114d5f417127253bbeffa88859e779714b824749f13f6d5cbf3b7f23b7e2b525217255e7e38689dfcdbd29b39799aef48095eb55d916096ba1b693c83f63fdb4e507d2ad9a9444118a9266f6dcbae4497b22ff854c31ac49bc07cb225e50125ae30bce31c85743625e57b04cc14655d5e6bbceb41a88cea3880e3513c26692ce618cc7b0304a4f46cac333bc341346f4c7dbd9d7a794e453606527d28f",
        );
        let signature = unhex(
            "209a292e87b3c318e3ff21dbbcda2ae9c88a4bb69c7085846c68f215b56c8374361d9b62d26fc129f6beb782786a7783ca55963a2f0602f1af4b77a4c0beede6a8252c88e631be124dd1fc92959a6ee237550f073d1f33d9aab8334e34a3d85001fce677327d98cc5eddafab5cc8769f43b79ca2970356650860ff7e1a4be85055180f95fc9a79be5fa9d9cab303561a1265f6f966cae268044771e1d1e95872b2cabd24750bbc262bf2a14f329cb6ffe151b847219ce693c721a0b48322949dc0a9cfbe5c4fef68068e33ddf6855b878bd162200ba00c01028b1e76417355a84b1d58e3e53f1c343fd1b8de0d2ebc364b7251bc3d93487d7de2874627755a0b",
        );
        let key = cose(&[(1, Ok(3)), (3, Ok(RS256)), (-1, Err(n)), (-2, Err(vec![1, 0, 1]))]);
        let key = PublicKey::from_cose(&key).unwrap();
        assert!(key.verify(MESSAGE, &signature).is_ok());
        assert!(key.verify(b"another message", &signature).is_err());
        let mut tampered = signature.clone();
        tampered[10] ^= 1;
        assert!(key.verify(MESSAGE, &tampered).is_err());
    }

    #[test]
    fn verifies_eddsa_signatures() {
        // `openssl genpkey -algorithm ed25519` and `openssl pkeyutl -sign -rawin`.
        let x = unhex("27d39be080d6bfe0147839e7c97c9eca73c0478a300ded07674d5d94d46e683d");
        let signature = unhex(
            "352f6d54e2d99cefa34c5dc8a359477c067e79e7a8db101e54471ef4260431c32d31866fccfe15f370f7a0a4008ef3cb20b3f5f548d88d98a3ed6f3b121a5603",
        );
        let key = cose(&[(1, Ok(1)), (3, Ok(EDDSA)), (-1, Ok(6)), (-2, Err(x))]);
        let key = PublicKey::from_cose(&key).unwrap();
        assert!(key.verify(MESSAGE, &signature).is_ok());
        assert!(key.verify(b"another message", &signature).is_err());
    }

    #[test]
    fn refuses_weak_or_unknown_keys() {
        let short =
            cose(&[(1, Ok(3)), (3, Ok(RS256)), (-1, Err(vec![0xff; 128])), (-2, Err(vec![3]))]);
        assert!(PublicKey::from_cose(&short).is_err(), "1024-bit RSA");
        let es384 = cose(&[(1, Ok(2)), (3, Ok(-35)), (-1, Ok(2))]);
        assert!(PublicKey::from_cose(&es384).is_err());
    }
}
