//! Single sign-on for the admin with OpenID Connect providers (the `sso` feature): the
//! authorization code flow with PKCE, a signed state bound to a cookie, and the ID token's
//! claims checked (issuer, audience, expiry, nonce).

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::ApiError;

/// The `sso` feature settings.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SsoSettings {
    #[serde(default)]
    pub providers: Vec<SsoProvider>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SsoProvider {
    /// In URLs and in `VERDIN_SSO_<ID>_SECRET`.
    pub id: String,
    /// On the login button.
    pub name: String,
    /// `https://accounts.google.com`, `https://login.microsoftonline.com/<tenant>/v2.0`…
    pub issuer: String,
    pub client_id: String,
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    /// Create an account on first sign-in (otherwise only existing admins may sign in).
    #[serde(default)]
    pub auto_create: bool,
    /// Role codes for created accounts when `roleClaim` maps to none.
    #[serde(default)]
    pub default_roles: Vec<String>,
    /// ID token claim holding the user's groups (`groups`, `roles`…).
    #[serde(default)]
    pub role_claim: Option<String>,
    /// Claim value → role code.
    #[serde(default)]
    pub role_map: BTreeMap<String, String>,
    /// Accepted email domains (empty: any).
    #[serde(default)]
    pub allowed_domains: Vec<String>,
}

fn default_scopes() -> Vec<String> {
    ["openid", "email", "profile"].map(String::from).to_vec()
}

/// Issuers must use HTTPS, except on the loopback interface (local identity providers).
fn secure_issuer(issuer: &str) -> bool {
    url::Url::parse(issuer).is_ok_and(|url| match url.scheme() {
        "https" => true,
        "http" => matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    })
}

impl SsoSettings {
    pub fn parse(settings: &Value) -> Result<Self, ApiError> {
        if settings.is_null() {
            return Ok(Self::default());
        }
        let parsed: Self = serde_json::from_value(settings.clone())
            .map_err(|error| ApiError::BadRequest(format!("invalid SSO settings: {error}")))?;
        let bad = |message: String| Err(ApiError::BadRequest(message));
        for (index, provider) in parsed.providers.iter().enumerate() {
            let id = &provider.id;
            let valid_id = !id.is_empty()
                && id.len() <= 32
                && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            if !valid_id {
                return bad(format!("provider id `{id}`: lowercase letters, digits and dashes"));
            }
            if parsed.providers[..index].iter().any(|other| other.id == *id) {
                return bad(format!("provider id `{id}` is used twice"));
            }
            if provider.name.trim().is_empty() || provider.client_id.trim().is_empty() {
                return bad(format!("provider `{id}` needs a name and a clientId"));
            }
            if !secure_issuer(&provider.issuer) {
                return bad(format!("the issuer of `{id}` must be an https URL"));
            }
            if !provider.scopes.iter().any(|scope| scope == "openid") {
                return bad(format!("the scopes of `{id}` must include openid"));
            }
            if provider.auto_create
                && provider.default_roles.is_empty()
                && provider.role_map.is_empty()
            {
                return bad(format!("`{id}` creates accounts: give it defaultRoles or a roleMap"));
            }
        }
        Ok(parsed)
    }

    pub fn provider(&self, id: &str) -> Option<&SsoProvider> {
        self.providers.iter().find(|provider| provider.id == id)
    }
}

pub fn secret_variable(id: &str) -> String {
    format!("VERDIN_SSO_{}_SECRET", id.to_uppercase().replace('-', "_"))
}

/// The provider's endpoints (`/.well-known/openid-configuration`).
#[derive(Debug, Clone, Deserialize)]
pub struct Discovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
}

