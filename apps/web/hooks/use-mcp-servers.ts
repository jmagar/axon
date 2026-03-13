'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'

type McpConfigResponse = {
  mcpServers?: Record<
    string,
    {
      command?: string
      args?: string[]
      url?: string
    }
  >
}

type McpStatusResponse = {
  servers?: Record<
    string,
    {
      status?: 'online' | 'offline' | 'unknown'
    }
  >
}

export type McpServersState = {
  mcpServers: string[]
  enabledMcpServers: string[]
  mcpStatusByServer: Record<string, 'online' | 'offline' | 'unknown'>
}

export function useMcpServers() {
  const [mcpServers, setMcpServers] = useState<string[]>([])
  const [enabledMcpServers, setEnabledMcpServersState] = useState<string[]>([])
  const [mcpStatusByServer, setMcpStatusByServer] = useState<
    Record<string, 'online' | 'offline' | 'unknown'>
  >({})

  useEffect(() => {
    let cancelled = false

    Promise.all([
      apiFetch('/api/mcp').then((response) => response.json() as Promise<McpConfigResponse>),
      apiFetch('/api/mcp/status')
        .then((response) => response.json() as Promise<McpStatusResponse>)
        .catch(() => ({ servers: {} })),
    ])
      .then(([config, status]) => {
        if (cancelled) return
        const serverNames = Object.keys(config.mcpServers ?? {})
        const statusServers: Record<string, { status?: 'online' | 'offline' | 'unknown' }> =
          status.servers ?? {}
        setMcpServers(serverNames)
        setEnabledMcpServersState((current) =>
          current.length > 0 ? current.filter((name) => serverNames.includes(name)) : serverNames,
        )
        setMcpStatusByServer(
          Object.fromEntries(
            serverNames.map((serverName) => [
              serverName,
              statusServers[serverName]?.status ?? 'unknown',
            ]),
          ),
        )
      })
      .catch(() => {
        if (cancelled) return
        setMcpServers([])
        setEnabledMcpServersState([])
        setMcpStatusByServer({})
      })

    return () => {
      cancelled = true
    }
  }, [])

  const toggleMcpServer = useCallback((serverName: string) => {
    setEnabledMcpServersState((current) =>
      current.includes(serverName)
        ? current.filter((name) => name !== serverName)
        : [...current, serverName],
    )
  }, [])

  const setEnabledMcpServers = useCallback(
    (serverNames: string[]) => {
      setEnabledMcpServersState((_current) => {
        const unique = Array.from(new Set(serverNames))
        if (unique.length === 0) return []
        return unique.filter((serverName) => mcpServers.includes(serverName))
      })
    },
    [mcpServers],
  )

  const composerToolsState: McpServersState = useMemo(
    () => ({
      mcpServers,
      enabledMcpServers,
      mcpStatusByServer,
    }),
    [enabledMcpServers, mcpServers, mcpStatusByServer],
  )

  return { ...composerToolsState, toggleMcpServer, setEnabledMcpServers }
}
