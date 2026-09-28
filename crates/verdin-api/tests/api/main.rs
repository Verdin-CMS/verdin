//! Integration tests of the HTTP APIs, in one binary: each module was a test file of its
//! own, and linking 18 binaries cost gigabytes in `target/` and minutes per run.

mod common;

mod accounts;
mod admin;
mod audit;
mod clone;
mod components;
mod conditions;
mod conformance;
mod digest;
mod end_users;
mod filters;
mod history;
mod i18n;
mod mcp;
mod media;
mod morph;
mod password;
mod plugins;
mod populate;
mod preview;
mod realtime;
mod relations;
mod releases;
mod review;
mod search;
mod sso;
mod stats;
mod traffic;
mod usage;
mod views;
mod webhooks;
