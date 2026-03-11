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

export const TOOL_PREFERENCES_LS_KEY = 'axon.web.reboot.tool-preferences.v1'

export async function fetchToolPreferences(): Promise<ToolPreferences | null> {
  try {
    const response = await apiFetch('/api/reboot/tool-preferences')
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
    const response = await apiFetch('/api/reboot/tool-preferences', {
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
