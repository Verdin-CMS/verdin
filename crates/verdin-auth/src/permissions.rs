//! Admin RBAC and content API grants (docs/architecture.md §14).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// Admin actions. Content actions take a subject (a content type uid or `*`).
pub mod actions {
    pub const CONTENT_READ: &str = "content.read";
    pub const CONTENT_CREATE: &str = "content.create";
    pub const CONTENT_UPDATE: &str = "content.update";
    pub const CONTENT_DELETE: &str = "content.delete";
    pub const CONTENT_PUBLISH: &str = "content.publish";
    pub const USERS_MANAGE: &str = "users.manage";
    pub const ROLES_MANAGE: &str = "roles.manage";
    pub const TOKENS_MANAGE: &str = "tokens.manage";
    pub const SCHEMA_MANAGE: &str = "schema.manage";

    pub const CONTENT: &[&str] =
        &[CONTENT_READ, CONTENT_CREATE, CONTENT_UPDATE, CONTENT_DELETE, CONTENT_PUBLISH];
    pub const SETTINGS: &[&str] = &[USERS_MANAGE, ROLES_MANAGE, TOKENS_MANAGE, SCHEMA_MANAGE];
}

/// Restricts a content permission to documents the user created.
pub const IS_CREATOR: &str = "is-creator";
pub const ALL_SUBJECTS: &str = "*";

pub const SUPER_ADMIN: &str = "super-admin";
pub const EDITOR: &str = "editor";
pub const AUTHOR: &str = "author";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditions: Vec<String>,
}

impl Permission {
    pub fn validate(&self) -> Result<(), String> {
        let content = actions::CONTENT.contains(&self.action.as_str());
        let settings = actions::SETTINGS.contains(&self.action.as_str());
        if !content && !settings {
            return Err(format!("unknown action `{}`", self.action));
        }
        if content && self.subject.is_none() {
            return Err(format!("`{}` needs a subject (a content type uid or `*`)", self.action));
        }
        if settings && (self.subject.is_some() || !self.conditions.is_empty()) {
            return Err(format!("`{}` takes no subject or conditions", self.action));
        }
        if let Some(condition) = self.conditions.iter().find(|condition| *condition != IS_CREATOR) {
            return Err(format!("unknown condition `{condition}`"));
        }
        Ok(())
    }
}

/// What a content permission allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grant {
    None,
    /// Only documents created by the user.
    Own,
    All,
}

/// Effective permissions of an admin user (union of their roles).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSet {
    pub super_admin: bool,
    pub permissions: Vec<Permission>,
}

impl PermissionSet {
    pub fn content(&self, action: &str, uid: &str) -> Grant {
        if self.super_admin {
            return Grant::All;
        }
        let mut grant = Grant::None;
        for permission in &self.permissions {
            let subject_matches = permission
                .subject
                .as_deref()
                .is_some_and(|subject| subject == ALL_SUBJECTS || subject == uid);
            if permission.action != action || !subject_matches {
                continue;
            }
            if permission.conditions.is_empty() {
                return Grant::All;
            }
            grant = Grant::Own;
        }
        grant
    }

    pub fn allows(&self, action: &str) -> bool {
        self.super_admin || self.permissions.iter().any(|permission| permission.action == action)
    }
}

/// Built-in roles: `(code, name, description, permissions)`. Super Admin has no rows:
/// it is allowed everything by code.
pub fn builtin_roles() -> Vec<(&'static str, &'static str, &'static str, Vec<Permission>)> {
    let content = |action: &str, conditions: &[&str]| Permission {
        action: action.into(),
        subject: Some(ALL_SUBJECTS.into()),
        conditions: conditions.iter().map(|condition| (*condition).into()).collect(),
    };
    vec![
        (SUPER_ADMIN, "Super Admin", "Everything, including users, roles and tokens.", Vec::new()),
        (
            EDITOR,
            "Editor",
            "Creates, edits, publishes and deletes all content.",
            actions::CONTENT.iter().map(|action| content(action, &[])).collect(),
        ),
        (
            AUTHOR,
            "Author",
            "Creates content and manages their own entries; cannot publish.",
            [
                actions::CONTENT_READ,
                actions::CONTENT_CREATE,
                actions::CONTENT_UPDATE,
                actions::CONTENT_DELETE,
            ]
            .iter()
            .map(|action| content(action, &[IS_CREATOR]))
            .collect(),
        ),
    ]
}

/// Content API actions (public role and API tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ContentAction {
    Find,
    FindOne,
    Create,
    Update,
    Delete,
    Publish,
    /// Reading `?status=draft`.
    ReadDrafts,
}

