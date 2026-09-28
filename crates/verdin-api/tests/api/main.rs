//! Integration tests of the HTTP APIs, in one binary: each module was a test file of its
//! own, and linking 18 binaries cost gigabytes in `target/` and minutes per run.

mod common;

mod admin;
mod audit;
mod clone;
mod components;
mod conformance;
mod digest;
mod end_users;
mod history;
mod i18n;
mod media;
mod password;
mod plugins;
mod preview;
mod relations;
mod releases;
mod review;
mod sso;
mod stats;
mod traffic;
mod webhooks;
