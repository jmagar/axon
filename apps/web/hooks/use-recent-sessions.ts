'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWsMessageActions } from '@/hooks/use-ws-messages'
import { apiFetch } from '@/lib/api-fetch'

export interface SessionSummary {
  id: string
  project: string
  filename: string
  mtimeMs: number
  sizeBytes: number
  preview?: string
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

export function useRecentSessions() {
  const { resumeWorkspaceSession } = useWsMessageActions()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/sessions/list')
      .then((r) => r.json() as Promise<SessionSummary[]>)
      .then((data) => {
        if (!cancelled) setSessions(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setSessions([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadSession = useCallback(
    async (id: string): Promise<boolean> => {
      const r = await apiFetch(`/api/sessions/${id}`)
      if (!r.ok) return false
      const data = (await r.json()) as SessionContentResponse
      if (!data.sessionId) return false
      resumeWorkspaceSession(data.sessionId)
      return true
    },
    [resumeWorkspaceSession],
  )

  return { sessions, isLoading, loadSession }
}
