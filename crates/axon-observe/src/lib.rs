//! Target pipeline crate skeleton for `axon-observe`.
//!
//! This crate is intentionally marker-only in PR0. Runtime behavior moves here
//! in issue #298 implementation PRs after contract tests exist.

pub mod collector;
pub mod event;
pub mod heartbeat;
pub mod log;
pub mod metric;
pub mod phase;
pub mod progress;
pub mod reservation;
pub mod span;
pub mod testing;

pub const CRATE_NAME: &str = "axon-observe";

#[cfg(test)]
#[path = "reservation_tests.rs"]
mod reservation_tests;
