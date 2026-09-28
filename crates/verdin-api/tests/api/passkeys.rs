//! Passkeys as a second factor, with a software authenticator.

use axum::http::{Method, StatusCode};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use p256::ecdsa::signature::Signer;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use verdin_schema::Schema;

use crate::common::{App, As};

const PASSWORD: &str = "correct horse 1";
const ORIGIN: &str = "http://localhost:1337";

struct Authenticator {
    key: p256::ecdsa::SigningKey,
    id: Vec<u8>,
    count: u32,
}

/// Minimal CBOR encoding (major type, argument).
fn head(major: u8, value: usize, out: &mut Vec<u8>) {
    match value {
        0..=23 => out.push((major << 5) | value as u8),
        24..=255 => out.extend([(major << 5) | 24, value as u8]),
        _ => {
            out.push((major << 5) | 25);
            out.extend((value as u16).to_be_bytes());
        }
    }
}

fn int(value: i64, out: &mut Vec<u8>) {
    if value >= 0 { head(0, value as usize, out) } else { head(1, (-1 - value) as usize, out) }
}

fn bytes(value: &[u8], out: &mut Vec<u8>) {
    head(2, value.len(), out);
    out.extend_from_slice(value);
}

fn text(value: &str, out: &mut Vec<u8>) {
    head(3, value.len(), out);
    out.extend_from_slice(value.as_bytes());
}

impl Authenticator {
    fn new() -> Self {
        Self {
            key: p256::ecdsa::SigningKey::from_slice(&[7u8; 32]).unwrap(),
            id: vec![9; 16],
            count: 0,
        }
    }

    fn cose_key(&self) -> Vec<u8> {
        let point = self.key.verifying_key().to_sec1_point(false);
        let point = point.as_bytes();
        let mut out = Vec::new();
        head(5, 5, &mut out);
        int(1, &mut out);
        int(2, &mut out);
        int(3, &mut out);
        int(-7, &mut out);
        int(-1, &mut out);
        int(1, &mut out);
        int(-2, &mut out);
        bytes(&point[1..33], &mut out);
        int(-3, &mut out);
        bytes(&point[33..65], &mut out);
        out
    }

    fn auth_data(&self, flags: u8, attested: bool) -> Vec<u8> {
        let mut data = Sha256::digest(b"localhost").to_vec();
        data.push(flags);
        data.extend(self.count.to_be_bytes());
        if attested {
            data.extend([0u8; 16]);
            data.extend((self.id.len() as u16).to_be_bytes());
            data.extend(&self.id);
            data.extend(self.cose_key());
        }
        data
    }

    fn client_data(kind: &str, challenge: &str, origin: &str) -> Vec<u8> {
        json!({ "type": kind, "challenge": challenge, "origin": origin, "crossOrigin": false })
            .to_string()
            .into_bytes()
    }

    fn create(&self, challenge: &str) -> Value {
        let mut attestation = Vec::new();
        head(5, 3, &mut attestation);
        text("fmt", &mut attestation);
        text("none", &mut attestation);
        text("attStmt", &mut attestation);
        head(5, 0, &mut attestation);
        text("authData", &mut attestation);
        bytes(&self.auth_data(0x41, true), &mut attestation);
        json!({
            "id": B64.encode(&self.id),
            "type": "public-key",
            "response": {
                "clientDataJSON": B64.encode(Self::client_data("webauthn.create", challenge, ORIGIN)),
                "attestationObject": B64.encode(attestation),
            }
        })
    }

    fn get(&mut self, challenge: &str, origin: &str) -> Value {
        self.count += 1;
        let auth_data = self.auth_data(0x05, false);
        let client_data = Self::client_data("webauthn.get", challenge, origin);
        let mut signed = auth_data.clone();
        signed.extend(Sha256::digest(&client_data));
        let signature: p256::ecdsa::Signature = self.key.sign(&signed);
        json!({
            "id": B64.encode(&self.id),
            "type": "public-key",
            "response": {
                "clientDataJSON": B64.encode(client_data),
                "authenticatorData": B64.encode(auth_data),
                "signature": B64.encode(signature.to_der().as_bytes()),
            }
        })
    }
}

