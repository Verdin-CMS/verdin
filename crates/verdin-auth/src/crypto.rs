//! Passwords (argon2id), random tokens, digests and HS256 JWTs.

use std::sync::LazyLock;

use argon2::{Algorithm, Argon2, Params, PasswordHasher, PasswordVerifier, Version};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
const MEMORY_KIB: u32 = 19 * 1024;
const ITERATIONS: u32 = 2;
const LANES: u32 = 1;

fn argon2() -> Argon2<'static> {
    let params = Params::new(MEMORY_KIB, ITERATIONS, LANES, None).expect("valid argon2 parameters");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn hash_password(password: &str) -> String {
    let salt = random_bytes::<16>();
    argon2()
        .hash_password_with_salt(password.as_bytes(), &salt)
        .expect("argon2 hashing")
        .to_string()
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    argon2().verify_password(password.as_bytes(), hash).is_ok()
}

/// Hashes produced with other parameters are upgraded on the next successful login.
pub fn needs_rehash(hash: &str) -> bool {
    !hash.starts_with("$argon2id$")
        || !hash.contains(&format!("m={MEMORY_KIB},t={ITERATIONS},p={LANES}"))
}

/// Burns the same time as a real verification, so unknown emails are not detectable
/// by timing.
pub fn dummy_verify(password: &str) {
    static DUMMY: LazyLock<String> = LazyLock::new(|| hash_password("dummy password for timing"));
    let _ = verify_password(password, &DUMMY);
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes).expect("operating system randomness");
    bytes
}

/// 256 bits of randomness, URL-safe base64 without padding (43 chars).
pub fn random_token() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

pub fn random_hex<const N: usize>() -> String {
    hex(&random_bytes::<N>())
}

pub fn sha256_hex(value: &str) -> String {
    hex(&Sha256::digest(value.as_bytes()))
}

pub fn hmac_hex(key: &[u8], value: &str) -> String {
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(value.as_bytes());
    hex(&mac.finalize().into_bytes())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
}

pub const ISSUER: &str = "verdin";
pub const ADMIN_AUDIENCE: &str = "verdin-admin";

#[derive(Serialize, Deserialize)]
struct Header {
    alg: String,
    typ: String,
}

/// `header.payload.signature` with HMAC-SHA256.
pub fn encode_jwt(secret: &[u8], claims: &Claims) -> String {
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).expect("claims serialize"));
    let signing_input = format!("{header}.{payload}");
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(signing_input.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{signing_input}.{signature}")
}

/// Verifies signature (constant time), algorithm, issuer, audience and expiry.
pub fn decode_jwt(secret: &[u8], token: &str, audience: &str, now: i64) -> Option<Claims> {
    let mut parts = token.split('.');
    let (header, payload, signature) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(secret).ok()?;
    mac.update(format!("{header}.{payload}").as_bytes());
    mac.verify_slice(&URL_SAFE_NO_PAD.decode(signature).ok()?).ok()?;

    let header: Header = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(header).ok()?).ok()?;
    if header.alg != "HS256" {
        return None;
    }
    let claims: Claims = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    (claims.iss == ISSUER && claims.aud == audience && claims.exp > now).then_some(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_and_verifies_passwords() {
        let hash = hash_password("correct horse");
        assert!(hash.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"), "{hash}");
        assert!(verify_password("correct horse", &hash));
        assert!(!verify_password("wrong horse", &hash));
        assert!(!needs_rehash(&hash));
        assert!(needs_rehash("$argon2id$v=19$m=4096,t=3,p=1$c2FsdA$aGFzaA"));
        assert_ne!(hash, hash_password("correct horse"), "salted");
    }

    #[test]
    fn tokens_are_random_and_url_safe() {
        let token = random_token();
        assert_eq!(token.len(), 43);
        assert!(token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(token, random_token());
        assert_eq!(sha256_hex("abc").len(), 64);
        assert_ne!(hmac_hex(b"k1", "abc"), hmac_hex(b"k2", "abc"));
    }

    #[test]
    fn jwt_roundtrip_and_rejections() {
        let secret = b"0123456789abcdef0123456789abcdef";
        let claims = Claims {
            sub: "7".into(),
            iss: ISSUER.into(),
            aud: ADMIN_AUDIENCE.into(),
            iat: 100,
            exp: 200,
        };
        let token = encode_jwt(secret, &claims);
        assert_eq!(decode_jwt(secret, &token, ADMIN_AUDIENCE, 150), Some(claims.clone()));
        assert_eq!(decode_jwt(secret, &token, ADMIN_AUDIENCE, 200), None, "expired");
        assert_eq!(
            decode_jwt(b"another secret", &token, ADMIN_AUDIENCE, 150),
            None,
            "bad signature"
        );
        assert_eq!(decode_jwt(secret, &token, "other", 150), None, "wrong audience");

        let mut tampered: Vec<&str> = token.split('.').collect();
        let forged = URL_SAFE_NO_PAD
            .encode(r#"{"sub":"1","iss":"verdin","aud":"verdin-admin","iat":0,"exp":9999999999}"#);
        tampered[1] = &forged;
        assert_eq!(decode_jwt(secret, &tampered.join("."), ADMIN_AUDIENCE, 150), None);

        let none_alg = format!(
            "{}.{}.",
            URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#),
            token.split('.').nth(1).unwrap()
        );
        assert_eq!(decode_jwt(secret, &none_alg, ADMIN_AUDIENCE, 150), None);
    }
}
