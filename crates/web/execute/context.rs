use crate::crates::core::config::Config;
use std::sync::Arc;

use super::events;

#[derive(Debug, Clone)]
pub(super) struct ExecCommandContext {
    pub(super) exec_id: String,
    pub(super) mode: String,
    pub(super) input: String,
    /// Base server config from `AppState`.
    ///
    /// `sync_mode` and `async_mode` call `cfg.apply_overrides(&ws_overrides)`
    /// to produce a per-request `Config` for direct service dispatch.
    pub(super) cfg: Arc<Config>,
}

impl ExecCommandContext {
    pub(super) fn to_ws_ctx(&self) -> events::CommandContext {
        events::CommandContext {
            exec_id: self.exec_id.clone(),
            mode: self.mode.clone(),
            input: self.input.clone(),
        }
    }
}
