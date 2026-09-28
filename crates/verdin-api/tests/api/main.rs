//! Integration tests of the HTTP APIs, in one binary: each module was a test file of its
//! own, and linking 18 binaries cost gigabytes in `target/` and minutes per run.

mod common;

mod accounts;
mod admin;
mod ai;
mod audit;
mod clone;
mod comments;
mod components;
mod conditions;
mod conformance;
mod deploy;
mod digest;
mod end_users;
mod filters;
mod history;
mod i18n;
mod mcp;
mod media;
mod morph;
mod passkeys;
mod password;
mod plugins;
mod populate;
mod preview;
mod realtime;
mod relations;
mod releases;
mod review;
mod search;
mod site;
mod sso;
mod stats;
mod traffic;
mod transfer;
mod two_factor;
mod usage;
mod views;
mod visual_editing;
mod webhooks;
