'use client'

import { useEffect, useMemo } from 'react'
import type { AxonMessage } from '@/hooks/use-axon-session'
import { apiFetch } from '@/lib/api-fetch'
import { getAcpModeConfigOption, getAcpModelConfigOption } from '@/lib/pulse/acp-config'
import type { AcpConfigOption } from '@/lib/pulse/types'
import { buildEditorMarkdown, LIVE_MESSAGES_STORAGE_KEY } from './axon-shell-state-helpers'
import { AXON_PERMISSION_OPTIONS } from './axon-ui-config'
import { mergeHistoricalMessages, shouldSyncHistoricalMessages } from './live-message-sync'

export function useHydrateLiveMessages(
  setLiveMessages: (messages: AxonMessage[]) => void,
  setLiveMessagesHydrated: (value: boolean) => void,
) {
  useEffect(() => {
    let timer: number | null = null
    try {
      const raw = window.sessionStorage.getItem(LIVE_MESSAGES_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { messages?: AxonMessage[] }
      if (Array.isArray(parsed.messages)) {
        setLiveMessages(parsed.messages)
      }
    } catch {
      // Ignore malformed cached messages.
    }
    timer = window.setTimeout(() => setLiveMessagesHydrated(true), 0)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [setLiveMessages, setLiveMessagesHydrated])
}

export function useSyncHistoricalLiveMessages({
  chatSessionId,
  historicalMessages,
  liveMessagesCount,
  liveMessagesHydrated,
  sessionLoading,
  sessionError,
  isStreamingRef,
  lastSyncedSessionIdRef,
  setLiveMessages,
}: {
  chatSessionId: string | null
  historicalMessages: AxonMessage[]
  liveMessagesCount: number
  liveMessagesHydrated: boolean
  sessionLoading: boolean
  sessionError: string | null
  isStreamingRef: React.MutableRefObject<boolean>
  lastSyncedSessionIdRef: React.MutableRefObject<string | null>
  setLiveMessages: (updater: ((prev: AxonMessage[]) => AxonMessage[]) | AxonMessage[]) => void
}) {
  useEffect(() => {
    if (!liveMessagesHydrated) return
    const sessionChanged = lastSyncedSessionIdRef.current !== chatSessionId
    if (sessionChanged && !isStreamingRef.current && !sessionLoading && !sessionError) {
      setLiveMessages(historicalMessages)
      lastSyncedSessionIdRef.current = chatSessionId
      return
    }
    const shouldSync = shouldSyncHistoricalMessages({
      isStreaming: isStreamingRef.current,
      sessionLoading,
      sessionError,
      sessionChanged,
      historicalCount: historicalMessages.length,
      liveCount: liveMessagesCount,
    })
    if (!shouldSync) return
    setLiveMessages((prev) => mergeHistoricalMessages(historicalMessages, prev))
    lastSyncedSessionIdRef.current = chatSessionId
  }, [
    chatSessionId,
    historicalMessages,
    isStreamingRef,
    lastSyncedSessionIdRef,
    liveMessagesCount,
    liveMessagesHydrated,
    sessionError,
    sessionLoading,
    setLiveMessages,
  ])
}

export function usePersistLiveMessages({
  chatSessionId,
  connected,
  liveMessages,
  liveMessagesHydrated,
}: {
  chatSessionId: string | null
  connected: boolean
  liveMessages: AxonMessage[]
  liveMessagesHydrated: boolean
}) {
  useEffect(() => {
    if (!liveMessagesHydrated) return
    if (!connected && chatSessionId === null && liveMessages.length === 0) return
    if (chatSessionId === null && liveMessages.length === 0) {
      try {
        const existingRaw = window.sessionStorage.getItem(LIVE_MESSAGES_STORAGE_KEY)
        if (existingRaw) {
          const existing = JSON.parse(existingRaw) as { messages?: AxonMessage[] }
          if (Array.isArray(existing.messages) && existing.messages.length > 0) return
        }
      } catch {
        // Ignore malformed cache and continue writing.
      }
    }
    const payload = { messages: liveMessages.slice(-200) }
    try {
      window.sessionStorage.setItem(LIVE_MESSAGES_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Ignore sessionStorage quota/private mode failures.
    }
  }, [chatSessionId, connected, liveMessages, liveMessagesHydrated])
}

export function useAcpModeOptions(
  acpConfigOptions: AcpConfigOption[],
  sessionMode: string,
  setSessionMode: (value: string) => void,
) {
  const modelOptions = useMemo(() => {
    const modelOption = getAcpModelConfigOption(acpConfigOptions)
    if (!modelOption?.options?.length) return []
    return modelOption.options.map((option) => ({ value: option.value, label: option.name }))
  }, [acpConfigOptions])

  const permissionOptions = useMemo(() => {
    const modeOption = getAcpModeConfigOption(acpConfigOptions)
    if (!modeOption?.options?.length) {
      return AXON_PERMISSION_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
    }
    return modeOption.options.map((option) => ({ value: option.value, label: option.name }))
  }, [acpConfigOptions])

  useEffect(() => {
    if (permissionOptions.length === 0) return
    if (!permissionOptions.some((opt) => opt.value === sessionMode)) {
      setSessionMode(permissionOptions[0]?.value ?? '')
    }
  }, [permissionOptions, sessionMode, setSessionMode])

  return { modelOptions, permissionOptions }
}

export function useLoadEditorFile(activeFile: string, setEditorMarkdown: (value: string) => void) {
  useEffect(() => {
    if (!activeFile) return
    let cancelled = false
    apiFetch(`/api/workspace?action=read&path=${encodeURIComponent(activeFile)}`)
      .then(async (res) => {
        const data = (await res.json()) as { type?: string; content?: string }
        if (cancelled) return
        if (data.type === 'text' && typeof data.content === 'string') {
          if (activeFile.endsWith('.md') || activeFile.endsWith('.mdx')) {
            setEditorMarkdown(data.content)
          } else {
            const language = activeFile.split('.').at(-1) ?? 'text'
            setEditorMarkdown(`# ${activeFile}\n\n\`\`\`${language}\n${data.content}\n\`\`\`\n`)
          }
        } else {
          setEditorMarkdown(buildEditorMarkdown(activeFile))
        }
      })
      .catch(() => {
        if (!cancelled) setEditorMarkdown(buildEditorMarkdown(activeFile))
      })
    return () => {
      cancelled = true
    }
  }, [activeFile, setEditorMarkdown])
}
