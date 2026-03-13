import { apiFetch } from '@/lib/api-fetch'

export interface ToolPreset {
  id: string
  name: string
  enabledMcpServers: string[]
  enabledMcpTools: string[]
}

export interface ToolPreferences {
  enabledMcpServers: string[]
  enabledMcpTools: string[]
  presets: ToolPreset[]
  updatedAt: string
}

const TOOL_PREFERENCES_LS_KEY_LEGACY = 'axon.web.reboot.tool-preferences.v1'
export const TOOL_PREFERENCES_LS_KEY = 'axon.web.shell.tool-preferences.v1'

function migrateToolPreferencesKey(): void {
  try {
    const legacy = window.localStorage.getItem(TOOL_PREFERENCES_LS_KEY_LEGACY)
    if (legacy && !window.localStorage.getItem(TOOL_PREFERENCES_LS_KEY)) {
      window.localStorage.setItem(TOOL_PREFERENCES_LS_KEY, legacy)
      window.localStorage.removeItem(TOOL_PREFERENCES_LS_KEY_LEGACY)
    }
  } catch {
    // localStorage may be unavailable (SSR / private browsing)
  }
}

if (typeof window !== 'undefined') {
  migrateToolPreferencesKey()
}

export async function fetchToolPreferences(): Promise<ToolPreferences | null> {
  try {
    const response = await apiFetch('/api/shell/tool-preferences')
    if (!response.ok) return null
    return (await response.json()) as ToolPreferences
  } catch {
    return null
  }
}

export async function persistToolPreferences(payload: {
  enabledMcpServers: string[]
  enabledMcpTools: string[]
  presets: ToolPreset[]
}): Promise<ToolPreferences | null> {
  try {
    const response = await apiFetch('/api/shell/tool-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return (await response.json()) as ToolPreferences
  } catch {
    return null
  }
}