impl ContentAction {
    pub const ALL: [ContentAction; 7] = [
        ContentAction::Find,
        ContentAction::FindOne,
        ContentAction::Create,
        ContentAction::Update,
        ContentAction::Delete,
        ContentAction::Publish,
        ContentAction::ReadDrafts,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ContentAction::Find => "find",
            ContentAction::FindOne => "findOne",
            ContentAction::Create => "create",
            ContentAction::Update => "update",
            ContentAction::Delete => "delete",
            ContentAction::Publish => "publish",
            ContentAction::ReadDrafts => "readDrafts",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.as_str() == value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TokenKind {
    /// `find` and `findOne` on every type (no drafts).
    ReadOnly,
    /// Every action on every type.
    FullAccess,
    /// Only the listed grants.
    Custom,
}

impl TokenKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TokenKind::ReadOnly => "read-only",
            TokenKind::FullAccess => "full-access",
            TokenKind::Custom => "custom",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "read-only" => Some(TokenKind::ReadOnly),
            "full-access" => Some(TokenKind::FullAccess),
            "custom" => Some(TokenKind::Custom),
            _ => None,
        }
    }
}

/// `(content type uid, action)` pairs.
pub type Grants = HashSet<(String, ContentAction)>;

/// Who is calling the content API.
#[derive(Debug, Clone)]
pub enum ContentActor {
    Public(Grants),
    Token { id: i64, kind: TokenKind, grants: Grants },
}

impl ContentActor {
    pub fn allows(&self, uid: &str, action: ContentAction) -> bool {
        match self {
            ContentActor::Public(grants) => grants.contains(&(uid.to_owned(), action)),
            ContentActor::Token { kind: TokenKind::FullAccess, .. } => true,
            ContentActor::Token { kind: TokenKind::ReadOnly, .. } => {
                matches!(action, ContentAction::Find | ContentAction::FindOne)
            }
            ContentActor::Token { kind: TokenKind::Custom, grants, .. } => {
                grants.contains(&(uid.to_owned(), action))
            }
        }
    }

    pub fn is_token(&self) -> bool {
        matches!(self, ContentActor::Token { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permission(action: &str, subject: Option<&str>, conditions: &[&str]) -> Permission {
        Permission {
            action: action.into(),
            subject: subject.map(Into::into),
            conditions: conditions.iter().map(|c| (*c).into()).collect(),
        }
    }

    #[test]
    fn evaluates_content_grants() {
        let set = PermissionSet {
            super_admin: false,
            permissions: vec![
                permission(actions::CONTENT_READ, Some("*"), &[IS_CREATOR]),
                permission(actions::CONTENT_READ, Some("api::tag"), &[]),
                permission(actions::CONTENT_UPDATE, Some("api::article"), &[IS_CREATOR]),
                permission(actions::USERS_MANAGE, None, &[]),
            ],
        };
        assert_eq!(set.content(actions::CONTENT_READ, "api::article"), Grant::Own);
        assert_eq!(
            set.content(actions::CONTENT_READ, "api::tag"),
            Grant::All,
            "an unconditional grant wins"
        );
        assert_eq!(set.content(actions::CONTENT_UPDATE, "api::tag"), Grant::None);
        assert_eq!(set.content(actions::CONTENT_DELETE, "api::article"), Grant::None);
        assert!(set.allows(actions::USERS_MANAGE));
        assert!(!set.allows(actions::ROLES_MANAGE));
        assert_eq!(
            PermissionSet { super_admin: true, permissions: vec![] }.content("x", "y"),
            Grant::All
        );
    }

    #[test]
    fn validates_permissions() {
        assert!(permission(actions::CONTENT_READ, Some("*"), &[]).validate().is_ok());
        assert!(permission(actions::CONTENT_READ, None, &[]).validate().is_err());
        assert!(permission(actions::USERS_MANAGE, Some("*"), &[]).validate().is_err());
        assert!(permission("content.fly", Some("*"), &[]).validate().is_err());
        assert!(permission(actions::CONTENT_READ, Some("*"), &["is-owner"]).validate().is_err());
    }

    #[test]
    fn content_api_actors() {
        let grants: Grants = [("api::article".to_owned(), ContentAction::Find)].into();
        let public = ContentActor::Public(grants.clone());
        assert!(public.allows("api::article", ContentAction::Find));
        assert!(!public.allows("api::article", ContentAction::FindOne));
        assert!(!public.allows("api::tag", ContentAction::Find));

        let read_only =
            ContentActor::Token { id: 1, kind: TokenKind::ReadOnly, grants: Grants::new() };
        assert!(read_only.allows("api::tag", ContentAction::FindOne));
        assert!(!read_only.allows("api::tag", ContentAction::ReadDrafts));
        assert!(!read_only.allows("api::tag", ContentAction::Create));
        let full =
            ContentActor::Token { id: 2, kind: TokenKind::FullAccess, grants: Grants::new() };
        assert!(full.allows("api::tag", ContentAction::Delete));
        let custom = ContentActor::Token { id: 3, kind: TokenKind::Custom, grants };
        assert!(
            custom.allows("api::article", ContentAction::Find)
                && !custom.allows("api::article", ContentAction::Create)
        );
    }
}
