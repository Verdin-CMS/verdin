//! AuthService against `VERDIN_TEST_DATABASE_URL` (in-memory SQLite by default).

use verdin_auth::*;
use verdin_migrate::{ApplyOptions, Renames, Risk};
use verdin_schema::Schema;
use verdin_testkit::TestDb;

const SECRET: &str = "test-secret-test-secret-test-secret!";
const PEPPER: &str = "test-pepper-test-pepper-test-pepper!";

async fn setup() -> (TestDb, AuthService) {
    let test = TestDb::new().await;
    let model = verdin_migrate::derive_model(&Schema::default());
    verdin_migrate::apply(
        &test.db,
        &model,
        &Renames::default(),
        ApplyOptions { allow: Risk::Safe },
    )
    .await
    .unwrap();
    let auth = AuthService::new(test.db.clone(), AuthConfig::new(SECRET, PEPPER).unwrap());
    auth.bootstrap().await.unwrap();
    auth.bootstrap().await.unwrap(); // idempotent
    (test, auth)
}

fn admin(email: &str) -> NewUser {
    NewUser {
        email: email.into(),
        password: "correct horse 1".into(),
        firstname: Some("Ada".into()),
        ..NewUser::default()
    }
}

#[test]
fn rejects_short_secrets() {
    assert!(matches!(AuthConfig::new("short", PEPPER), Err(AuthError::InvalidConfig(_))));
}

#[tokio::test]
async fn first_admin_login_refresh_logout() {
    let (test, auth) = setup().await;
    assert!(!auth.has_admin().await.unwrap());
    let roles: Vec<String> =
        auth.roles().await.unwrap().into_iter().map(|role| role.code).collect();
    assert_eq!(roles, ["super-admin", "editor", "author"]);

    let session = auth.register_first_admin(admin("Ada@Example.com"), Some("tests")).await.unwrap();
    assert_eq!(session.user.email, "ada@example.com", "emails are normalized");
    assert_eq!(session.user.roles[0].code, "super-admin");
    assert!(matches!(
        auth.register_first_admin(admin("eve@example.com"), None).await,
        Err(AuthError::AlreadyInitialized)
    ));

    let principal = auth.authenticate(&session.access_token).await.unwrap();
    assert!(principal.permissions.super_admin);
    assert!(matches!(auth.authenticate("not.a.token").await, Err(AuthError::Unauthorized)));

    // Refresh rotates; the old token is dead and reusing it kills the family.
    let rotated = auth.refresh(&session.refresh_token, None).await.unwrap();
    assert_ne!(rotated.refresh_token, session.refresh_token);
    let again = auth.refresh(&rotated.refresh_token, None).await.unwrap();
    assert!(
        matches!(auth.refresh(&session.refresh_token, None).await, Err(AuthError::Unauthorized)),
        "reuse"
    );
    assert!(
        matches!(auth.refresh(&again.refresh_token, None).await, Err(AuthError::Unauthorized)),
        "family revoked"
    );

    let session = auth.login("ada@example.com", "correct horse 1", None).await.unwrap();
    auth.logout(&session.refresh_token).await.unwrap();
    assert!(matches!(
        auth.refresh(&session.refresh_token, None).await,
        Err(AuthError::Unauthorized)
    ));

    test.drop().await;
}

#[tokio::test]
async fn failed_logins_lock_the_account() {
    let (test, auth) = setup().await;
    auth.register_first_admin(admin("ada@example.com"), None).await.unwrap();
    assert!(matches!(
        auth.login("nobody@example.com", "x", None).await,
        Err(AuthError::InvalidCredentials)
    ));
    for _ in 0..5 {
        assert!(matches!(
            auth.login("ada@example.com", "wrong password", None).await,
            Err(AuthError::InvalidCredentials)
        ));
    }
    assert!(
        matches!(
            auth.login("ada@example.com", "correct horse 1", None).await,
            Err(AuthError::InvalidCredentials)
        ),
        "locked, and indistinguishable from a wrong password"
    );
    auth.reset_password("ada@example.com", "another horse 2").await.unwrap();
    assert!(
        auth.login("ada@example.com", "another horse 2", None).await.is_ok(),
        "reset clears the lock"
    );
    test.drop().await;
}