pub async fn discover(http: &reqwest::Client, issuer: &str) -> Result<Discovery, ApiError> {
    let url = format!("{}/.well-known/openid-configuration", issuer.trim_end_matches('/'));
    let failed = |error: String| ApiError::BadRequest(format!("OpenID discovery failed: {error}"));
    let discovery: Discovery = http
        .get(&url)
        .send()
        .await
        .map_err(|error| failed(error.to_string()))?
        .error_for_status()
        .map_err(|error| failed(error.to_string()))?
        .json()
        .await
        .map_err(|error| failed(error.to_string()))?;
    if discovery.issuer.trim_end_matches('/') != issuer.trim_end_matches('/') {
        return Err(failed(format!("the issuer is {}", discovery.issuer)));
    }
    Ok(discovery)
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// The claims of an ID token received from the token endpoint. Its signature is not
/// checked: it came straight from the provider over TLS (OpenID Connect Core §3.1.3.7).
pub fn id_token_claims(
    id_token: &str,
    issuer: &str,
    client_id: &str,
    nonce: &str,
    now: i64,
) -> Result<Value, ApiError> {
    let invalid = |why: &str| ApiError::BadRequest(format!("invalid ID token: {why}"));
    let payload = id_token.split('.').nth(1).ok_or_else(|| invalid("not a JWT"))?;
    let claims: Value = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or_else(|| invalid("unreadable claims"))?;
    if claims["iss"].as_str().map(|iss| iss.trim_end_matches('/'))
        != Some(issuer.trim_end_matches('/'))
    {
        return Err(invalid("issuer"));
    }
    let audience = match &claims["aud"] {
        Value::String(aud) => aud == client_id,
        Value::Array(list) => {
            list.iter().any(|aud| aud == client_id)
                && (list.len() == 1 || claims["azp"].as_str() == Some(client_id))
        }
        _ => false,
    };
    if !audience {
        return Err(invalid("audience"));
    }
    if claims["exp"].as_i64().is_none_or(|exp| exp <= now) {
        return Err(invalid("expired"));
    }
    if claims["nonce"].as_str() != Some(nonce) {
        return Err(invalid("nonce"));
    }
    Ok(claims)
}

/// Role codes for a new account: the mapped values of the role claim, else the defaults.
pub fn mapped_roles(provider: &SsoProvider, claims: &Value) -> Vec<String> {
    let values: Vec<&str> = match provider.role_claim.as_deref().map(|claim| &claims[claim]) {
        Some(Value::String(value)) => vec![value.as_str()],
        Some(Value::Array(list)) => list.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    let mut roles: Vec<String> =
        values.iter().filter_map(|value| provider.role_map.get(*value).cloned()).collect();
    roles.sort();
    roles.dedup();
    if roles.is_empty() { provider.default_roles.clone() } else { roles }
}

pub fn allowed_email(provider: &SsoProvider, email: &str) -> bool {
    provider.allowed_domains.is_empty()
        || email.rsplit_once('@').is_some_and(|(_, domain)| {
            provider.allowed_domains.iter().any(|allowed| allowed.eq_ignore_ascii_case(domain))
        })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn provider() -> SsoProvider {
        serde_json::from_value(json!({
            "id": "corp", "name": "Corp", "issuer": "https://id.corp.test", "clientId": "verdin",
            "roleClaim": "groups", "roleMap": { "cms-admins": "super-admin", "writers": "editor" },
            "defaultRoles": ["author"], "allowedDomains": ["corp.test"]
        }))
        .unwrap()
    }

    fn token(claims: Value) -> String {
        format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    #[test]
    fn checks_id_tokens() {
        let good =
            json!({ "iss": "https://id.corp.test", "aud": "verdin", "exp": 200, "nonce": "n" });
        let check = |claims: Value| {
            id_token_claims(&token(claims), "https://id.corp.test/", "verdin", "n", 100)
        };
        assert!(check(good.clone()).is_ok());
        for (key, value) in [
            ("iss", json!("https://evil.test")),
            ("aud", json!("other")),
            ("aud", json!(["verdin", "other"])),
            ("exp", json!(50)),
            ("nonce", json!("m")),
        ] {
            let mut claims = good.clone();
            claims[key] = value;
            assert!(check(claims).is_err(), "{key}");
        }
        let mut shared = good.clone();
        shared["aud"] = json!(["verdin", "other"]);
        shared["azp"] = json!("verdin");
        assert!(check(shared).is_ok());
    }

    #[test]
    fn maps_roles_and_domains() {
        let provider = provider();
        assert_eq!(mapped_roles(&provider, &json!({ "groups": ["writers", "x"] })), ["editor"]);
        assert_eq!(mapped_roles(&provider, &json!({ "groups": "cms-admins" })), ["super-admin"]);
        assert_eq!(mapped_roles(&provider, &json!({})), ["author"]);
        assert!(allowed_email(&provider, "ada@Corp.test"));
        assert!(!allowed_email(&provider, "ada@corp.test.evil"));
    }

    #[test]
    fn validates_settings() {
        let base = json!({ "id": "corp", "name": "Corp", "issuer": "https://id.corp.test", "clientId": "v" });
        assert_eq!(
            SsoSettings::parse(&json!({ "providers": [base] })).unwrap().providers[0].scopes.len(),
            3
        );
        let local = json!({ "id": "dev", "name": "Dev", "issuer": "http://127.0.0.1:9000", "clientId": "v" });
        assert!(SsoSettings::parse(&json!({ "providers": [local] })).is_ok());
        for (key, value) in [
            ("id", json!("Corp!")),
            ("issuer", json!("http://id.corp.test")),
            ("scopes", json!(["email"])),
            ("autoCreate", json!(true)),
            ("clientId", json!(" ")),
        ] {
            let mut provider = base.clone();
            provider[key] = value;
            assert!(SsoSettings::parse(&json!({ "providers": [provider] })).is_err(), "{key}");
        }
        assert!(SsoSettings::parse(&json!({ "providers": [base, base] })).is_err());
    }
}
