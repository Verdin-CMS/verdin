//! Preview tokens: short-lived, signed permission to read the draft of one document through
//! the content API, handed to the site that renders previews.

use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};

use super::AuthService;
use crate::crypto::{Claims, ISSUER, decode_jwt, encode_jwt, hmac_hex};

pub const PREVIEW_AUDIENCE: &str = "verdin-preview";

/// What a preview token lets its bearer read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGrant {
    pub uid: String,
    pub document_id: String,
}

impl AuthService {
    fn preview_secret(&self) -> Vec<u8> {
        hmac_hex(&self.config.jwt_secret, "verdin-preview-jwt").into_bytes()
    }

    pub fn preview_token(&self, grant: &PreviewGrant, ttl: Duration) -> (String, OffsetDateTime) {
        let now = OffsetDateTime::now_utc();
        let expires = now + ttl;
        let token = encode_jwt(
            &self.preview_secret(),
            &Claims {
                sub: serde_json::to_string(grant).expect("grant serializes"),
                iss: ISSUER.into(),
                aud: PREVIEW_AUDIENCE.into(),
                iat: now.unix_timestamp(),
                exp: expires.unix_timestamp(),
                ver: None,
            },
        );
        (token, expires)
    }

    /// The grant of a valid, unexpired preview token.
    pub fn verify_preview(&self, token: &str) -> Option<PreviewGrant> {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let claims = decode_jwt(&self.preview_secret(), token, PREVIEW_AUDIENCE, now)?;
        serde_json::from_str(&claims.sub).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AuthConfig;

    #[tokio::test]
    async fn round_trip_and_audience() {
        let db =
            verdin_db::Database::connect("sqlite::memory:", &Default::default()).await.unwrap();
        let auth = AuthService::new(
            db,
            AuthConfig::new(
                "test-secret-test-secret-test-secret!",
                "test-pepper-test-pepper-test-pepper!",
            )
            .unwrap(),
        );
        let grant = PreviewGrant { uid: "api::article.article".into(), document_id: "abc".into() };
        let (token, _) = auth.preview_token(&grant, Duration::minutes(5));
        assert_eq!(auth.verify_preview(&token), Some(grant.clone()));
        assert_eq!(auth.verify_preview(&format!("{token}x")), None);
        let (expired, _) = auth.preview_token(&grant, Duration::minutes(-5));
        assert_eq!(auth.verify_preview(&expired), None);
    }
}
