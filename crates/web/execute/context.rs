use super::events;

#[derive(Debug, Clone)]
pub(super) struct ExecCommandContext {
    pub(super) exec_id: String,
    pub(super) mode: String,
    pub(super) input: String,
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
