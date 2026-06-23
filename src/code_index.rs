//! Compatibility shim: the local-code semantic index now lives in the
//! `axon-code-index` crate. Re-exported so existing `crate::code_index::*`
//! call sites resolve unchanged.
pub use axon_code_index::*;
