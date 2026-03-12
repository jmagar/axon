'use client'

import { Network, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  configToForm,
  EMPTY_FORM,
  type FormState,
  type McpConfig,
  McpServerCard,
  type McpServerConfig,
  McpServerForm,
  type McpServerStatus,
} from '@/app/settings/mcp/components'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useAxonWs } from '@/hooks/use-axon-ws'
import { apiFetch } from '@/lib/api-fetch'
import { McpIcon } from './mcp-config'

function DeleteConfirmModal({
  name,
  onConfirm,
  onCancel,
}: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(3,7,18,0.75)] backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border-standard)] bg-[var(--surface-base)] p-5 shadow-[var(--shadow-xl)]">
        <div className="mb-1 flex items-center gap-2">
          <Trash2 className="size-4 text-[var(--axon-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Delete &ldquo;{name}&rdquo;?
          </h3>
        </div>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          This MCP server configuration will be permanently removed.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-float)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-[var(--border-accent)] bg-[rgba(255,135,175,0.15)] px-3 py-1.5 text-xs text-[var(--axon-secondary)] transition-colors hover:bg-[rgba(255,135,175,0.25)]"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-float)] p-8 text-center">
      <Network className="size-8 text-[var(--axon-primary)]" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          No MCP servers configured
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          MCP servers extend Claude&apos;s capabilities with external tools, APIs, and data sources.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border-standard)] bg-[rgba(135,175,255,0.15)] px-4 py-2 text-[12px] font-semibold text-[var(--axon-primary)] transition-colors hover:bg-[rgba(135,175,255,0.25)]"
      >
        <Plus className="size-3.5" />
        Add your first server
      </button>
    </div>
  )
}

function McpPaneContent() {
  const { send } = useAxonWs()
  const [config, setConfig] = useState<McpConfig>({ mcpServers: {} })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<string | null>(null)
  const [statusMap, setStatusMap] = useState<Record<string, McpServerStatus>>({})

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await apiFetch('/api/mcp/status', { signal })
      if (!res.ok) return
      const data = (await res.json()) as {
        servers: Record<string, { status: McpServerStatus; error?: string }>
      }
      setStatusMap(Object.fromEntries(Object.entries(data.servers).map(([k, v]) => [k, v.status])))
    } catch (err) {
      void err
    }
  }, [])

  const loadConfig = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await apiFetch('/api/mcp', { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as McpConfig
        setConfig(data)
        setError('')
        setStatusMap(
          Object.fromEntries(
            Object.keys(data.mcpServers).map((k) => [k, 'checking' as McpServerStatus]),
          ),
        )
        await loadStatus(signal)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    },
    [loadStatus],
  )

  const refreshConnections = useCallback(async () => {
    setRefreshing(true)
    // 1. Tell the backend to clear active connections
    send({
      type: 'execute',
      mode: 'mcp_refresh',
      input: '',
      flags: {},
    })

    // 2. Refresh the status UI
    const controller = new AbortController()
    await loadConfig(controller.signal)
    setRefreshing(false)
  }, [send, loadConfig])

  useEffect(() => {
    const controller = new AbortController()
    void loadConfig(controller.signal)
    return () => controller.abort()
  }, [loadConfig])

  async function saveServer(name: string, cfg: McpServerConfig) {
    const previousConfig: McpConfig = config
    const mergedConfig: McpConfig = { mcpServers: { ...config.mcpServers, [name]: cfg } }
    setConfig(mergedConfig)
    setFormOpen(false)
    setEditTarget(null)
    try {
      const res = await apiFetch('/api/mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Pulse-Request': '1' },
        body: JSON.stringify(mergedConfig),
      })
      if (!res.ok) {
        setConfig(previousConfig)
        setError('Save failed')
      }
    } catch (_err) {
      setConfig(previousConfig)
      setError('Network failure: Save aborted')
    }
  }

  async function deleteServer(name: string) {
    const res = await apiFetch('/api/mcp', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Pulse-Request': '1' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      setError('Delete failed')
      return
    }
    const controller = new AbortController()
    await loadConfig(controller.signal)
  }

  const servers = Object.entries(config.mcpServers)
  const existingNames = servers.map(([n]) => n)
  const formInitial: FormState =
    editTarget && config.mcpServers[editTarget]
      ? configToForm(editTarget, config.mcpServers[editTarget])
      : EMPTY_FORM

  function openAdd() {
    setEditTarget(null)
    setFormOpen(true)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="axon-toolbar flex shrink-0 items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            type="button"
            disabled={refreshing || loading}
            onClick={refreshConnections}
            className="flex items-center gap-1.5 rounded-lg border border-[rgba(175,215,255,0.1)] bg-[var(--surface-float)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)] disabled:opacity-50"
            title="Refresh and reconnect MCP servers"
          >
            <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-lg border border-[rgba(175,215,255,0.24)] bg-[linear-gradient(145deg,rgba(135,175,255,0.22),rgba(135,175,255,0.08))] px-3 py-1.5 text-[12px] font-semibold text-[var(--axon-primary-strong)] transition-colors hover:bg-[linear-gradient(145deg,rgba(135,175,255,0.3),rgba(135,175,255,0.12))]"
        >
          <Plus className="size-3.5" />
          Add Server
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {formOpen && (
          <div className="mb-6">
            <McpServerForm
              key={editTarget ?? '__new__'}
              initial={formInitial}
              existingNames={existingNames}
              isEditing={editTarget !== null}
              onSave={saveServer}
              onCancel={() => {
                setFormOpen(false)
                setEditTarget(null)
              }}
            />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="size-6 animate-spin rounded-full border-2 border-[rgba(175,215,255,0.2)] border-t-[var(--axon-primary-strong)]" />
          </div>
        ) : servers.length === 0 && !formOpen ? (
          <EmptyState onAdd={openAdd} />
        ) : (
          <div className="space-y-2">
            {servers.map(([name, cfg]) => (
              <McpServerCard
                key={name}
                name={name}
                cfg={cfg}
                status={statusMap[name] ?? 'unknown'}
                onEdit={() => {
                  setEditTarget(name)
                  setFormOpen(true)
                }}
                onDelete={() => setDeleteModal(name)}
              />
            ))}
          </div>
        )}
      </div>

      {deleteModal && (
        <DeleteConfirmModal
          name={deleteModal}
          onConfirm={() => {
            void deleteServer(deleteModal)
            setDeleteModal(null)
          }}
          onCancel={() => setDeleteModal(null)}
        />
      )}
    </div>
  )
}

export function AxonMcpPane() {
  return (
    <div className="flex h-full flex-col">
      <div className="axon-toolbar flex shrink-0 items-center gap-2 px-4 py-3">
        <McpIcon className="size-4 text-[var(--axon-primary-strong)]" />
        <span className="text-[14px] font-semibold text-[var(--text-primary)]">MCP Servers</span>
      </div>
      <ErrorBoundary>
        <McpPaneContent />
      </ErrorBoundary>
    </div>
  )
}
