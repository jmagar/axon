import { useCallback, useEffect, useState } from 'react'
import {
  fetchToolPreferences,
  TOOL_PREFERENCES_LS_KEY,
  type ToolPreset,
} from '@/lib/reboot/tool-preferences'

type UseToolPreferenceStateParams = {
  mcpServerCount: number
  setEnabledMcpServers: (servers: string[]) => void
}

export type ToolPreferenceState = {
  enabledMcpTools: string[] | null
  handleCommandsUpdate: (commands: Array<{ name: string }>) => void
  mcpToolsByServer: Record<string, string[]>
  setEnabledMcpTools: React.Dispatch<React.SetStateAction<string[] | null>>
  setToolPresets: React.Dispatch<React.SetStateAction<ToolPreset[]>>
  toolPrefsHydrated: boolean
  toolPresets: ToolPreset[]
}

export function useToolPreferenceState({
  mcpServerCount,
  setEnabledMcpServers,
}: UseToolPreferenceStateParams): ToolPreferenceState {
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, string[]>>({})
  const [enabledMcpTools, setEnabledMcpTools] = useState<string[] | null>(null)
  const [toolPresets, setToolPresets] = useState<ToolPreset[]>([])
  const [toolPrefsHydrated, setToolPrefsHydrated] = useState(false)
  const [pendingToolPrefs, setPendingToolPrefs] = useState<{
    enabledMcpServers: string[]
    enabledMcpTools: string[]
    presets: ToolPreset[]
  } | null>(null)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TOOL_PREFERENCES_LS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        enabledMcpServers?: string[]
        enabledMcpTools?: string[]
        presets?: ToolPreset[]
      }
      setPendingToolPrefs({
        enabledMcpServers: Array.isArray(parsed.enabledMcpServers) ? parsed.enabledMcpServers : [],
        enabledMcpTools: Array.isArray(parsed.enabledMcpTools) ? parsed.enabledMcpTools : [],
        presets: Array.isArray(parsed.presets) ? parsed.presets : [],
      })
    } catch {
      // Ignore malformed local cache.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchToolPreferences().then((remote) => {
      if (cancelled || !remote) return
      setPendingToolPrefs({
        enabledMcpServers: remote.enabledMcpServers,
        enabledMcpTools: remote.enabledMcpTools,
        presets: remote.presets,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!pendingToolPrefs) return
    setEnabledMcpTools(pendingToolPrefs.enabledMcpTools)
    setToolPresets(pendingToolPrefs.presets)
    if (mcpServerCount > 0) {
      setEnabledMcpServers(pendingToolPrefs.enabledMcpServers)
    }
    setToolPrefsHydrated(true)
    setPendingToolPrefs(null)
  }, [mcpServerCount, pendingToolPrefs, setEnabledMcpServers])

  useEffect(() => {
    if (toolPrefsHydrated) return
    if (pendingToolPrefs) return
    setToolPrefsHydrated(true)
  }, [pendingToolPrefs, toolPrefsHydrated])

  const handleCommandsUpdate = useCallback((commands: Array<{ name: string }>) => {
    const grouped = new Map<string, string[]>()
    for (const command of commands) {
      if (!command.name.startsWith('mcp__')) continue
      const parts = command.name.split('__')
      if (parts.length < 3) continue
      const serverName = parts[1]?.trim()
      if (!serverName) continue
      const existing = grouped.get(serverName) ?? []
      existing.push(command.name)
      grouped.set(serverName, existing)
    }
    const next = Object.fromEntries(
      Array.from(grouped.entries()).map(([serverName, tools]) => [
        serverName,
        tools.sort((a, b) => a.localeCompare(b)),
      ]),
    )
    setMcpToolsByServer(next)
    const allTools = Object.values(next).flat()
    setEnabledMcpTools((current) => {
      if (current === null) return allTools
      return current.filter((toolName) => allTools.includes(toolName))
    })
  }, [])

  return {
    enabledMcpTools,
    handleCommandsUpdate,
    mcpToolsByServer,
    setEnabledMcpTools,
    setToolPresets,
    toolPrefsHydrated,
    toolPresets,
  }
}
