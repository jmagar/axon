'use client'

import {
  Brain,
  MessageSquareText,
  PanelLeft,
  PanelRight,
  ScrollText,
  Settings2,
  TerminalSquare,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Conversation, ConversationScrollButton } from '@/components/ai-elements/conversation'
import type { PromptInputFile, PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { DockerStats } from '@/components/docker-stats'
import type { NeuralCanvasHandle } from '@/components/neural-canvas'
import { Button } from '@/components/ui/button'
import type { FileEntry } from '@/components/workspace/file-tree'
import { useAssistantSessions } from '@/hooks/use-assistant-sessions'
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
import {
  DEFAULT_NEURAL_CANVAS_PROFILE,
  type NeuralCanvasProfile,
} from '@/lib/pulse/neural-canvas-presets'
import type { PulseAgent } from '@/lib/pulse/types'
import {
  fetchToolPreferences,
  persistToolPreferences,
  TOOL_PREFERENCES_LS_KEY,
  type ToolPreset,
} from '@/lib/reboot/tool-preferences'
import { getStorageItem, setStorageItem } from '@/lib/storage'
import type { ContainerStats, WsServerMsg } from '@/lib/ws-protocol'
import { AxonCortexPane } from './axon-cortex-pane'
import { AxonFrame } from './axon-frame'
import { AxonLogsPane } from './axon-logs-pane'
import { AxonMcpPane } from './axon-mcp-pane'
import { AxonMessageList } from './axon-message-list'
import { AxonMobilePaneSwitcher } from './axon-mobile-pane-switcher'
import { AxonPaneHandle } from './axon-pane-handle'
import { AxonPromptComposer } from './axon-prompt-composer'
import { AxonSettingsPane } from './axon-settings-pane'
import { AxonSidebar } from './axon-sidebar'
import { AxonTerminalPane } from './axon-terminal-pane'
import { AXON_PERMISSION_OPTIONS, RAIL_MODES, type RailMode } from './axon-ui-config'
import { shouldSyncHistoricalMessages } from './live-message-sync'
import { McpIcon } from './mcp-config'

const EditorPane = dynamic(
  () => import('@/components/editor/editor-pane').then((m) => ({ default: m.PulseEditorPane })),
  { ssr: false },
)

type RightPane = 'editor' | 'terminal' | 'logs' | 'mcp' | 'settings' | 'cortex' | null
const VALID_RIGHT_PANES = new Set<string>([
  'editor',
  'terminal',
  'logs',
  'mcp',
  'settings',
  'cortex',
])

type AxonMobilePane =
  | 'sidebar'
  | 'chat'
  | 'editor'
  | 'terminal'
  | 'logs'
  | 'mcp'
  | 'settings'
  | 'cortex'
const AXON_MOBILE_PANE_STORAGE_KEY = 'axon.web.reboot.mobile-pane'
const SIDEBAR_WIDTH_STORAGE_KEY = 'axon.web.reboot.sidebar-width'
const CHAT_FLEX_STORAGE_KEY = 'axon.web.reboot.chat-flex'
const SIDEBAR_OPEN_STORAGE_KEY = 'axon.web.reboot.sidebar-open'
const CHAT_OPEN_STORAGE_KEY = 'axon.web.reboot.chat-open'
const RIGHT_PANE_STORAGE_KEY = 'axon.web.reboot.right-pane'
const RAIL_MODE_STORAGE_KEY = 'axon.web.reboot.rail-mode'
const CANVAS_PROFILE_STORAGE_KEY = 'axon.web.neural-canvas.profile'
const LIVE_MESSAGES_STORAGE_KEY = 'axon.web.reboot.live-messages.v1'
const SIDEBAR_WIDTH_DEFAULT = 260
const SIDEBAR_WIDTH_MIN = 180
const SIDEBAR_WIDTH_MAX = 520
const PANE_WIDTH_MIN = 240

function readStoredFloat(key: string, fallback: number, min?: number, max?: number): number {
  try {
    const n = Number(window.localStorage.getItem(key))
    if (!Number.isFinite(n) || n <= 0) return fallback
    if (min !== undefined && max !== undefined) return Math.max(min, Math.min(max, n))
    return n
  } catch {
    return fallback
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

function readStoredRailMode(key: string, fallback: RailMode): RailMode {
  try {
    const v = window.localStorage.getItem(key)
    if (v === 'sessions' || v === 'files' || v === 'assistant') return v
    return fallback
  } catch {
    return fallback
  }
}

function ResizeDivider({
  onDragStart,
  onReset,
  onNudge,
}: {
  onDragStart: (startX: number) => void
  onReset?: () => void
  onNudge?: (delta: number) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={0}
      title="Drag to resize · Double-click to reset · Arrow keys to nudge"
      tabIndex={0}
      className="group relative z-10 flex w-1.5 shrink-0 cursor-col-resize items-stretch focus-visible:outline-none"
      onMouseDown={(e) => {
        e.preventDefault()
        onDragStart(e.clientX)
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (!onNudge) return
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const step = e.shiftKey ? 50 : 10
        onNudge(e.key === 'ArrowRight' ? step : -step)
      }}
    >
      <div className="mx-auto h-full w-px bg-[var(--border-subtle)] transition-colors group-hover:bg-[rgba(175,215,255,0.3)] group-focus-visible:bg-[rgba(175,215,255,0.3)]" />
    </div>
  )
}

function buildEditorMarkdown(path: string) {
  if (path.endsWith('.md') || path.endsWith('.mdx')) return '# New document\n'
  const language = path.split('.').at(-1) ?? 'text'
  return `# ${path}\n\n\`\`\`${language}\n\`\`\`\n`
}

function agentDisplayName(agent: string): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1)
}

function createClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fall through to deterministic fallback for non-secure origins.
  }
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function buildAgentHandoffContext(
  messages: AxonMessage[],
  fromAgent: string,
  toAgent: string,
): string {
  const recentTurns = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.trim()}`)
  if (recentTurns.length === 0) return ''
  return [
    `Context handoff: switched active agent from ${fromAgent} to ${toAgent}.`,
    'Continue the same task with this prior chat context.',
    '',
    ...recentTurns,
  ].join('\n')
}

// New turns can complete before a session ID is assigned. In that state,
// reloading persisted session history would clear optimistic in-memory messages.
export function shouldReloadSessionOnTurnComplete(chatSessionId: string | null): boolean {
  return chatSessionId !== null
}

export function AxonShell() {
  const { pulseModel, pulsePermissionLevel, acpConfigOptions, pulseAgent } = useWsWorkspaceState()
  const { setPulseModel, setPulsePermissionLevel, setPulseAgent, setAcpConfigOptions } =
    useWsMessageActions()
  const { copiedId, copy: copyMessage } = useCopyFeedback()
  const mcp = useMcpServers()
  const workspace = useWorkspaceFiles()

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeAssistantSessionId, setActiveAssistantSessionId] = useState<string | null>(null)
  const [railMode, setRailMode] = useState<RailMode>('sessions')
  const [mobilePane, setMobilePane] = useState<AxonMobilePane>('chat')
  const [railQuery, setRailQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [rightPane, setRightPane] = useState<RightPane>('editor')
  // ↑ defaults used for SSR; localStorage overrides applied in mount effect below
  const editorOpen = rightPane !== null
  const [canvasProfile, setCanvasProfile] = useState<NeuralCanvasProfile>(
    DEFAULT_NEURAL_CANVAS_PROFILE,
  )
  const [sessionKey, setSessionKey] = useState(0)
  const [liveMessages, setLiveMessages] = useState<AxonMessage[]>([])
  const [liveMessagesHydrated, setLiveMessagesHydrated] = useState(false)
  const [pendingHandoffContext, setPendingHandoffContext] = useState<string | null>(null)
  const [sessionMode, setSessionMode] = useState<string>(pulsePermissionLevel)
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, string[]>>({})
  const [enabledMcpTools, setEnabledMcpTools] = useState<string[] | null>(null)
  const [toolPresets, setToolPresets] = useState<ToolPreset[]>([])
  const [toolPrefsHydrated, setToolPrefsHydrated] = useState(false)
  const [pendingToolPrefs, setPendingToolPrefs] = useState<{
    enabledMcpServers: string[]
    enabledMcpTools: string[]
    presets: ToolPreset[]
  } | null>(null)
  const [activeFile, setActiveFile] = useState('')
  const [editorMarkdown, setEditorMarkdown] = useState('# New document\n')
  const [composerFiles, setComposerFiles] = useState<PromptInputFile[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT)
  const [chatFlex, setChatFlex] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [layoutRestored, setLayoutRestored] = useState(false)
  const canvasRef = useRef<NeuralCanvasHandle>(null)
  const sectionRef = useRef<HTMLElement>(null)

  // Live session list from ~/.claude/projects
  const { sessions: rawSessions, reload: reloadSessions } = useRecentSessions()
  const { sessions: assistantSessions, reload: reloadAssistantSessions } = useAssistantSessions()
  const chatSessionId = railMode === 'assistant' ? activeAssistantSessionId : activeSessionId

  // Load JSONL history for the active session
  const {
    messages: historicalMessages,
    loading: sessionLoadingBase,
    loaded: sessionLoaded,
    error: sessionError,
    reload: reloadSession,
  } = useAxonSession(chatSessionId)

  // Treat as loading while the hook has not yet completed its first fetch.
  // `loaded` becomes true in `.finally()` regardless of whether messages were
  // returned, so a legitimately empty session (`messages.length === 0`) no
  // longer keeps the UI in a permanent loading state.
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

  const onMessagesChange = useCallback((updater: (prev: AxonMessage[]) => AxonMessage[]) => {
    setLiveMessages(updater)
  }, [])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TOOL_PREFERENCES_LS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        enabledMcpServers?: string[]
        enabledMcpTools?: string[]
        presets?: ToolPreset[]
      }
      setPendingToolPrefs({
        enabledMcpServers: Array.isArray(parsed.enabledMcpServers) ? parsed.enabledMcpServers : [],
        enabledMcpTools: Array.isArray(parsed.enabledMcpTools) ? parsed.enabledMcpTools : [],
        presets: Array.isArray(parsed.presets) ? parsed.presets : [],
      })
    } catch {
      // Ignore malformed local cache.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchToolPreferences().then((remote) => {
      if (cancelled || !remote) return
      setPendingToolPrefs({
        enabledMcpServers: remote.enabledMcpServers,
        enabledMcpTools: remote.enabledMcpTools,
        presets: remote.presets,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!pendingToolPrefs) return
    setEnabledMcpTools(pendingToolPrefs.enabledMcpTools)
    setToolPresets(pendingToolPrefs.presets)
    if (mcp.mcpServers.length > 0) {
      mcp.setEnabledMcpServers(pendingToolPrefs.enabledMcpServers)
    }
    setToolPrefsHydrated(true)
    setPendingToolPrefs(null)
  }, [mcp.mcpServers.length, mcp.setEnabledMcpServers, pendingToolPrefs])

  useEffect(() => {
    if (toolPrefsHydrated) return
    if (pendingToolPrefs) return
    setToolPrefsHydrated(true)
  }, [pendingToolPrefs, toolPrefsHydrated])

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
    // Defer hydration flag to avoid writing an empty snapshot before
    // restored messages are applied during the same mount cycle.
    timer = window.setTimeout(() => setLiveMessagesHydrated(true), 0)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  const handleCommandsUpdate = useCallback((commands: Array<{ name: string }>) => {
    const grouped = new Map<string, string[]>()
    for (const command of commands) {
      if (!command.name.startsWith('mcp__')) continue
      const parts = command.name.split('__')
      if (parts.length < 3) continue
      const serverName = parts[1]?.trim()
      if (!serverName) continue
      const existing = grouped.get(serverName) ?? []
      existing.push(command.name)
      grouped.set(serverName, existing)
    }
    const next = Object.fromEntries(
      Array.from(grouped.entries()).map(([serverName, tools]) => [
        serverName,
        tools.sort((a, b) => a.localeCompare(b)),
      ]),
    )
    setMcpToolsByServer(next)
    const allTools = Object.values(next).flat()
    setEnabledMcpTools((current) => {
      if (current === null) return allTools
      return current.filter((toolName) => allTools.includes(toolName))
    })
  }, [])

  const onTurnComplete = useCallback(() => {
    reloadSessions()
    // For brand-new chats, session ID is still null until the result event
    // arrives. Reloading with null forces useAxonSession to clear history,
    // which can wipe optimistic live messages from the UI.
    if (shouldReloadSessionOnTurnComplete(chatSessionId)) {
      reloadSession()
    }
    if (railMode === 'assistant') {
      reloadAssistantSessions()
    }
  }, [reloadSessions, reloadSession, reloadAssistantSessions, railMode, chatSessionId])

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

  const onEditorUpdate = useCallback((content: string, operation: 'replace' | 'append') => {
    setEditorMarkdown((prev) => (operation === 'append' ? `${prev}\n${content}` : content))
    // Ensure the editor pane is visible on desktop when the agent writes to it.
    setRightPane('editor')
    try {
      window.localStorage.setItem(RIGHT_PANE_STORAGE_KEY, 'editor')
    } catch {
      /* ignore */
    }
    // On mobile, switch to the editor pane so the content is actually visible.
    // Persist alongside so the stored value stays in sync (same logic as setMobilePaneTracked).
    setMobilePane('editor')
    try {
      window.localStorage.setItem(AXON_MOBILE_PANE_STORAGE_KEY, 'editor')
    } catch {
      /* ignore */
    }
  }, [])

  const { submitPrompt, isStreaming, connected } = useAxonAcp({
    activeSessionId: chatSessionId,
    agent: pulseAgent ?? 'claude',
    model: pulseModel,
    sessionMode,
    enabledMcpServers: mcp.enabledMcpServers,
    blockedMcpTools,
    assistantMode: railMode === 'assistant',
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

  // Ref-based streaming guard: lets the sync effect read streaming state without
  // being in its dependency array. Without this, the effect fires when isStreaming
  // goes false → overwrites live messages with stale historicalMessages.
  const isStreamingRef = useRef(false)
  const lastSyncedSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  // Canvas intensity: pulse on command done/error
  const { subscribe: subscribeWs } = useAxonWs()
  useEffect(() => {
    return subscribeWs((msg: WsServerMsg) => {
      if (msg.type === 'command.done' || msg.type === 'command.error') {
        canvasRef.current?.setIntensity(0.15)
        setTimeout(() => canvasRef.current?.setIntensity(0), 3000)
      }
    })
  }, [subscribeWs])

  // Canvas intensity: full while streaming
  useEffect(() => {
    if (isStreaming) {
      canvasRef.current?.setIntensity(1)
    }
  }, [isStreaming])

  // Docker stats → canvas stimulation + CPU-based intensity
  const handleStats = useCallback(
    (data: {
      aggregate: { cpu_percent: number }
      containers: Record<string, ContainerStats>
      container_count: number
    }) => {
      canvasRef.current?.stimulate(data.containers)
      if (!isStreamingRef.current) {
        const maxCpu = data.container_count * 100
        const norm = Math.min(data.aggregate.cpu_percent / maxCpu, 1.0)
        canvasRef.current?.setIntensity(0.02 + norm * 0.83)
      }
    },
    [],
  )

  // Sync JSONL history into live messages when session changes or reloads.
  // Guard against overwriting live messages mid-stream or during load.
  // isStreaming intentionally excluded from deps — use isStreamingRef so this
  // effect only re-runs when historicalMessages/sessionLoading/sessionError change.
  useEffect(() => {
    if (!liveMessagesHydrated) return
    const sessionChanged = lastSyncedSessionIdRef.current !== chatSessionId
    const shouldSync = shouldSyncHistoricalMessages({
      isStreaming: isStreamingRef.current,
      sessionLoading,
      sessionError,
      sessionChanged,
      historicalCount: historicalMessages.length,
      liveCount: liveMessages.length,
    })
    if (!shouldSync) {
      return
    }
    setLiveMessages(historicalMessages)
    lastSyncedSessionIdRef.current = chatSessionId
  }, [
    chatSessionId,
    historicalMessages,
    liveMessages.length,
    liveMessagesHydrated,
    sessionLoading,
    sessionError,
  ])

  // Derive active session metadata for display
  const activeSession = useMemo(() => {
    if (railMode === 'assistant') {
      return assistantSessions.find((s) => s.id === activeAssistantSessionId) ?? null
    }
    return rawSessions.find((s) => s.id === activeSessionId) ?? null
  }, [railMode, assistantSessions, activeAssistantSessionId, rawSessions, activeSessionId])

  const modelOptions = useMemo(() => {
    const modelOption = getAcpModelConfigOption(acpConfigOptions)
    if (!modelOption?.options?.length) return []
    return modelOption.options.map((option) => ({
      value: option.value,
      label: option.name,
    }))
  }, [acpConfigOptions])

  const permissionOptions = useMemo(() => {
    const modeOption = getAcpModeConfigOption(acpConfigOptions)
    if (!modeOption?.options?.length) {
      return AXON_PERMISSION_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      }))
    }
    return modeOption.options.map((option) => ({
      value: option.value,
      label: option.name,
    }))
  }, [acpConfigOptions])

  useEffect(() => {
    if (permissionOptions.length === 0) return
    if (!permissionOptions.some((opt) => opt.value === sessionMode)) {
      setSessionMode(permissionOptions[0]?.value ?? '')
    }
  }, [permissionOptions, sessionMode])

  const composerToolsState = useMemo(
    () => ({
      mcpServers: mcp.mcpServers,
      enabledMcpServers: mcp.enabledMcpServers,
      mcpStatusByServer: mcp.mcpStatusByServer,
    }),
    [mcp.enabledMcpServers, mcp.mcpServers, mcp.mcpStatusByServer],
  )

  useEffect(() => {
    // Restore all persisted layout state after mount (avoids SSR hydration mismatch)
    try {
      const saved = window.localStorage.getItem(AXON_MOBILE_PANE_STORAGE_KEY)
      if (
        saved === 'sidebar' ||
        saved === 'chat' ||
        saved === 'editor' ||
        saved === 'terminal' ||
        saved === 'logs' ||
        saved === 'mcp' ||
        saved === 'settings' ||
        saved === 'cortex'
      ) {
        setMobilePane(saved as AxonMobilePane)
      }
    } catch {
      /* ignore */
    }
    setSidebarWidth(
      readStoredFloat(
        SIDEBAR_WIDTH_STORAGE_KEY,
        SIDEBAR_WIDTH_DEFAULT,
        SIDEBAR_WIDTH_MIN,
        SIDEBAR_WIDTH_MAX,
      ),
    )
    setChatFlex(readStoredFloat(CHAT_FLEX_STORAGE_KEY, 1))
    setSidebarOpen(readStoredBool(SIDEBAR_OPEN_STORAGE_KEY, true))
    setChatOpen(readStoredBool(CHAT_OPEN_STORAGE_KEY, true))
    const storedPane = getStorageItem(RIGHT_PANE_STORAGE_KEY)
    if (storedPane === '') {
      setRightPane(null)
    } else if (storedPane && VALID_RIGHT_PANES.has(storedPane)) {
      setRightPane(storedPane as RightPane)
    } else {
      setRightPane('editor')
    }
    setRailMode(readStoredRailMode(RAIL_MODE_STORAGE_KEY, 'sessions'))
    const rawProfile = getStorageItem(CANVAS_PROFILE_STORAGE_KEY)
    if (rawProfile && ['current', 'subtle', 'cinematic', 'electric', 'zen'].includes(rawProfile)) {
      setCanvasProfile(rawProfile as NeuralCanvasProfile)
    }
    setLayoutRestored(true)
  }, [])

  const handleCanvasProfileChange = useCallback((profile: NeuralCanvasProfile) => {
    setCanvasProfile(profile)
    setStorageItem(CANVAS_PROFILE_STORAGE_KEY, profile)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: railMode is intentional trigger
  useEffect(() => {
    setRailQuery('')
  }, [railMode])

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

  const startSidebarResize = useCallback(
    (startX: number) => {
      const initWidth = sidebarWidth
      let lastWidth = initWidth
      setIsDragging(true)
      const onMove = (e: MouseEvent) => {
        lastWidth = Math.max(
          SIDEBAR_WIDTH_MIN,
          Math.min(SIDEBAR_WIDTH_MAX, initWidth + e.clientX - startX),
        )
        setSidebarWidth(lastWidth)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        setIsDragging(false)
        try {
          window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(lastWidth))
        } catch {
          /* ignore */
        }
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [sidebarWidth],
  )

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    try {
      window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const startChatResize = useCallback(
    (startX: number) => {
      const section = sectionRef.current
      if (!section) return
      const sidebarPx = sidebarOpen ? sidebarWidth : 40
      const available = section.offsetWidth - sidebarPx
      const totalFlex = chatFlex + 1
      const initChatPx = (available * chatFlex) / totalFlex
      let lastFlex = chatFlex
      setIsDragging(true)
      const onMove = (e: MouseEvent) => {
        const newChatPx = Math.max(
          PANE_WIDTH_MIN,
          Math.min(available - PANE_WIDTH_MIN, initChatPx + e.clientX - startX),
        )
        lastFlex = newChatPx / (available - newChatPx)
        setChatFlex(lastFlex)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        setIsDragging(false)
        try {
          window.localStorage.setItem(CHAT_FLEX_STORAGE_KEY, String(lastFlex))
        } catch {
          /* ignore */
        }
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [sidebarOpen, sidebarWidth, chatFlex],
  )

  const resetChatFlex = useCallback(() => {
    setChatFlex(1)
    try {
      window.localStorage.removeItem(CHAT_FLEX_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const nudgeSidebar = useCallback((delta: number) => {
    setSidebarWidth((w) => {
      const next = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, w + delta))
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const nudgeChatFlex = useCallback(
    (delta: number) => {
      const section = sectionRef.current
      if (!section) return
      const sidebarPx = sidebarOpen ? sidebarWidth : 40
      const available = section.offsetWidth - sidebarPx
      setChatFlex((f) => {
        const currentChatPx = (available * f) / (f + 1)
        const newChatPx = Math.max(
          PANE_WIDTH_MIN,
          Math.min(available - PANE_WIDTH_MIN, currentChatPx + delta),
        )
        const next = newChatPx / (available - newChatPx)
        try {
          window.localStorage.setItem(CHAT_FLEX_STORAGE_KEY, String(next))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    [sidebarOpen, sidebarWidth],
  )

  const setRailModeTracked = useCallback((mode: RailMode) => {
    setRailMode(mode)
    try {
      window.localStorage.setItem(RAIL_MODE_STORAGE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  const persistSidebarOpen = useCallback(
    (open: boolean) => {
      if (!open && !chatOpen && rightPane === null) return
      setSidebarOpen(open)
      try {
        window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open))
      } catch {
        /* ignore */
      }
    },
    [chatOpen, rightPane],
  )

  const persistChatOpen = useCallback(
    (open: boolean) => {
      if (!open && !sidebarOpen && rightPane === null) return
      setChatOpen(open)
      try {
        window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(open))
      } catch {
        /* ignore */
      }
    },
    [sidebarOpen, rightPane],
  )

  const persistRightPane = useCallback(
    (pane: RightPane) => {
      if (pane === null && !sidebarOpen && !chatOpen) return
      setRightPane(pane)
      try {
        window.localStorage.setItem(RIGHT_PANE_STORAGE_KEY, pane ?? '')
      } catch {
        /* ignore */
      }
    },
    [sidebarOpen, chatOpen],
  )

  const openFile = useCallback(
    (path: string) => {
      setActiveFile(path)
      workspace.setSelectedFilePath(path)
      persistRightPane('editor')
    },
    [workspace, persistRightPane],
  )

  function handleSidebarFileSelect(entry: FileEntry) {
    workspace.setSelectedFilePath(entry.path)
    if (entry.type === 'file') {
      openFile(entry.path)
    }
  }

  const setMobilePaneTracked = useCallback((nextPane: AxonMobilePane) => {
    setMobilePane(nextPane)
    try {
      window.localStorage.setItem(AXON_MOBILE_PANE_STORAGE_KEY, nextPane)
    } catch {
      /* ignore */
    }
  }, [])

  const handlePromptSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text =
        message.text ||
        (message.files.length > 0
          ? `Attached ${message.files.length} file${message.files.length === 1 ? '' : 's'}.`
          : '')
      if (text) submitPrompt(text)
    },
    [submitPrompt],
  )

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      // Reset optimistic chat state immediately; the selected session history
      // will be loaded by useAxonSession and synced back in.
      setLiveMessages([])
      setActiveSessionId(sessionId)
      setActiveAssistantSessionId(null)
      setSessionKey((k) => k + 1)
      const session = rawSessions.find((s) => s.id === sessionId)
      if (session?.agent && session.agent !== (pulseAgent ?? 'claude')) {
        setPulseAgent(session.agent as PulseAgent)
        setPulseModel('default')
      }
    },
    [rawSessions, pulseAgent, setPulseAgent, setPulseModel],
  )

  const handleSelectAssistantSession = useCallback((sessionId: string) => {
    setActiveAssistantSessionId(sessionId)
    setActiveSessionId(null)
    setSessionKey((k) => k + 1)
  }, [])

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null)
    setActiveAssistantSessionId(null)
    setLiveMessages([])
    setPendingHandoffContext(null)
    setSessionKey((k) => k + 1)
  }, [])

  const handleDesktopNewSession = useCallback(() => {
    handleNewSession()
    persistChatOpen(true)
  }, [handleNewSession, persistChatOpen])

  const handleMobileNewSession = useCallback(() => {
    handleNewSession()
    setMobilePaneTracked('chat')
  }, [handleNewSession, setMobilePaneTracked])

  const handleMobileSelectSession = useCallback(
    (sessionId: string) => {
      handleSelectSession(sessionId)
      setMobilePaneTracked('chat')
    },
    [handleSelectSession, setMobilePaneTracked],
  )

  const handleMobileFileSelect = useCallback(
    (entry: FileEntry) => {
      workspace.setSelectedFilePath(entry.path)
      if (entry.type === 'file') {
        openFile(entry.path)
        setMobilePaneTracked('editor')
      }
    },
    [openFile, workspace, setMobilePaneTracked],
  )

  const handleMobileOpenFile = useCallback(
    (path: string) => {
      openFile(path)
      setMobilePaneTracked('editor')
    },
    [openFile, setMobilePaneTracked],
  )

  const handleEditMessage = useCallback(
    (messageId: string, content: string) => {
      setLiveMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId)
        return idx >= 0 ? prev.slice(0, idx) : prev
      })
      submitPrompt(content)
    },
    [submitPrompt],
  )

  const handleRetryMessage = useCallback(
    (messageId: string) => {
      const idx = liveMessages.findIndex((m) => m.id === messageId)
      if (idx <= 0) return
      const userMsg = liveMessages
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === 'user')
      if (!userMsg) return
      setLiveMessages((prev) => {
        const userIdx = prev.findIndex((m) => m.id === userMsg.id)
        return userIdx >= 0 ? prev.slice(0, userIdx) : prev
      })
      submitPrompt(userMsg.content)
    },
    [liveMessages, submitPrompt],
  )

  const handleEnableServerTools = useCallback(
    (serverName: string) => {
      const serverTools = mcpToolsByServer[serverName] ?? []
      if (serverTools.length === 0) return
      setEnabledMcpTools((current) => {
        const base = current ?? Object.values(mcpToolsByServer).flat()
        return Array.from(new Set([...base, ...serverTools]))
      })
    },
    [mcpToolsByServer],
  )

  const handleDisableServerTools = useCallback(
    (serverName: string) => {
      const serverTools = new Set(mcpToolsByServer[serverName] ?? [])
      if (serverTools.size === 0) return
      setEnabledMcpTools((current) => {
        const base = current ?? Object.values(mcpToolsByServer).flat()
        return base.filter((toolName) => !serverTools.has(toolName))
      })
    },
    [mcpToolsByServer],
  )

  const handleSaveToolPreset = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const preset: ToolPreset = {
        id: createClientId(),
        name: trimmed,
        enabledMcpServers: [...mcp.enabledMcpServers],
        enabledMcpTools: [...effectiveEnabledMcpTools],
      }
      setToolPresets((current) => {
        const withoutSameName = current.filter(
          (item) => item.name.toLowerCase() !== trimmed.toLowerCase(),
        )
        return [preset, ...withoutSameName].slice(0, 50)
      })
    },
    [effectiveEnabledMcpTools, mcp.enabledMcpServers],
  )

  const handleApplyToolPreset = useCallback(
    (presetId: string) => {
      const preset = toolPresets.find((item) => item.id === presetId)
      if (!preset) return
      mcp.setEnabledMcpServers(preset.enabledMcpServers)
      setEnabledMcpTools(preset.enabledMcpTools)
    },
    [mcp.setEnabledMcpServers, toolPresets],
  )

  const handleDeleteToolPreset = useCallback((presetId: string) => {
    setToolPresets((current) => current.filter((item) => item.id !== presetId))
  }, [])

  const sidebarProps = {
    sessions: rawSessions,
    railMode,
    onRailModeChange: setRailModeTracked,
    railQuery,
    onRailQueryChange: setRailQuery,
    activeSessionId,
    activeSessionRepo: activeSession?.project ?? '',
    assistantSessions,
    activeAssistantSessionId,
    onSelectAssistantSession: handleSelectAssistantSession,
    fileEntries: workspace.fileEntries,
    fileLoading: workspace.fileLoading,
    selectedFilePath: workspace.selectedFilePath,
    onNewSession: handleDesktopNewSession,
  } as const

  const composerProps = {
    files: composerFiles,
    onFilesChange: setComposerFiles,
    onSubmit: handlePromptSubmit,
    modelOptions,
    permissionOptions,
    pulseModel: pulseModel ?? 'sonnet',
    pulsePermissionLevel: sessionMode,
    onModelChange: (value: string) => setPulseModel(value),
    onPermissionChange: (value: string) => {
      setSessionMode(value)
      if (value === 'plan' || value === 'accept-edits' || value === 'bypass-permissions') {
        setPulsePermissionLevel(value)
      }
    },
    toolsState: composerToolsState,
    onToggleMcpServer: mcp.toggleMcpServer,
    mcpToolsByServer,
    enabledMcpTools: effectiveEnabledMcpTools,
    onEnableServerTools: handleEnableServerTools,
    onDisableServerTools: handleDisableServerTools,
    onToggleMcpTool: (toolName: string) => {
      setEnabledMcpTools((current) => {
        const knownTools = Object.values(mcpToolsByServer).flat()
        const base = current ?? knownTools
        return base.includes(toolName)
          ? base.filter((name) => name !== toolName)
          : [...base, toolName]
      })
    },
    toolPresets: toolPresets.map((preset) => ({ id: preset.id, name: preset.name })),
    onApplyToolPreset: handleApplyToolPreset,
    onDeleteToolPreset: handleDeleteToolPreset,
    onSaveToolPreset: handleSaveToolPreset,
    pulseAgent: (pulseAgent ?? 'claude') as PulseAgent,
    onAgentChange: (value: PulseAgent) => {
      const fromAgent = pulseAgent ?? 'claude'
      if (value !== fromAgent) {
        const handoff = buildAgentHandoffContext(liveMessages, fromAgent, value)
        setPendingHandoffContext(handoff || null)
      }
      setPulseAgent(value)
      setPulseModel('default')
    },
    isStreaming,
    connected,
  } as const

  const displayMessages = liveMessages

  useEffect(() => {
    if (!liveMessagesHydrated) return
    if (!connected && chatSessionId === null && liveMessages.length === 0) return
    // Keep existing non-empty draft during refresh/hot-reload races.
    if (chatSessionId === null && liveMessages.length === 0) {
      try {
        const existingRaw = window.sessionStorage.getItem(LIVE_MESSAGES_STORAGE_KEY)
        if (existingRaw) {
          const existing = JSON.parse(existingRaw) as { messages?: AxonMessage[] }
          if (Array.isArray(existing.messages) && existing.messages.length > 0) {
            return
          }
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

  const transitionClass =
    isDragging || !layoutRestored ? '' : 'transition-[width,flex] duration-300 ease-out'

  // Title and message count for the chat header
  const chatTitle = activeSession?.preview?.slice(0, 60) ?? activeSession?.project ?? 'New chat'
  const agentLabel = agentDisplayName(pulseAgent ?? 'claude')

  return (
    <AxonFrame canvasRef={canvasRef} canvasProfile={canvasProfile}>
      <div className="hidden">
        <DockerStats onStats={handleStats} />
      </div>
      <div className="flex h-dvh min-h-dvh flex-col">
        {/* ── Mobile layout ── */}
        <section className="flex min-h-0 flex-1 flex-col lg:hidden">
          <div className="axon-toolbar flex h-14 items-center justify-between bg-[rgba(7,12,26,0.62)] px-3">
            <span
              className="select-none text-sm font-extrabold tracking-[3px]"
              style={{
                background: 'linear-gradient(135deg, #afd7ff 0%, #ff87af 50%, #8787af 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              AXON
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMobilePaneTracked('sidebar')}
                aria-label="Sidebar pane"
                aria-pressed={mobilePane === 'sidebar'}
                className={`inline-flex size-7 items-center justify-center rounded border transition-colors ${
                  mobilePane === 'sidebar'
                    ? 'border-[rgba(175,215,255,0.48)] bg-[linear-gradient(145deg,rgba(135,175,255,0.34),rgba(135,175,255,0.14))] text-[var(--text-primary)] shadow-[0_0_14px_rgba(135,175,255,0.2)]'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-dim)] hover:border-[rgba(175,215,255,0.24)] hover:text-[var(--text-primary)]'
                }`}
              >
                <PanelLeft className="size-3.5" />
              </button>
              <AxonMobilePaneSwitcher
                mobilePane={mobilePane === 'sidebar' ? 'chat' : mobilePane}
                onMobilePaneChange={(pane) => setMobilePaneTracked(pane)}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {mobilePane === 'sidebar' ? (
              <AxonSidebar
                variant="mobile"
                {...sidebarProps}
                onSelectSession={handleMobileSelectSession}
                onSelectFile={handleMobileFileSelect}
                onNewSession={handleMobileNewSession}
              />
            ) : mobilePane === 'chat' ? (
              <div className="axon-glass-shell flex h-full min-h-0 flex-col border-0 rounded-none">
                <Conversation key={sessionKey} className="w-full flex-1 px-3 py-3">
                  <AxonMessageList
                    messages={displayMessages}
                    agentName={agentLabel}
                    sessionKey={sessionKey}
                    copiedId={copiedId}
                    copyMessage={copyMessage}
                    onOpenFile={handleMobileOpenFile}
                    isTyping={isStreaming}
                    variant="mobile"
                    loading={sessionLoading}
                    error={sessionError}
                    onRetry={reloadSession}
                    onEditorContent={onEditorUpdate}
                    onEdit={handleEditMessage}
                    onRetryMessage={handleRetryMessage}
                  />
                  <ConversationScrollButton className="animate-scale-in" />
                </Conversation>

                <div className="axon-toolbar border-t border-b-0 px-3 py-3">
                  <AxonPromptComposer compact {...composerProps} />
                </div>
              </div>
            ) : mobilePane === 'editor' ? (
              <div className="axon-glass-shell flex h-full min-h-0 flex-col border-0 rounded-none">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <EditorPane
                    markdown={editorMarkdown}
                    onMarkdownChange={setEditorMarkdown}
                    scrollStorageKey="axon.web.reboot.editor-scroll"
                  />
                </div>
              </div>
            ) : mobilePane === 'terminal' ? (
              <div className="axon-glass-shell flex h-full min-h-0 flex-col border-0 rounded-none">
                <AxonTerminalPane />
              </div>
            ) : mobilePane === 'logs' ? (
              <div className="axon-glass-shell flex h-full min-h-0 flex-col border-0 rounded-none">
                <AxonLogsPane />
              </div>
            ) : mobilePane === 'mcp' ? (
              <div className="axon-glass-shell flex h-full min-h-0 flex-col border-0 rounded-none">
                <AxonMcpPane />
              </div>
            ) : mobilePane === 'settings' ? (
              <div className="axon-glass-shell flex h-full min-h-0 flex-col border-0 rounded-none">
                <AxonSettingsPane
                  canvasProfile={canvasProfile}
                  onCanvasProfileChange={handleCanvasProfileChange}
                />
              </div>
            ) : mobilePane === 'cortex' ? (
              <div className="axon-glass-shell flex h-full min-h-0 flex-col border-0 rounded-none">
                <AxonCortexPane />
              </div>
            ) : null}
          </div>
        </section>

        {/* ── Desktop layout ── */}
        <section ref={sectionRef} className="hidden min-h-0 flex-1 lg:flex">
          {/* Sidebar */}
          {sidebarOpen ? (
            <aside
              className={`h-full min-h-0 shrink-0 overflow-hidden ${transitionClass}`}
              style={{ width: sidebarWidth }}
            >
              <AxonSidebar
                variant="desktop"
                {...sidebarProps}
                onSelectSession={handleSelectSession}
                onSelectFile={handleSidebarFileSelect}
                onCollapse={() => persistSidebarOpen(false)}
              />
            </aside>
          ) : (
            <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-[var(--border-subtle)] bg-[linear-gradient(180deg,rgba(9,17,35,0.82),rgba(6,12,26,0.9))] pt-1">
              <button
                type="button"
                onClick={() => persistSidebarOpen(true)}
                aria-label="Expand sidebar"
                className="axon-icon-btn flex size-7 items-center justify-center"
              >
                <PanelLeft className="size-3.5" />
              </button>
              <div className="my-1.5 w-5 border-t border-[var(--border-subtle)]" />
              {RAIL_MODES.map((mode) => {
                const Icon = mode.icon
                const isActive = railMode === mode.id
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setRailModeTracked(mode.id)
                      persistSidebarOpen(true)
                    }}
                    aria-label={mode.label}
                    title={mode.label}
                    className={`flex size-7 items-center justify-center rounded transition-colors ${
                      isActive
                        ? 'border border-[rgba(175,215,255,0.42)] bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] text-[var(--text-primary)]'
                        : 'text-[var(--text-dim)] hover:bg-[rgba(175,215,255,0.06)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon className="size-3.5" />
                  </button>
                )
              })}
            </div>
          )}

          {/* Sidebar ↔ Chat resize handle */}
          {sidebarOpen && chatOpen ? (
            <ResizeDivider
              onDragStart={startSidebarResize}
              onReset={resetSidebarWidth}
              onNudge={nudgeSidebar}
            />
          ) : sidebarOpen && !chatOpen ? (
            <div className="w-px shrink-0 bg-[var(--border-subtle)]" />
          ) : null}

          {/* Chat pane */}
          {chatOpen ? (
            <div
              className={`axon-glass-shell h-full min-h-0 overflow-hidden rounded-none border-0 animate-fade-in ${transitionClass}`}
              style={{ flex: `${chatFlex} ${chatFlex} 0%`, minWidth: PANE_WIDTH_MIN }}
            >
              <div className="axon-toolbar flex h-14 items-center justify-between px-4">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[var(--text-primary)]">
                    {chatTitle}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
                    <span>{agentLabel}</span>
                    <span className="opacity-40">·</span>
                    <span>{liveMessages.length} msg</span>
                    {connected ? null : (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="text-[var(--axon-secondary)]">disconnected</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.22)] hover:bg-[rgba(175,215,255,0.07)] data-[active=true]:border-[rgba(175,215,255,0.42)] data-[active=true]:bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] data-[active=true]:text-[var(--text-primary)]"
                    data-active={rightPane === 'cortex'}
                    onClick={() => persistRightPane(rightPane === 'cortex' ? null : 'cortex')}
                  >
                    <Brain className="size-4" />
                    <span className="sr-only">Toggle cortex</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.22)] hover:bg-[rgba(175,215,255,0.07)] data-[active=true]:border-[rgba(175,215,255,0.42)] data-[active=true]:bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] data-[active=true]:text-[var(--text-primary)]"
                    data-active={rightPane === 'terminal'}
                    onClick={() => persistRightPane(rightPane === 'terminal' ? null : 'terminal')}
                  >
                    <TerminalSquare className="size-4" />
                    <span className="sr-only">Toggle terminal</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.22)] hover:bg-[rgba(175,215,255,0.07)] data-[active=true]:border-[rgba(175,215,255,0.42)] data-[active=true]:bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] data-[active=true]:text-[var(--text-primary)]"
                    data-active={rightPane === 'logs'}
                    onClick={() => persistRightPane(rightPane === 'logs' ? null : 'logs')}
                  >
                    <ScrollText className="size-4" />
                    <span className="sr-only">Toggle logs</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.22)] hover:bg-[rgba(175,215,255,0.07)] data-[active=true]:border-[rgba(175,215,255,0.42)] data-[active=true]:bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] data-[active=true]:text-[var(--text-primary)]"
                    data-active={rightPane === 'mcp'}
                    onClick={() => persistRightPane(rightPane === 'mcp' ? null : 'mcp')}
                  >
                    <McpIcon className="size-4" />
                    <span className="sr-only">Toggle MCP servers</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.22)] hover:bg-[rgba(175,215,255,0.07)] data-[active=true]:border-[rgba(175,215,255,0.42)] data-[active=true]:bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] data-[active=true]:text-[var(--text-primary)]"
                    data-active={rightPane === 'settings'}
                    onClick={() => persistRightPane(rightPane === 'settings' ? null : 'settings')}
                  >
                    <Settings2 className="size-4" />
                    <span className="sr-only">Toggle settings</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.22)] hover:bg-[rgba(175,215,255,0.07)] data-[active=true]:border-[rgba(175,215,255,0.42)] data-[active=true]:bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] data-[active=true]:text-[var(--text-primary)]"
                    data-active={chatOpen}
                    onClick={() => persistChatOpen(!chatOpen)}
                  >
                    <MessageSquareText className="size-4" />
                    <span className="sr-only">Toggle chat</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 rounded-md border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.22)] hover:bg-[rgba(175,215,255,0.07)] data-[active=true]:border-[rgba(175,215,255,0.42)] data-[active=true]:bg-[linear-gradient(145deg,rgba(135,175,255,0.26),rgba(135,175,255,0.08))] data-[active=true]:text-[var(--text-primary)]"
                    data-active={rightPane === 'editor'}
                    onClick={() => persistRightPane(rightPane === 'editor' ? null : 'editor')}
                  >
                    <PanelRight className="size-4" />
                    <span className="sr-only">Toggle editor</span>
                  </Button>
                </div>
              </div>

              <div className="flex h-[calc(100%-56px)] min-h-0 flex-col">
                <Conversation className="w-full flex-1 px-4 py-4">
                  <AxonMessageList
                    messages={displayMessages}
                    agentName={agentLabel}
                    sessionKey={sessionKey}
                    copiedId={copiedId}
                    copyMessage={copyMessage}
                    onOpenFile={openFile}
                    isTyping={isStreaming}
                    variant="desktop"
                    loading={sessionLoading}
                    error={sessionError}
                    onRetry={reloadSession}
                    onEditorContent={onEditorUpdate}
                    onEdit={handleEditMessage}
                    onRetryMessage={handleRetryMessage}
                  />
                  <ConversationScrollButton className="animate-scale-in" />
                </Conversation>

                <div className="axon-toolbar border-t border-b-0 px-4 py-3">
                  <AxonPromptComposer {...composerProps} />
                </div>
              </div>
            </div>
          ) : (
            <AxonPaneHandle label="Chat" side="left" onClick={() => persistChatOpen(true)} />
          )}

          {/* Chat ↔ Editor resize handle */}
          {chatOpen && editorOpen ? (
            <ResizeDivider
              onDragStart={startChatResize}
              onReset={resetChatFlex}
              onNudge={nudgeChatFlex}
            />
          ) : null}

          {/* Right pane */}
          {rightPane ? (
            <aside
              className={`axon-glass-shell h-full min-h-0 overflow-hidden rounded-none border-0 animate-fade-in ${transitionClass}`}
              style={{ flex: '1 1 0%', minWidth: PANE_WIDTH_MIN }}
            >
              {rightPane === 'editor' && (
                <EditorPane
                  markdown={editorMarkdown}
                  onMarkdownChange={setEditorMarkdown}
                  scrollStorageKey="axon.web.reboot.editor-scroll"
                />
              )}
              {rightPane === 'cortex' && <AxonCortexPane />}
              {rightPane === 'terminal' && <AxonTerminalPane />}
              {rightPane === 'logs' && <AxonLogsPane />}
              {rightPane === 'mcp' && <AxonMcpPane />}
              {rightPane === 'settings' && (
                <AxonSettingsPane
                  canvasProfile={canvasProfile}
                  onCanvasProfileChange={handleCanvasProfileChange}
                />
              )}
            </aside>
          ) : (
            <AxonPaneHandle
              label="Editor"
              side="right"
              onClick={() => persistRightPane('editor')}
            />
          )}
        </section>
      </div>
    </AxonFrame>
  )
}
