'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PromptInputFile } from '@/components/ai-elements/prompt-input'
import type { NeuralCanvasHandle } from '@/components/neural-canvas'
import { useAxonAcp } from '@/hooks/use-axon-acp'
import type { AxonMessage } from '@/hooks/use-axon-session'
import { useAxonSession } from '@/hooks/use-axon-session'
import { useAxonWs } from '@/hooks/use-axon-ws'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { useMcpServers } from '@/hooks/use-mcp-servers'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useWorkspaceFiles } from '@/hooks/use-workspace-files'
import { useWsMessageActions, useWsWorkspaceState } from '@/hooks/use-ws-messages'
import { apiFetch } from '@/lib/api-fetch'
import { getAcpModeConfigOption, getAcpModelConfigOption } from '@/lib/pulse/acp-config'
import { persistToolPreferences, TOOL_PREFERENCES_LS_KEY } from '@/lib/shell/tool-preferences'
import type { ContainerStats, WsServerMsg } from '@/lib/ws-protocol'
import { useAxonShellActions } from './axon-shell-state-actions'
import {
  AXON_MOBILE_PANE_STORAGE_KEY,
  type AxonMobilePane,
  agentDisplayName,
  buildEditorMarkdown,
  LIVE_MESSAGES_STORAGE_KEY,
  RIGHT_PANE_STORAGE_KEY,
  type RightPane,
  shouldReloadSessionOnTurnComplete,
} from './axon-shell-state-helpers'
import { useAxonShellLayoutControls } from './axon-shell-state-layout'
import { useToolPreferenceState } from './axon-shell-state-tools'
import { AXON_PERMISSION_OPTIONS } from './axon-ui-config'
import { mergeHistoricalMessages, shouldSyncHistoricalMessages } from './live-message-sync'

export type { AxonMobilePane, RightPane }
export { PANE_WIDTH_MIN, shouldReloadSessionOnTurnComplete } from './axon-shell-state-helpers'

