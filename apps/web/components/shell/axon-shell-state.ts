'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PromptInputFile } from '@/components/ai-elements/prompt-input'
import type { NeuralCanvasHandle } from '@/components/neural-canvas'
import { useAxonAcp } from '@/hooks/use-axon-acp'
import { useAxonWs } from '@/hooks/use-axon-ws'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { useMcpServers } from '@/hooks/use-mcp-servers'
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
  RIGHT_PANE_STORAGE_KEY,
  type RightPane,
  shouldReloadSessionOnTurnComplete,
} from './axon-shell-state-helpers'
import { useAxonShellLayoutControls } from './axon-shell-state-layout'
import { useAxonShellMessages } from './axon-shell-state-messages'
import { useAxonShellSession } from './axon-shell-state-session'
import { useAxonShellSettings } from './axon-shell-state-settings'
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
  const session = useAxonShellSession(layout.railMode)
  const messages = useAxonShellMessages()
  const settings = useAxonShellSettings()

  const [railQuery, setRailQuery] = useState('')
  const [sessionKey, setSessionKey] = useState(0)
  const [pendingHandoffContext, setPendingHandoffContext] = useState<string | null>(null)
  const [sessionMode, setSessionMode] = useState<string>(pulsePermissionLevel)
  const [activeFile, setActiveFile] = useState('')
  const [editorMarkdown, setEditorMarkdown] = useState('# New document\n')
  const [composerFiles, setComposerFiles] = useState<PromptInputFile[]>([])
  const canvasRef = useRef<NeuralCanvasHandle>(null)

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
    const enabledSet = new Set(effectiveEnabledMcpTools)
    const enabledServersSet = new Set(mcp.enabledMcpServers)
    const blocked = new Set<string>()
    for (const [serverName, tools] of Object.entries(mcpToolsByServer)) {
      const serverEnabled = enabledServersSet.has(serverName)
      for (const toolName of tools) {
        if (!serverEnabled || !enabledSet.has(toolName)) {
          blocked.add(toolName)
        }
      }
    }
    return Array.from(blocked)
  }, [effectiveEnabledMcpTools, mcp.enabledMcpServers, mcpToolsByServer])

  const onTurnComplete = useCallback(() => {
    session.reloadSessions()
    if (shouldReloadSessionOnTurnComplete(session.chatSessionId)) {
      session.reloadSession()
    }
    if (layout.railMode === 'assistant') {
      session.reloadAssistantSessions()
    }
  }, [session, layout.railMode])

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
    activeSessionId: session.chatSessionId,
    agent: pulseAgent ?? 'claude',
    model: pulseModel,
    sessionMode,
    enabledMcpServers: mcp.enabledMcpServers,
    blockedMcpTools,
    assistantMode: layout.railMode === 'assistant',
    handoffContext: pendingHandoffContext,
    onSessionIdChange: session.onSessionIdChange,
    onSessionFallback: undefined,
    onMessagesChange: messages.onMessagesChange,
    onAcpConfigOptionsUpdate: setAcpConfigOptions,
    onCommandsUpdate: handleCommandsUpdate,
    onHandoffConsumed: () => setPendingHandoffContext(null),
    onTurnComplete,
    onEditorUpdate,
    enableFs: settings.enableFs,
    enableTerminal: settings.enableTerminal,
    permissionTimeoutSecs: settings.permissionTimeoutSecs,
    adapterTimeoutSecs: settings.adapterTimeoutSecs,
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
    if (!messages.liveMessagesHydrated) return
    const sessionChanged = lastSyncedSessionIdRef.current !== session.chatSessionId
    if (
      sessionChanged &&
      !isStreamingRef.current &&
      !session.sessionLoading &&
      !session.sessionError
    ) {
      messages.setLiveMessages(session.historicalMessages)
      lastSyncedSessionIdRef.current = session.chatSessionId
      return
    }
    const shouldSync = shouldSyncHistoricalMessages({
      isStreaming: isStreamingRef.current,
      sessionLoading: session.sessionLoading,
      sessionError: session.sessionError,
      sessionChanged,
      historicalCount: session.historicalMessages.length,
      liveCount: messages.liveMessages.length,
    })
    if (!shouldSync) return
    messages.setLiveMessages((prev) => mergeHistoricalMessages(session.historicalMessages, prev))
    lastSyncedSessionIdRef.current = session.chatSessionId
  }, [
    session.chatSessionId,
    session.historicalMessages,
    messages.liveMessages.length,
    messages.liveMessagesHydrated,
    session.sessionLoading,
    session.sessionError,
  ])

  const activeSession = useMemo(() => {
    if (layout.railMode === 'assistant') {
      return (
        session.assistantSessions.find((s) => s.id === session.activeAssistantSessionId) ?? null
      )
    }
    return session.rawSessions.find((s) => s.id === session.activeSessionId) ?? null
  }, [
    layout.railMode,
    session.assistantSessions,
    session.activeAssistantSessionId,
    session.rawSessions,
    session.activeSessionId,
  ])

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
    activeAssistantSessionId: session.activeAssistantSessionId,
    activeSessionId: session.activeSessionId,
    activeSessionRepo: activeSession?.project ?? '',
    assistantSessions: session.assistantSessions,
    composerFiles,
    connected,
    effectiveEnabledMcpTools,
    isStreaming,
    liveMessages: messages.liveMessages,
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
    sessions: session.rawSessions,
    sessionMode,
    setActiveAssistantSessionId: session.setActiveAssistantSessionId,
    setActiveFile,
    setActiveSessionId: session.setActiveSessionId,
    setComposerFiles,
    setEnabledMcpTools,
    setLiveMessages: messages.setLiveMessages,
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
    session.chatSessionId !== null && messages.liveMessages.length === 0
      ? session.historicalMessages
      : messages.liveMessages

  useEffect(() => {
    if (!messages.liveMessagesHydrated) return
    messages.persistMessages(connected, session.chatSessionId, messages.liveMessages)
  }, [session.chatSessionId, connected, messages])

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
    liveMessages: messages.liveMessages,
    mobilePane: layout.mobilePane,
    nudgeChatFlex: layout.nudgeChatFlex,
    nudgeSidebar: layout.nudgeSidebar,
    onEditorUpdate,
    openFile,
    persistChatOpen: layout.persistChatOpen,
    persistRightPane: layout.persistRightPane,
    persistSidebarOpen: layout.persistSidebarOpen,
    railMode: layout.railMode,
    reloadSession: session.reloadSession,
    resetChatFlex: layout.resetChatFlex,
    resetSidebarWidth: layout.resetSidebarWidth,
    rightPane: layout.rightPane,
    sectionRef: layout.sectionRef,
    sessionError: session.sessionError,
    sessionKey,
    sessionLoading: session.sessionLoading,
    setEditorMarkdown,
    setMobilePaneTracked: layout.setMobilePaneTracked,
    setRailModeTracked: layout.setRailModeTracked,
    sidebarOpen: layout.sidebarOpen,
    sidebarProps,
    sidebarWidth: layout.sidebarWidth,
    startChatResize: layout.startChatResize,
    startSidebarResize: layout.startSidebarResize,
    transitionClass: layout.transitionClass,
    density: layout.density,
    setDensityTracked: layout.setDensityTracked,
    enableFs: settings.enableFs,
    setEnableFs: settings.setEnableFs,
    enableTerminal: settings.enableTerminal,
    setEnableTerminal: settings.setEnableTerminal,
    permissionTimeoutSecs: settings.permissionTimeoutSecs,
    setPermissionTimeoutSecs: settings.setPermissionTimeoutSecs,
    adapterTimeoutSecs: settings.adapterTimeoutSecs,
    setAdapterTimeoutSecs: settings.setAdapterTimeoutSecs,
  }
}
