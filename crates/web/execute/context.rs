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
    /// Tasks 5.2 and 5.3 will call `cfg.apply_overrides(&ws_overrides)` to
    /// produce a per-request `Config` for direct service dispatch.
    // Tasks 5.2/5.3 will read this field once direct service dispatch lands;
    // suppress the pre-wiring dead_code lint until then.
    #[allow(dead_code)]
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
