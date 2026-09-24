//! Admin authentication, RBAC, API tokens and public permissions
//! (docs/architecture.md §14).

pub mod crypto;
mod permissions;
mod service;

pub use permissions::*;
pub use service::*;
