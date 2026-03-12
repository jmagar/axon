'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWsMessageActions } from '@/hooks/use-ws-messages'
import { apiFetch } from '@/lib/api-fetch'
import type { AgentKind } from '@/lib/sessions/session-scanner'

export interface SessionSummary {
  id: string
  project: string
  filename: string
  mtimeMs: number
  sizeBytes: number
  preview?: string
  repo?: string
  branch?: string
  agent?: AgentKind
}

interface UseRecentSessionsOptions {
  assistantMode?: boolean
}

interface ParsedMessage {
  role: 'user' | 'assistant'
  content: string
}

interface SessionContentResponse {
  project: string
  filename: string
  sessionId: string
  messages: ParsedMessage[]
}

function dedupeSessions(list: SessionSummary[]): SessionSummary[] {
  const seen = new Map<string, SessionSummary>()
  for (const session of list) {
    const key = session.id
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, session)
      continue
    }
    if (session.mtimeMs > existing.mtimeMs) {
      seen.set(key, session)
      continue
    }
    if (session.mtimeMs === existing.mtimeMs) {
      if (existing.project === 'tmp' && session.project !== 'tmp') {
        seen.set(key, session)
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** Debounce window — consecutive reload() calls within this window are collapsed. */
const RELOAD_DEBOUNCE_MS = 300

export function useRecentSessions(options: UseRecentSessionsOptions = {}) {
  const { assistantMode = false } = options
  const { resumeWorkspaceSession } = useWsMessageActions()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  // Start true only for the initial mount load. Subsequent reloads keep
  // stale data visible (no "Loading…" flash) by not toggling isLoading.
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const hasFetchedRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Core fetch — never sets isLoading after the initial load, preserving
  // stale data in the UI while the fetch is in-flight.
  const doFetch = useCallback(async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    // Only show the loading state on the very first fetch (cold start).
    // On subsequent fetches the stale list stays visible — no flash.
    if (!hasFetchedRef.current) setIsLoading(true)
    setError(null)
    try {
      const endpoint = assistantMode ? '/api/sessions/list?assistant_mode=1' : '/api/sessions/list'
      const response = await apiFetch(endpoint, { signal: controller.signal })
      if (!mountedRef.current) return
      if (!response.ok) {
        // Keep stale data if we have it; only clear on first ever fetch
        if (!hasFetchedRef.current) setSessions([])
        setError(`Failed to load sessions (${response.status})`)
        return
      }
      const data = (await response.json()) as SessionSummary[]
      if (!mountedRef.current) return
      setSessions(Array.isArray(data) ? dedupeSessions(data) : [])
    } catch {
      if (!mountedRef.current) return
      if (!hasFetchedRef.current) setSessions([])
      setError('Failed to load sessions')
    } finally {
      clearTimeout(timeout)
      if (mountedRef.current) {
        hasFetchedRef.current = true
        setIsLoading(false)
      }
    }
  }, [assistantMode])

  // Debounced reload — collapses rapid successive calls (e.g. onTurnComplete
  // triggers both reloadSessions and reloadAssistantSessions at once).
  const reload = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void doFetch()
    }, RELOAD_DEBOUNCE_MS)
  }, [doFetch])

  // Initial fetch on mount (immediate, not debounced)
  useEffect(() => {
    mountedRef.current = true
    void doFetch()
    return () => {
      mountedRef.current = false
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [doFetch])

  const loadSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const r = await apiFetch(`/api/sessions/${id}`)
        if (!r.ok) return false
        const data = (await r.json()) as SessionContentResponse
        if (!data.sessionId) return false
        resumeWorkspaceSession(data.sessionId)
        return true
      } catch {
        return false
      }
    },
    [resumeWorkspaceSession],
  )

  return { sessions, isLoading, error, loadSession, reload }
}
