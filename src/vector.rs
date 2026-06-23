//! Compatibility shim: the vector store + RAG retrieval now live in `axon-vector`.
//!
//! `pub use axon_vector::*` re-exports the full public surface so every existing
//! `crate::vector::X` call site keeps resolving without a downstream rename.
pub use axon_vector::*;
