/**
 * ACP session-id lifecycle state machine.
 *
 * This captures the intended progression for session ID ownership across:
 * - optimistic client submit
 * - optional resume probe on reconnect
 * - backend-issued result/session_fallback IDs
 *
 * Keeping this explicit avoids ad-hoc transitions spread across callbacks.
 */
export type AcpSessionLifecycleState =
  | 'idle'
  | 'resume_requested'
  | 'turn_in_flight'
  | 'session_bound'
  | 'fallback_applied'
  | 'resume_failed'

export type AcpSessionLifecycleEvent =
  | 'request_resume'
  | 'start_turn'
  | 'bind_session'
  | 'apply_fallback'
  | 'resume_ok'
  | 'resume_miss'
  | 'clear'

export function advanceAcpSessionLifecycle(
  state: AcpSessionLifecycleState,
  event: AcpSessionLifecycleEvent,
): AcpSessionLifecycleState {
  switch (event) {
    case 'request_resume':
      return 'resume_requested'
    case 'start_turn':
      return 'turn_in_flight'
    case 'bind_session':
      return 'session_bound'
    case 'apply_fallback':
      return 'fallback_applied'
    case 'resume_ok':
      return 'session_bound'
    case 'resume_miss':
      return 'resume_failed'
    case 'clear':
      return 'idle'
    default:
      return state
  }
}