export function useAxonShellState() {
  const { pulseModel, pulsePermissionLevel, acpConfigOptions, pulseAgent } = useWsWorkspaceState()
  const { setPulseModel, setPulsePermissionLevel, setPulseAgent, setAcpConfigOptions } =
    useWsMessageActions()
  const { copiedId, copy: copyMessage } = useCopyFeedback()
  const mcp = useMcpServers()
  const workspace = useWorkspaceFiles()
  const layout = useAxonShellLayoutControls()

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeAssistantSessionId, setActiveAssistantSessionId] = useState<string | null>(null)
  const [railQuery, setRailQuery] = useState('')
  const [sessionKey, setSessionKey] = useState(0)
  const [liveMessages, setLiveMessages] = useState<AxonMessage[]>([])
  const [liveMessagesHydrated, setLiveMessagesHydrated] = useState(false)
  const [pendingHandoffContext, setPendingHandoffContext] = useState<string | null>(null)
  const [sessionMode, setSessionMode] = useState<string>(pulsePermissionLevel)
  const [activeFile, setActiveFile] = useState('')
  const [editorMarkdown, setEditorMarkdown] = useState('# New document\n')
  const [composerFiles, setComposerFiles] = useState<PromptInputFile[]>([])
  const canvasRef = useRef<NeuralCanvasHandle>(null)

  const { sessions: rawSessions, reload: reloadSessions } = useRecentSessions()
  const { sessions: assistantSessions, reload: reloadAssistantSessions } = useRecentSessions({
    assistantMode: true,
  })
  const chatSessionId = layout.railMode === 'assistant' ? activeAssistantSessionId : activeSessionId

  const {
    messages: historicalMessages,
    loading: sessionLoadingBase,
    loaded: sessionLoaded,
    error: sessionError,
    reload: reloadSession,
  } = useAxonSession(chatSessionId, { assistantMode: layout.railMode === 'assistant' })

  const sessionLoading = sessionLoadingBase || (chatSessionId !== null && !sessionLoaded)

  const {
    enabledMcpTools,
    handleCommandsUpdate,
    mcpToolsByServer,
    setEnabledMcpTools,
    setToolPresets,
    toolPrefsHydrated,
    toolPresets,
  } = useToolPreferenceState({
    mcpServerCount: mcp.mcpServers.length,
    setEnabledMcpServers: mcp.setEnabledMcpServers,
  })

  const effectiveEnabledMcpTools = useMemo(() => {
    const knownTools = Object.values(mcpToolsByServer).flat()
    if (enabledMcpTools === null) return knownTools
    return enabledMcpTools
  }, [enabledMcpTools, mcpToolsByServer])

  const blockedMcpTools = useMemo(() => {
    const blocked = new Set<string>()
    for (const [serverName, tools] of Object.entries(mcpToolsByServer)) {
      const serverEnabled = mcp.enabledMcpServers.includes(serverName)
      for (const toolName of tools) {
        if (!serverEnabled || !effectiveEnabledMcpTools.includes(toolName)) {
          blocked.add(toolName)
        }
      }
    }
    return Array.from(blocked)
  }, [effectiveEnabledMcpTools, mcp.enabledMcpServers, mcpToolsByServer])

  const onSessionIdChange = useCallback(
    (newId: string) => {
      if (layout.railMode === 'assistant') {
        setActiveAssistantSessionId(newId)
        return
      }
      setActiveSessionId(newId)
    },
    [layout.railMode],
  )

  const onMessagesChange = useCallback((updater: (prev: AxonMessage[]) => AxonMessage[]) => {
    setLiveMessages(updater)
  }, [])

  useEffect(() => {
    let timer: number | null = null
    try {
      const raw = window.sessionStorage.getItem(LIVE_MESSAGES_STORAGE_KEY)
      if (!raw) {
        setLiveMessagesHydrated(true)
        return
      }
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
  }, [])

  const onTurnComplete = useCallback(() => {
    reloadSessions()
    if (shouldReloadSessionOnTurnComplete(chatSessionId)) {
      reloadSession()
    }
    if (layout.railMode === 'assistant') {
      reloadAssistantSessions()
    }
  }, [reloadSessions, chatSessionId, reloadSession, layout.railMode, reloadAssistantSessions])

  const onEditorUpdate = useCallback(
    (content: string, operation: 'replace' | 'append') => {
      setEditorMarkdown((prev) => (operation === 'append' ? `${prev}\n${content}` : content))
      layout.persistRightPane('editor')
      try {
        window.localStorage.setItem(RIGHT_PANE_STORAGE_KEY, 'editor')
      } catch {
        /* ignore */
      }
      layout.setMobilePaneTracked('editor')
      try {
        window.localStorage.setItem(AXON_MOBILE_PANE_STORAGE_KEY, 'editor')
      } catch {
        /* ignore */
      }
    },
    [layout],
  )

  const { submitPrompt, isStreaming, connected } = useAxonAcp({
    activeSessionId: chatSessionId,
    agent: pulseAgent ?? 'claude',
    model: pulseModel,
    sessionMode,
    enabledMcpServers: mcp.enabledMcpServers,
    blockedMcpTools,
    assistantMode: layout.railMode === 'assistant',
    handoffContext: pendingHandoffContext,
    onSessionIdChange,
    onSessionFallback: undefined,
    onMessagesChange,
    onAcpConfigOptionsUpdate: setAcpConfigOptions,
    onCommandsUpdate: handleCommandsUpdate,
    onHandoffConsumed: () => setPendingHandoffContext(null),
    onTurnComplete,
    onEditorUpdate,
  })

  const isStreamingRef = useRef(false)
  const lastSyncedSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  const { subscribe: subscribeWs } = useAxonWs()
  useEffect(() => {
    return subscribeWs((msg: WsServerMsg) => {
      if (msg.type === 'command.done' || msg.type === 'command.error') {
        canvasRef.current?.setIntensity(0.15)
        setTimeout(() => canvasRef.current?.setIntensity(0), 3000)
      }
    })
  }, [subscribeWs])

  useEffect(() => {
    if (isStreaming) {
      canvasRef.current?.setIntensity(1)
    }
  }, [isStreaming])

  const handleStats = useCallback(
    (data: {
      aggregate: { cpu_percent: number }
      containers: Record<string, ContainerStats>
      container_count: number
    }) => {
      canvasRef.current?.stimulate(data.containers)
      if (!isStreamingRef.current) {
        const maxCpu = data.container_count * 100
        const norm = Math.min(data.aggregate.cpu_percent / maxCpu, 1)
        canvasRef.current?.setIntensity(0.02 + norm * 0.83)
      }
    },
    [],
  )

  useEffect(() => {
    if (!toolPrefsHydrated) return
    const payload = {
      enabledMcpServers: mcp.enabledMcpServers,
      enabledMcpTools: effectiveEnabledMcpTools,
      presets: toolPresets,
    }
    try {
      window.localStorage.setItem(TOOL_PREFERENCES_LS_KEY, JSON.stringify(payload))
    } catch {
      // Ignore localStorage write failures.
    }
    const timer = setTimeout(() => {
      void persistToolPreferences(payload)
    }, 350)
    return () => clearTimeout(timer)
  }, [effectiveEnabledMcpTools, mcp.enabledMcpServers, toolPrefsHydrated, toolPresets])

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
      liveCount: liveMessages.length,
    })
    if (!shouldSync) return
    setLiveMessages((prev) => mergeHistoricalMessages(historicalMessages, prev))
    lastSyncedSessionIdRef.current = chatSessionId
  }, [
    chatSessionId,
    historicalMessages,
    liveMessages.length,
    liveMessagesHydrated,
    sessionLoading,
    sessionError,
  ])

  const activeSession = useMemo(() => {
    if (layout.railMode === 'assistant') {
      return assistantSessions.find((s) => s.id === activeAssistantSessionId) ?? null
    }
    return rawSessions.find((s) => s.id === activeSessionId) ?? null
  }, [layout.railMode, assistantSessions, activeAssistantSessionId, rawSessions, activeSessionId])

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
  }, [permissionOptions, sessionMode])

  // biome-ignore lint/correctness/useExhaustiveDependencies: railMode is intentional trigger
  useEffect(() => {
    setRailQuery('')
  }, [layout.railMode])

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
  }, [activeFile])

  const {
    composerProps,
    handleEditMessage,
    handleMobileFileSelect,
    handleMobileNewSession,
    handleMobileOpenFile,
    handleMobileSelectSession,
    handleRetryMessage,
    handleSelectSession,
    handleSidebarFileSelect,
    openFile,
    sidebarProps,
  } = useAxonShellActions({
    activeAssistantSessionId,
    activeSessionId,
    activeSessionRepo: activeSession?.project ?? '',
    assistantSessions,
    composerFiles,
    connected,
    effectiveEnabledMcpTools,
    isStreaming,
    liveMessages,
    mcp: {
      enabledMcpServers: mcp.enabledMcpServers,
      mcpServers: mcp.mcpServers,
      mcpStatusByServer: mcp.mcpStatusByServer,
      setEnabledMcpServers: mcp.setEnabledMcpServers,
      toggleMcpServer: mcp.toggleMcpServer,
    },
    mcpToolsByServer,
    modelOptions,
    permissionOptions,
    pulseAgent,
    pulseModel,
    railMode: layout.railMode,
    railQuery,
    sessions: rawSessions,
    sessionMode,
    setActiveAssistantSessionId,
    setActiveFile,
    setActiveSessionId,
    setComposerFiles,
    setEnabledMcpTools,
    setLiveMessages,
    setPendingHandoffContext,
    setPulseAgent,
    setPulseModel,
    setPulsePermissionLevel,
    setRailModeTracked: layout.setRailModeTracked,
    setRailQuery,
    setSessionKey,
    setSessionMode,
    setToolPresets,
    submitPrompt,
    toolPresets,
    persistChatOpen: layout.persistChatOpen,
    persistRightPane: layout.persistRightPane,
    setMobilePaneTracked: layout.setMobilePaneTracked,
    workspace: {
      fileEntries: workspace.fileEntries,
      fileLoading: workspace.fileLoading,
      selectedFilePath: workspace.selectedFilePath,
      setSelectedFilePath: workspace.setSelectedFilePath,
    },
  })

  const displayMessages =
    chatSessionId !== null && liveMessages.length === 0 ? historicalMessages : liveMessages

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

  const chatTitle = activeSession?.preview?.slice(0, 60) ?? activeSession?.project ?? 'New chat'
  const agentLabel = agentDisplayName(pulseAgent ?? 'claude')

  return {
    agentLabel,
    canvasProfile: layout.canvasProfile,
    canvasRef,
    chatFlex: layout.chatFlex,
    chatOpen: layout.chatOpen,
    chatTitle,
    composerProps,
    connected,
    copiedId,
    copyMessage,
    displayMessages,
    editorMarkdown,
    editorOpen: layout.editorOpen,
    handleCanvasProfileChange: layout.handleCanvasProfileChange,
    handleEditMessage,
    handleMobileFileSelect,
    handleMobileNewSession,
    handleMobileOpenFile,
    handleMobileSelectSession,
    handleRetryMessage,
    handleSelectSession,
    handleSidebarFileSelect,
    handleStats,
    isDragging: layout.isDragging,
    isStreaming,
    layoutRestored: layout.layoutRestored,
    liveMessages,
    mobilePane: layout.mobilePane,
    nudgeChatFlex: layout.nudgeChatFlex,
    nudgeSidebar: layout.nudgeSidebar,
    onEditorUpdate,
    openFile,
    persistChatOpen: layout.persistChatOpen,
    persistRightPane: layout.persistRightPane,
    persistSidebarOpen: layout.persistSidebarOpen,
    railMode: layout.railMode,
    reloadSession,
    resetChatFlex: layout.resetChatFlex,
    resetSidebarWidth: layout.resetSidebarWidth,
    rightPane: layout.rightPane,
    sectionRef: layout.sectionRef,
    sessionError,
    sessionKey,
    sessionLoading,
    setEditorMarkdown,
    setMobilePaneTracked: layout.setMobilePaneTracked,
    setRailModeTracked: layout.setRailModeTracked,
    sidebarOpen: layout.sidebarOpen,
    sidebarProps,
    sidebarWidth: layout.sidebarWidth,
    startChatResize: layout.startChatResize,
    startSidebarResize: layout.startSidebarResize,
    transitionClass: layout.transitionClass,
  }
}
