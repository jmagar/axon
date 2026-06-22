//! Compatibility shim: the shared core infrastructure now lives in the
//! `axon-core` crate (config, HTTP/SSRF, content transforms, LLM backends,
//! logging, paths, redaction, UI, health, endpoints, structured data).
//!
//! `pub use axon_core::*` re-exports the full public surface so every existing
//! `crate::core::X` call site keeps resolving without a downstream rename. The
//! `test-util` feature (enabled via the axon crate's dev-dependency on
//! axon-core) exposes the `#[cfg(test)]` helpers used by this crate's tests.

pub use axon_core::*;