async fn post(app: &App, uri: &str, body: Value, who: Option<&str>) -> (StatusCode, Value) {
    app.call_as(Method::POST, uri, Some(body), who.map_or(As::Anonymous, As::Bearer)).await
}

#[tokio::test]
async fn passkeys_as_a_second_factor() {
    let app = App::new(Schema::default()).await;
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, body) = post(&app, "/admin/api/auth/register-first-admin", body, None).await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let mut authenticator = Authenticator::new();

    let (status, options) = post(
        &app,
        "/admin/api/auth/two-factor/passkeys/options",
        json!({ "password": PASSWORD }),
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{options}");
    assert_eq!(options["data"]["publicKey"]["rp"]["id"], "localhost");
    let challenge = options["data"]["publicKey"]["challenge"].as_str().unwrap().to_owned();
    let challenge_token = options["data"]["challengeToken"].as_str().unwrap().to_owned();
    let new = json!({ "challengeToken": challenge_token, "name": "Laptop",
                      "credential": authenticator.create(&challenge) });
    let (status, added) =
        post(&app, "/admin/api/auth/two-factor/passkeys", new.clone(), Some(&admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{added}");
    assert_eq!(added["data"]["passkey"]["name"], "Laptop");
    assert_eq!(added["data"]["recoveryCodes"].as_array().unwrap().len(), 10, "first factor");
    let (status, _) = post(&app, "/admin/api/auth/two-factor/passkeys", new, Some(&admin)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "challenges work once");

    let (_, first) = post(
        &app,
        "/admin/api/auth/login",
        json!({ "email": "ada@example.com", "password": PASSWORD }),
        None,
    )
    .await;
    assert_eq!(first["data"]["methods"], json!(["passkey", "recovery"]), "{first}");
    let token = first["data"]["twoFactorToken"].as_str().unwrap().to_owned();
    let options = || {
        let (app, token) = (&app, token.clone());
        async move {
            let (status, options) = post(
                app,
                "/admin/api/auth/login/passkey/options",
                json!({ "twoFactorToken": token }),
                None,
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{options}");
            (
                options["data"]["challengeToken"].as_str().unwrap().to_owned(),
                options["data"]["publicKey"]["challenge"].as_str().unwrap().to_owned(),
            )
        }
    };
    let finish = |challenge_token: String, credential: Value| {
        let (app, token) = (&app, token.clone());
        async move {
            post(
                app,
                "/admin/api/auth/login/two-factor",
                json!({ "twoFactorToken": token, "challengeToken": challenge_token, "credential": credential }),
                None,
            )
            .await
        }
    };

    let (challenge_token, challenge) = options().await;
    let (status, session) = finish(challenge_token, authenticator.get(&challenge, ORIGIN)).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert!(session["data"]["accessToken"].is_string());

    let (challenge_token, challenge) = options().await;
    let (status, _) =
        finish(challenge_token, authenticator.get(&challenge, "https://evil.test")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "another origin");

    let (challenge_token, challenge) = options().await;
    authenticator.count = 0;
    let (status, _) = finish(challenge_token, authenticator.get(&challenge, ORIGIN)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "the counter must grow");

    let (challenge_token, challenge) = options().await;
    let mut forged = authenticator.get(&challenge, ORIGIN);
    authenticator.count += 5;
    forged["response"]["signature"] =
        authenticator.get(&challenge, ORIGIN)["response"]["signature"].clone();
    let (status, _) = finish(challenge_token, forged).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "signatures cover the data");

    let (_, status) =
        app.call_as(Method::GET, "/admin/api/auth/two-factor", None, As::Bearer(&admin)).await;
    let id = status["data"]["passkeys"][0]["id"].clone();
    let (status, _) = app
        .call_as(
            Method::DELETE,
            &format!("/admin/api/auth/two-factor/passkeys/{id}"),
            Some(json!({ "password": PASSWORD })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    app.done().await;
}
