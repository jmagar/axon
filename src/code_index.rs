pub(crate) mod config;
pub(crate) mod ensure;
pub(crate) mod indexer;
pub(crate) mod manifest;
pub(crate) mod store;

pub(crate) use config::{CodeIndexIdentity, CodeSearchAllowedRoots};
pub(crate) use ensure::{EnsureFreshOutcome, FreshnessWarning, ensure_fresh};

#[cfg(test)]
#[path = "code_index/tests.rs"]
mod tests;
