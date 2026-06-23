//! Compatibility shim: the MCP server now lives in the `axon-mcp` crate.
//! Re-exported so existing `crate::mcp::*` call sites resolve unchanged.
pub use axon_mcp::*;
