# ACP Session ID Lifecycle

Source of truth: [`hooks/use-axon-acp/session-id-lifecycle.ts`](../hooks/use-axon-acp/session-id-lifecycle.ts)

## States

- `idle`: No active session binding work in progress.
- `resume_requested`: Reconnect path sent `acp_resume`.
- `turn_in_flight`: Prompt submitted and awaiting backend events.
- `session_bound`: Session ID is confirmed from resume/result.
- `fallback_applied`: Backend remapped session via `session_fallback`.
- `resume_failed`: Resume miss/expired session.

## Transition Events

- `request_resume`
- `start_turn`
- `bind_session`
- `apply_fallback`
- `resume_ok`
- `resume_miss`
- `clear`

This state machine exists to make session ID ownership explicit and auditable across reconnects, fallbacks, and turn completion.
