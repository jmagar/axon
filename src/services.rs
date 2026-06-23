//! Compatibility shim: the services layer now lives in the `axon-services` crate.
//! Re-exported so existing `crate::services::*` call sites resolve unchanged.
pub use axon_services::*;
