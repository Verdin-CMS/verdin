//! Platform tables (admin users, roles, sessions, tokens, permissions), part of every
//! derived model so that the migration engine creates and evolves them like content.
//! Content tables cannot use the `vd_` prefix.

use verdin_schema::naming::index_name;

use crate::model::{Column, ColumnType, ForeignKey, Index, Table};

pub const ADMIN_USERS: &str = "vd_admin_users";
pub const ADMIN_ROLES: &str = "vd_admin_roles";
pub const ADMIN_USER_ROLES: &str = "vd_admin_user_roles";
pub const ADMIN_PERMISSIONS: &str = "vd_admin_permissions";
pub const SESSIONS: &str = "vd_sessions";
pub const API_TOKENS: &str = "vd_api_tokens";
pub const API_TOKEN_PERMISSIONS: &str = "vd_api_token_permissions";
pub const PUBLIC_PERMISSIONS: &str = "vd_public_permissions";
pub const DOCUMENT_VIEWS: &str = "vd_document_views";
pub const DOCUMENT_VOTES: &str = "vd_document_votes";
pub const POLLS: &str = "vd_polls";
pub const POLL_VOTES: &str = "vd_poll_votes";
pub const FILES: &str = "vd_files";
pub const FOLDERS: &str = "vd_folders";
pub const SETTINGS: &str = "vd_settings";

fn id() -> Column {
    Column::new("id", ColumnType::Id).not_null()
}

fn varchar(name: &str, length: u16) -> Column {
    Column::new(name, ColumnType::Varchar { length })
}

fn timestamps() -> [Column; 2] {
    [
        Column::new("created_at", ColumnType::DateTime).not_null(),
        Column::new("updated_at", ColumnType::DateTime).not_null(),
    ]
}

fn unique(table: &str, part: &str, columns: &[&str]) -> Index {
    Index {
        name: index_name(table, part, "uq"),
        columns: columns.iter().map(|c| (*c).into()).collect(),
        unique: true,
    }
}

fn index(table: &str, part: &str, columns: &[&str]) -> Index {
    Index {
        name: index_name(table, part, "idx"),
        columns: columns.iter().map(|c| (*c).into()).collect(),
        unique: false,
    }
}

fn references(column: &str, table: &str) -> ForeignKey {
    ForeignKey { columns: vec![column.into()], table: table.into(), references: vec!["id".into()] }
}

