//! Compatibility shim: the web layer now lives in the `axon-web` crate.
//! Re-exported so existing `crate::web::*` call sites resolve unchanged.
pub use axon_web::*;
