//! Target pipeline crate skeleton for `axon-route`.
//!
//! This crate is intentionally marker-only in PR0. Runtime behavior moves here
//! in issue #298 implementation PRs after contract tests exist.

pub mod alias;
pub mod authority;
pub mod canonical;
pub mod capability;
pub mod resolver;
pub mod router;
pub mod scope;
pub mod source_id;
pub mod testing;

pub use authority::{AuthorityRecord, InMemoryAuthorityRegistry};
pub use capability::{AdapterDefinition, AdapterRegistry};
pub use resolver::SourceResolver;
pub use router::{RouteDecision, SourceRouter};

pub const CRATE_NAME: &str = "axon-route";

#[cfg(test)]
#[path = "route_tests.rs"]
mod tests;
