//! OAuth 2.0 (Authorization Code + PKCE) login client for the Axon server.
//!
//! The full flow runs in the Rust shell because the webview CSP forbids
//! outbound HTTP and there is no shell/deep-link capability. See the submodules
//! for the pieces; the Tauri commands and bridge glue are added in later tasks.

pub(crate) mod callback_server;
pub(crate) mod flow;
pub(crate) mod pkce;
pub(crate) mod store;
