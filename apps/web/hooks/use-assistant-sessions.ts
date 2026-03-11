'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SessionSummary } from '@/hooks/use-recent-sessions'
import { apiFetch } from '@/lib/api-fetch'

export function useAssistantSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch('/api/assistant/sessions')
      if (!res.ok) {
        setSessions([])
        return
      }
      const data = (await res.json()) as SessionSummary[]
      setSessions(Array.isArray(data) ? data : [])
    } catch {
      setSessions([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { sessions, reload }
}
