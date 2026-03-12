'use client'

import { useCallback, useState } from 'react'
import { useAxonSession } from '@/hooks/use-axon-session'
import { useRecentSessions } from '@/hooks/use-recent-sessions'

export function useAxonShellSession(railMode: string) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeAssistantSessionId, setActiveAssistantSessionId] = useState<string | null>(null)

  const { sessions: rawSessions, reload: reloadSessions } = useRecentSessions()
  const { sessions: assistantSessions, reload: reloadAssistantSessions } = useRecentSessions({
    assistantMode: true,
  })

  const chatSessionId = railMode === 'assistant' ? activeAssistantSessionId : activeSessionId

  const {
    messages: historicalMessages,
    loading: sessionLoadingBase,
    loaded: sessionLoaded,
    error: sessionError,
    reload: reloadSession,
  } = useAxonSession(chatSessionId, { assistantMode: railMode === 'assistant' })

  const sessionLoading = sessionLoadingBase || (chatSessionId !== null && !sessionLoaded)

  const onSessionIdChange = useCallback(
    (newId: string) => {
      if (railMode === 'assistant') {
        setActiveAssistantSessionId(newId)
        return
      }
      setActiveSessionId(newId)
    },
    [railMode],
  )

  return {
    activeSessionId,
    setActiveSessionId,
    activeAssistantSessionId,
    setActiveAssistantSessionId,
    chatSessionId,
    historicalMessages,
    sessionLoading,
    sessionError,
    reloadSession,
    rawSessions,
    reloadSessions,
    assistantSessions,
    reloadAssistantSessions,
    onSessionIdChange,
  }
}
