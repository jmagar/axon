//! Transport-neutral source pipeline DTOs.
//!
//! These are data contracts only. They are shared by CLI, MCP, REST, jobs,
//! stores, providers, and future adapters without pulling runtime crates into
//! `axon-api`.

pub mod capability;
pub mod common;
pub mod document;
pub mod enums;
pub mod graph;
pub mod ids;
pub mod lifecycle;
pub mod stage;
pub mod state;
pub mod vector;

pub use capability::*;
pub use common::*;
pub use document::*;
pub use enums::*;
pub use graph::*;
pub use ids::*;
pub use lifecycle::*;
pub use stage::*;
pub use state::*;
pub use vector::*;

#[cfg(test)]
#[path = "source_tests.rs"]
mod tests;
