//! Compatibility shim: query/ask/evaluate result DTOs now live in `axon-api`.
//!
//! These transport-neutral result contracts moved to `axon_api::result` as
//! part of the workspace crate extraction (Cycle 1 break, epic axon_rust-23dw).
//! Existing `crate::services::types::*` call sites keep resolving through this
//! re-export, and the ask-explain re-export is preserved via the
//! `crate::core::ask_explain` shim.

pub use crate::core::ask_explain::*;
pub use axon_api::result::*;
