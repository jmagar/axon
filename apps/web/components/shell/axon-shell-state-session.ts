'use client'

import { useCallback } from 'react'
import { useAxonSession } from '@/hooks/use-axon-session'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useShellStore } from '@/lib/shell-store'

export function useAxonShellSession(railMode: string) {
  const activeSessionId = useShellStore((s) => s.activeSessionId)
  const activeAssistantSessionId = useShellStore((s) => s.activeAssistantSessionId)
  const setActiveSessionId = useShellStore((s) => s.setActiveSessionId)
  const setActiveAssistantSessionId = useShellStore((s) => s.setActiveAssistantSessionId)

  const isAssistantMode = railMode === 'assistant'

  const { sessions: rawSessions, reload: reloadSessions } = useRecentSessions()
  // Only fetch assistant sessions when the user is actually in assistant mode.
  // The hook is always called (React hook rule) but skips the API request when disabled.
  const { sessions: assistantSessions, reload: reloadAssistantSessions } = useRecentSessions({
    assistantMode: true,
    enabled: isAssistantMode,
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
    [railMode, setActiveAssistantSessionId, setActiveSessionId],
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