#[tokio::test]
async fn users_roles_and_the_last_super_admin() {
    let (test, auth) = setup().await;
    let first = auth.register_first_admin(admin("ada@example.com"), None).await.unwrap().user;
    let author = auth.role_by_code(AUTHOR).await.unwrap();

    let bob = auth
        .create_user(NewUser {
            roles: vec![author.id],
            is_active: true,
            ..admin("bob@example.com")
        })
        .await
        .unwrap();
    assert!(matches!(
        auth.create_user(NewUser { roles: vec![author.id], ..admin("BOB@example.com") }).await,
        Err(AuthError::Conflict(_))
    ));
    assert!(matches!(
        auth.create_user(NewUser { roles: vec![999], ..admin("x@example.com") }).await,
        Err(AuthError::Validation(_))
    ));
    assert!(matches!(
        auth.create_user(NewUser {
            roles: vec![author.id],
            password: "short".into(),
            ..admin("y@example.com")
        })
        .await,
        Err(AuthError::Validation(_))
    ));

    let set = auth.permission_set(bob.id).await.unwrap();
    assert_eq!(set.content(actions::CONTENT_UPDATE, "api::article"), Grant::Own);
    assert_eq!(set.content(actions::CONTENT_PUBLISH, "api::article"), Grant::None);
    assert!(!set.allows(actions::USERS_MANAGE));

    let deactivate = UserUpdate { is_active: Some(false), ..UserUpdate::default() };
    assert!(
        matches!(auth.update_user(first.id, deactivate).await, Err(AuthError::Validation(_))),
        "last super admin"
    );
    assert!(matches!(auth.delete_user(first.id).await, Err(AuthError::Validation(_))));
    auth.update_user(first.id, UserUpdate { firstname: Some(None), ..UserUpdate::default() })
        .await
        .unwrap();

    // Custom roles.
    let reviewer = auth
        .create_role(
            "reviewer",
            "Reviewer",
            None,
            vec![Permission {
                action: actions::CONTENT_PUBLISH.into(),
                subject: Some("api::article".into()),
                conditions: vec![],
            }],
        )
        .await
        .unwrap();
    assert!(matches!(
        auth.create_role("reviewer", "Again", None, vec![]).await,
        Err(AuthError::Conflict(_))
    ));
    auth.update_user(
        bob.id,
        UserUpdate { roles: Some(vec![author.id, reviewer.id]), ..UserUpdate::default() },
    )
    .await
    .unwrap();
    let set = auth.permission_set(bob.id).await.unwrap();
    assert_eq!(set.content(actions::CONTENT_PUBLISH, "api::article"), Grant::All);
    assert!(
        matches!(auth.delete_role(reviewer.id).await, Err(AuthError::Conflict(_))),
        "still assigned"
    );
    assert!(matches!(auth.delete_role(author.id).await, Err(AuthError::Validation(_))), "built-in");

    // Deactivated users lose their sessions and access tokens.
    let session = auth.login("bob@example.com", "correct horse 1", None).await.unwrap();
    auth.update_user(bob.id, UserUpdate { is_active: Some(false), ..UserUpdate::default() })
        .await
        .unwrap();
    assert!(matches!(auth.authenticate(&session.access_token).await, Err(AuthError::Unauthorized)));
    assert!(matches!(
        auth.refresh(&session.refresh_token, None).await,
        Err(AuthError::Unauthorized)
    ));
    auth.delete_user(bob.id).await.unwrap();
    auth.delete_role(reviewer.id).await.unwrap();

    test.drop().await;
}

#[tokio::test]
async fn api_tokens_and_public_permissions() {
    let (test, auth) = setup().await;

    let public = auth.content_actor(None).await.unwrap();
    assert!(!public.allows("api::article", ContentAction::Find), "closed by default");
    auth.set_public_grants(&[
        ("api::article".into(), ContentAction::Find),
        ("api::article".into(), ContentAction::Find),
    ])
    .await
    .unwrap();
    assert!(auth.content_actor(None).await.unwrap().allows("api::article", ContentAction::Find));

    let (token, secret) = auth
        .create_api_token(NewApiToken {
            name: "site".into(),
            description: None,
            kind: TokenKind::Custom,
            expires_in_days: None,
            permissions: vec![("api::tag".into(), ContentAction::Create)],
        })
        .await
        .unwrap();
    assert!(secret.starts_with("vd_") && secret.starts_with(&token.token_prefix));
    let actor = auth.content_actor(Some(&secret)).await.unwrap();
    assert!(
        actor.allows("api::tag", ContentAction::Create)
            && !actor.allows("api::tag", ContentAction::Delete)
    );
    assert!(matches!(auth.content_actor(Some("vd_wrong")).await, Err(AuthError::Unauthorized)));
    assert!(auth.api_token(token.id).await.unwrap().last_used_at.is_some());

    let updated = auth
        .update_api_token(
            token.id,
            ApiTokenUpdate { kind: Some(TokenKind::ReadOnly), ..ApiTokenUpdate::default() },
        )
        .await
        .unwrap();
    assert_eq!(updated.kind, TokenKind::ReadOnly);
    let actor = auth.content_actor(Some(&secret)).await.unwrap();
    assert!(
        actor.allows("api::tag", ContentAction::Find)
            && !actor.allows("api::tag", ContentAction::Create)
    );

    let duplicate = NewApiToken {
        name: "site".into(),
        description: None,
        kind: TokenKind::FullAccess,
        expires_in_days: Some(1),
        permissions: vec![],
    };
    assert!(matches!(auth.create_api_token(duplicate).await, Err(AuthError::Conflict(_))));

    auth.delete_api_token(token.id).await.unwrap();
    assert!(matches!(auth.content_actor(Some(&secret)).await, Err(AuthError::Unauthorized)));
    test.drop().await;
}
