//! Compatibility shim: authz scope logic now lives in the `axon-authz` crate.
//!
//! Existing call sites reference `crate::authz::{scope_satisfies,
//! AXON_READ_SCOPE, AXON_WRITE_SCOPE, AXON_FULL_ACCESS_SCOPE}`; this re-export
//! keeps those paths valid after the extraction without a mass rename.

pub(crate) use axon_authz::{
    AXON_FULL_ACCESS_SCOPE, AXON_READ_SCOPE, AXON_WRITE_SCOPE, scope_satisfies,
};
