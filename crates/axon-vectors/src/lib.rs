//! Target pipeline crate skeleton for `axon-vectors`.
//!
//! This crate is intentionally marker-only in PR0. Runtime behavior moves here
//! in issue #298 implementation PRs after contract tests exist.

pub mod collection;
pub mod filter;
pub mod health;
pub mod payload;
mod payload_redaction;
pub mod point;
#[cfg(test)]
mod qdrant;
pub mod query;
mod sparse;
pub mod store;
pub mod testing;
mod validation;

pub const CRATE_NAME: &str = "axon-vectors";

#[cfg(test)]
#[path = "store_tests.rs"]
mod store_tests;

#[cfg(test)]
#[path = "store_mode_tests.rs"]
mod store_mode_tests;

#[cfg(test)]
#[path = "payload_tests.rs"]
mod payload_tests;

#[cfg(test)]
#[path = "point_tests.rs"]
mod point_tests;

#[cfg(test)]
#[path = "qdrant_tests.rs"]
mod qdrant_tests;