pub fn system_tables() -> Vec<Table> {
    vec![
        Table {
            name: ADMIN_USERS.into(),
            columns: [
                vec![
                    id(),
                    varchar("email", 255).not_null(),
                    varchar("firstname", 255),
                    varchar("lastname", 255),
                    varchar("password_hash", 255).not_null(),
                    Column::new("is_active", ColumnType::Boolean).not_null(),
                    Column::new("failed_logins", ColumnType::Integer).not_null(),
                    Column::new("locked_until", ColumnType::DateTime),
                    // Admin panel preferences (dashboard layout…), owned by the user.
                    Column::new("preferences", ColumnType::Json),
                ],
                timestamps().to_vec(),
            ]
            .concat(),
            indexes: vec![unique(ADMIN_USERS, "email", &["email"])],
            foreign_keys: Vec::new(),
        },
        Table {
            name: ADMIN_ROLES.into(),
            columns: [
                vec![
                    id(),
                    varchar("code", 64).not_null(),
                    varchar("name", 255).not_null(),
                    Column::new("description", ColumnType::Text),
                    Column::new("builtin", ColumnType::Boolean).not_null(),
                ],
                timestamps().to_vec(),
            ]
            .concat(),
            indexes: vec![unique(ADMIN_ROLES, "code", &["code"])],
            foreign_keys: Vec::new(),
        },
        Table {
            name: ADMIN_USER_ROLES.into(),
            columns: vec![
                id(),
                Column::new("user_id", ColumnType::BigInt).not_null(),
                Column::new("role_id", ColumnType::BigInt).not_null(),
            ],
            indexes: vec![
                unique(ADMIN_USER_ROLES, "pair", &["user_id", "role_id"]),
                index(ADMIN_USER_ROLES, "role", &["role_id"]),
            ],
            foreign_keys: vec![
                references("user_id", ADMIN_USERS),
                references("role_id", ADMIN_ROLES),
            ],
        },
        Table {
            name: ADMIN_PERMISSIONS.into(),
            columns: vec![
                id(),
                Column::new("role_id", ColumnType::BigInt).not_null(),
                varchar("action", 64).not_null(),
                // A content type uid, `*` for every type, or NULL for non-content actions.
                varchar("subject", 255),
                // JSON array of condition names, e.g. ["is-creator"].
                Column::new("conditions", ColumnType::Text),
                // JSON list of attribute names; NULL means every field.
                Column::new("fields", ColumnType::Text),
            ],
            indexes: vec![index(ADMIN_PERMISSIONS, "role", &["role_id"])],
            foreign_keys: vec![references("role_id", ADMIN_ROLES)],
        },
        Table {
            name: SESSIONS.into(),
            columns: vec![
                id(),
                Column::new("user_id", ColumnType::BigInt).not_null(),
                varchar("family", 64).not_null(),
                Column::new("token_hash", ColumnType::Char { length: 64 }).not_null(),
                Column::new("expires_at", ColumnType::DateTime).not_null(),
                Column::new("used_at", ColumnType::DateTime),
                Column::new("revoked_at", ColumnType::DateTime),
                varchar("user_agent", 255),
                Column::new("created_at", ColumnType::DateTime).not_null(),
            ],
            indexes: vec![
                unique(SESSIONS, "token", &["token_hash"]),
                index(SESSIONS, "family", &["family"]),
            ],
            foreign_keys: vec![references("user_id", ADMIN_USERS)],
        },
        Table {
            name: API_TOKENS.into(),
            columns: [
                vec![
                    id(),
                    varchar("name", 255).not_null(),
                    Column::new("description", ColumnType::Text),
                    varchar("kind", 16).not_null(),
                    Column::new("token_hash", ColumnType::Char { length: 64 }).not_null(),
                    varchar("token_prefix", 16).not_null(),
                    Column::new("expires_at", ColumnType::DateTime),
                    Column::new("last_used_at", ColumnType::DateTime),
                ],
                timestamps().to_vec(),
            ]
            .concat(),
            indexes: vec![
                unique(API_TOKENS, "name", &["name"]),
                unique(API_TOKENS, "token", &["token_hash"]),
            ],
            foreign_keys: Vec::new(),
        },
        Table {
            name: API_TOKEN_PERMISSIONS.into(),
            columns: vec![
                id(),
                Column::new("token_id", ColumnType::BigInt).not_null(),
                varchar("subject", 255).not_null(),
                varchar("action", 32).not_null(),
            ],
            indexes: vec![unique(
                API_TOKEN_PERMISSIONS,
                "grant",
                &["token_id", "subject", "action"],
            )],
            foreign_keys: vec![references("token_id", API_TOKENS)],
        },
        Table {
            name: PUBLIC_PERMISSIONS.into(),
            columns: vec![
                id(),
                varchar("subject", 255).not_null(),
                varchar("action", 32).not_null(),
            ],
            indexes: vec![unique(PUBLIC_PERMISSIONS, "grant", &["subject", "action"])],
            foreign_keys: Vec::new(),
        },
        // Instance-wide settings and markers (feature switches, data upgrades).
        Table {
            name: SETTINGS.into(),
            columns: vec![
                id(),
                varchar("key", 100).not_null(),
                Column::new("value", ColumnType::Json),
                Column::new("updated_at", ColumnType::DateTime).not_null(),
            ],
            indexes: vec![unique(SETTINGS, "key", &["key"])],
            foreign_keys: Vec::new(),
        },
        // The media library (Strapi's `files`). No foreign keys: media link tables reference
        // it, and tables are created in two groups (without, then with foreign keys).
        Table {
            name: FILES.into(),
            columns: [
                vec![
                    id(),
                    Column::new("document_id", ColumnType::Char { length: 26 }).not_null(),
                    varchar("name", 255).not_null(),
                    Column::new("alternative_text", ColumnType::Text),
                    Column::new("caption", ColumnType::Text),
                    Column::new("width", ColumnType::Integer),
                    Column::new("height", ColumnType::Integer),
                    Column::new("focal_point", ColumnType::Json),
                    Column::new("formats", ColumnType::Json),
                    varchar("hash", 255).not_null(),
                    varchar("ext", 32).not_null(),
                    varchar("mime", 255).not_null(),
                    Column::new("size", ColumnType::Decimal { precision: 14, scale: 2 }).not_null(),
                    Column::new("url", ColumnType::Text).not_null(),
                    Column::new("preview_url", ColumnType::Text),
                    varchar("provider", 64).not_null(),
                    Column::new("provider_metadata", ColumnType::Json),
                    Column::new("folder_id", ColumnType::BigInt),
                    varchar("folder_path", 255).not_null(),
                    Column::new("created_by", ColumnType::BigInt),
                    Column::new("updated_by", ColumnType::BigInt),
                ],
                timestamps().to_vec(),
            ]
            .concat(),
            indexes: vec![
                unique(FILES, "document", &["document_id"]),
                unique(FILES, "hash", &["hash"]),
                index(FILES, "folder", &["folder_path"]),
                index(FILES, "created", &["created_at"]),
            ],
            foreign_keys: Vec::new(),
        },
        // `path` is the chain of `path_id`s from the root, e.g. `/1/4` (Strapi's format).
        Table {
            name: FOLDERS.into(),
            columns: [
                vec![
                    id(),
                    Column::new("document_id", ColumnType::Char { length: 26 }).not_null(),
                    varchar("name", 255).not_null(),
                    Column::new("path_id", ColumnType::Integer).not_null(),
                    varchar("path", 255).not_null(),
                    Column::new("parent_id", ColumnType::BigInt),
                    Column::new("created_by", ColumnType::BigInt),
                ],
                timestamps().to_vec(),
            ]
            .concat(),
            indexes: vec![
                unique(FOLDERS, "document", &["document_id"]),
                unique(FOLDERS, "path_id", &["path_id"]),
                unique(FOLDERS, "path", &["path"]),
                index(FOLDERS, "parent", &["parent_id"]),
            ],
            foreign_keys: Vec::new(),
        },
        // Which admin has seen which document version (removed when someone else edits it).
        Table {
            name: DOCUMENT_VIEWS.into(),
            columns: vec![
                id(),
                Column::new("user_id", ColumnType::BigInt).not_null(),
                varchar("content_type", 255).not_null(),
                varchar("document_id", 26).not_null(),
                Column::new("viewed_at", ColumnType::DateTime).not_null(),
            ],
            indexes: vec![
                unique(DOCUMENT_VIEWS, "view", &["user_id", "content_type", "document_id"]),
                index(DOCUMENT_VIEWS, "document", &["content_type", "document_id"]),
            ],
            foreign_keys: vec![references("user_id", ADMIN_USERS)],
        },
        // One vote (+1 or -1) per admin and document.
        Table {
            name: DOCUMENT_VOTES.into(),
            columns: vec![
                id(),
                Column::new("user_id", ColumnType::BigInt).not_null(),
                varchar("content_type", 255).not_null(),
                varchar("document_id", 26).not_null(),
                Column::new("value", ColumnType::SmallInt).not_null(),
                Column::new("created_at", ColumnType::DateTime).not_null(),
            ],
            indexes: vec![
                unique(DOCUMENT_VOTES, "vote", &["user_id", "content_type", "document_id"]),
                index(DOCUMENT_VOTES, "document", &["content_type", "document_id"]),
            ],
            foreign_keys: vec![references("user_id", ADMIN_USERS)],
        },
        // Polls shown in dashboard widgets. `created_by` has no foreign key: polls
        // outlive their author.
        Table {
            name: POLLS.into(),
            columns: [
                vec![
                    id(),
                    varchar("question", 500).not_null(),
                    Column::new("options", ColumnType::Json).not_null(),
                    Column::new("multiple", ColumnType::Boolean).not_null(),
                    Column::new("closed", ColumnType::Boolean).not_null(),
                    Column::new("closes_at", ColumnType::DateTime),
                    Column::new("created_by", ColumnType::BigInt),
                ],
                timestamps().to_vec(),
            ]
            .concat(),
            indexes: Vec::new(),
            foreign_keys: Vec::new(),
        },
        Table {
            name: POLL_VOTES.into(),
            columns: vec![
                id(),
                Column::new("poll_id", ColumnType::BigInt).not_null(),
                Column::new("user_id", ColumnType::BigInt).not_null(),
                Column::new("choice", ColumnType::SmallInt).not_null(),
                Column::new("created_at", ColumnType::DateTime).not_null(),
            ],
            indexes: vec![
                unique(POLL_VOTES, "vote", &["poll_id", "user_id", "choice"]),
                index(POLL_VOTES, "user", &["user_id"]),
            ],
            foreign_keys: vec![references("poll_id", POLLS), references("user_id", ADMIN_USERS)],
        },
    ]
}
