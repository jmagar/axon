import type { AxonMessage } from '@/hooks/use-axon-session'
import type { NeuralCanvasProfile } from '@/lib/pulse/neural-canvas-presets'
import type { RailMode } from './axon-ui-config'

export type RightPane = 'editor' | 'terminal' | 'logs' | 'mcp' | 'settings' | 'cortex' | null

export const VALID_RIGHT_PANES = new Set<string>([
  'editor',
  'terminal',
  'logs',
  'mcp',
  'settings',
  'cortex',
])

export type AxonMobilePane =
  | 'sidebar'
  | 'chat'
  | 'editor'
  | 'terminal'
  | 'logs'
  | 'mcp'
  | 'settings'
  | 'cortex'

export const AXON_MOBILE_PANE_STORAGE_KEY = 'axon.web.shell.mobile-pane'
export const SIDEBAR_WIDTH_STORAGE_KEY = 'axon.web.shell.sidebar-width'
export const CHAT_FLEX_STORAGE_KEY = 'axon.web.shell.chat-flex'
export const SIDEBAR_OPEN_STORAGE_KEY = 'axon.web.shell.sidebar-open'
export const CHAT_OPEN_STORAGE_KEY = 'axon.web.shell.chat-open'
export const RIGHT_PANE_STORAGE_KEY = 'axon.web.shell.right-pane'
export const RAIL_MODE_STORAGE_KEY = 'axon.web.shell.rail-mode'

// Migrate legacy "reboot" keys to "shell" keys so existing users keep their preferences.
const LEGACY_KEY_MAP: [string, string][] = [
  ['axon.web.reboot.chat-open', CHAT_OPEN_STORAGE_KEY],
  ['axon.web.reboot.right-pane', RIGHT_PANE_STORAGE_KEY],
  ['axon.web.reboot.rail-mode', RAIL_MODE_STORAGE_KEY],
]

function migrateShellStorageKeys(): void {
  try {
    for (const [legacy, current] of LEGACY_KEY_MAP) {
      const old = window.localStorage.getItem(legacy)
      if (old !== null && window.localStorage.getItem(current) === null) {
        window.localStorage.setItem(current, old)
        window.localStorage.removeItem(legacy)
      }
    }
  } catch {
    // localStorage may be unavailable (SSR / private browsing)
  }
}

if (typeof window !== 'undefined') {
  migrateShellStorageKeys()
}

export const CANVAS_PROFILE_STORAGE_KEY = 'axon.web.neural-canvas.profile'
export const LIVE_MESSAGES_STORAGE_KEY = 'axon.web.shell.live-messages.v1'
export const SIDEBAR_WIDTH_DEFAULT = 260
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 520
export const PANE_WIDTH_MIN = 240

export function readStoredFloat(key: string, fallback: number, min?: number, max?: number): number {
  try {
    const n = Number(window.localStorage.getItem(key))
    if (!Number.isFinite(n) || n <= 0) return fallback
    if (min !== undefined && max !== undefined) return Math.max(min, Math.min(max, n))
    return n
  } catch {
    return fallback
  }
}

export function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

export function readStoredRailMode(key: string, fallback: RailMode): RailMode {
  try {
    const v = window.localStorage.getItem(key)
    if (v === 'sessions' || v === 'files' || v === 'assistant') return v
    return fallback
  } catch {
    return fallback
  }
}

export function buildEditorMarkdown(path: string) {
  if (path.endsWith('.md') || path.endsWith('.mdx')) return '# New document\n'
  const language = path.split('.').at(-1) ?? 'text'
  return `# ${path}\n\n\`\`\`${language}\n\`\`\`\n`
}

export function agentDisplayName(agent: string): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1)
}

export function createClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fall through to deterministic fallback for non-secure origins.
  }
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function buildAgentHandoffContext(
  messages: Pick<AxonMessage, 'role' | 'content'>[],
  fromAgent: string,
  toAgent: string,
): string {
  const recentTurns = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.trim()}`)
  if (recentTurns.length === 0) return ''
  return [
    `Context handoff: switched active agent from ${fromAgent} to ${toAgent}.`,
    'Continue the same task with this prior chat context.',
    '',
    ...recentTurns,
  ].join('\n')
}

// New turns can complete before a session ID is assigned. In that state,
// reloading persisted session history would clear optimistic in-memory messages.
export function shouldReloadSessionOnTurnComplete(chatSessionId: string | null): boolean {
  return chatSessionId !== null
}

export const CANVAS_PROFILES: NeuralCanvasProfile[] = [
  'current',
  'subtle',
  'cinematic',
  'electric',
  'zen',
]
