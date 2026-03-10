'use client'

import { Network, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import {
  configToForm,
  EMPTY_FORM,
  type FormState,
  type McpConfig,
  McpServerCard,
  type McpServerConfig,
  McpServerForm,
  type McpServerStatus,
} from './mcp/components'

export function McpSection() {
  const [config, setConfig] = useState<McpConfig>({ mcpServers: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ name: string } | null>(null)
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
        void loadStatus(signal)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    },
    [loadStatus],
  )

  useEffect(() => {
    const controller = new AbortController()
    void loadConfig(controller.signal)
    return () => controller.abort()
  }, [loadConfig])

  async function saveServer(name: string, cfg: McpServerConfig) {
    let previousConfig: McpConfig = { mcpServers: {} }
    let mergedConfig: McpConfig = { mcpServers: {} }
    setConfig((prev) => {
      previousConfig = prev
      mergedConfig = { mcpServers: { ...prev.mcpServers, [name]: cfg } }
      return mergedConfig
    })
    setFormOpen(false)
    setEditTarget(null)
    const res = await apiFetch('/api/mcp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Pulse-Request': '1' },
      body: JSON.stringify(mergedConfig),
    })
    if (!res.ok) {
      setConfig(previousConfig)
      setError('Save failed')
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

  function openAdd() {
    setEditTarget(null)
    setFormOpen(true)
  }

  function openEdit(name: string) {
    setEditTarget(name)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditTarget(null)
  }

  const servers = Object.entries(config.mcpServers)
  const existingNames = servers.map(([n]) => n)

  const formInitial: FormState =
    editTarget && config.mcpServers[editTarget]
      ? configToForm(editTarget, config.mcpServers[editTarget])
      : EMPTY_FORM

  return (
    <>
      {error && (
        <div className="mb-4 rounded-xl border border-[rgba(255,80,80,0.2)] bg-[rgba(255,80,80,0.08)] px-4 py-3 text-[13px] text-red-400">
          {error}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] text-[var(--text-dim)]">
          MCP servers extend Claude&apos;s capabilities with external tools, APIs, and data sources.
        </p>
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-lg border border-[rgba(175,215,255,0.18)] bg-[rgba(175,215,255,0.07)] px-3 py-1.5 text-[12px] font-semibold text-[var(--axon-primary-strong)] transition-colors hover:bg-[rgba(175,215,255,0.13)]"
        >
          <Plus className="size-3.5" />
          Add Server
        </button>
      </div>

      {formOpen && (
        <div className="mb-6">
          <McpServerForm
            key={editTarget ?? '__new__'}
            initial={formInitial}
            existingNames={existingNames}
            isEditing={editTarget !== null}
            onSave={saveServer}
            onCancel={closeForm}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="size-6 animate-spin rounded-full border-2 border-[rgba(175,215,255,0.2)] border-t-[var(--axon-primary-strong)]" />
        </div>
      ) : servers.length === 0 && !formOpen ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-float)] p-8 text-center animate-fade-in">
          <div className="relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(135,175,255,0.15),transparent)] blur-xl" />
            <Network className="relative size-8 text-[var(--axon-primary)]" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-sm font-semibold text-[var(--text-primary)]">
              No MCP servers configured
            </h3>
            <p className="max-w-xs text-xs leading-relaxed text-[var(--text-muted)]">
              Add your first server to extend Claude&apos;s capabilities.
            </p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="mt-1 flex items-center gap-1.5 rounded-lg border border-[var(--border-standard)] bg-[rgba(135,175,255,0.15)] px-4 py-2 text-[12px] font-semibold text-[var(--axon-primary)] transition-colors hover:bg-[rgba(135,175,255,0.25)]"
          >
            <Plus className="size-3.5" />
            Add your first server
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map(([name, cfg]) => (
            <McpServerCard
              key={name}
              name={name}
              cfg={cfg}
              status={statusMap[name] ?? 'unknown'}
              onEdit={() => openEdit(name)}
              onDelete={() => setDeleteModal({ name })}
            />
          ))}
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,7,18,0.75)] backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border-standard)] bg-[var(--surface-base)] p-5 shadow-[var(--shadow-xl)] animate-scale-in">
            <div className="mb-1 flex items-center gap-2">
              <Trash2 className="size-4 text-[var(--axon-secondary)]" />
              <h3 className="font-display text-sm font-semibold text-[var(--text-primary)]">
                Delete &ldquo;{deleteModal.name}&rdquo;?
              </h3>
            </div>
            <p className="mb-4 text-xs text-[var(--text-muted)]">
              This MCP server configuration will be permanently removed. You can add it back later.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModal(null)}
                className="rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-float)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteServer(deleteModal.name)
                  setDeleteModal(null)
                }}
                className="rounded-md bg-[rgba(255,135,175,0.15)] border border-[var(--border-accent)] px-3 py-1.5 text-xs text-[var(--axon-secondary)] hover:bg-[rgba(255,135,175,0.25)] transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
