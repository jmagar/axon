'use client'

import { MessageSquareText, PanelLeft, PanelRight, ScrollText, TerminalSquare } from 'lucide-react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Conversation, ConversationScrollButton } from '@/components/ai-elements/conversation'
import type { PromptInputFile, PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { PulseMobilePaneSwitcher } from '@/components/pulse/pulse-mobile-pane-switcher'
import { Button } from '@/components/ui/button'
import type { FileEntry } from '@/components/workspace/file-tree'
import { useAxonAcp } from '@/hooks/use-axon-acp'
import type { MessageItem } from '@/hooks/use-axon-session'
import { useAxonSession } from '@/hooks/use-axon-session'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { useMcpServers } from '@/hooks/use-mcp-servers'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useWorkspaceFiles } from '@/hooks/use-workspace-files'
import { useWsMessageActions, useWsWorkspaceState } from '@/hooks/use-ws-messages'
import { apiFetch } from '@/lib/api-fetch'
import { getAcpModelConfigOption } from '@/lib/pulse/acp-config'
import type { PulseAgent } from '@/lib/pulse/types'
import { AxonFrame } from './axon-frame'
import { AxonLogsDialog } from './axon-logs-dialog'
import { AxonMcpDialog } from './axon-mcp-dialog'
import { AxonMessageList } from './axon-message-list'
import { type AxonPermissionValue, RAIL_MODES, type RailMode } from './axon-mock-data'
import { AxonPaneHandle } from './axon-pane-handle'
import { AxonPromptComposer } from './axon-prompt-composer'
import { AxonSidebar } from './axon-sidebar'
import { AxonTerminalDialog } from './axon-terminal-dialog'
import { McpIcon } from './mcp-config'

const PulseEditorPane = dynamic(
  () =>
    import('@/components/pulse/pulse-editor-pane').then((m) => ({ default: m.PulseEditorPane })),
  { ssr: false },
)

type AxonMobilePane = 'sidebar' | 'chat' | 'editor'
const AXON_MOBILE_PANE_STORAGE_KEY = 'axon.web.reboot.mobile-pane'
const SIDEBAR_WIDTH_STORAGE_KEY = 'axon.web.reboot.sidebar-width'
const CHAT_FLEX_STORAGE_KEY = 'axon.web.reboot.chat-flex'
const SIDEBAR_OPEN_STORAGE_KEY = 'axon.web.reboot.sidebar-open'
const CHAT_OPEN_STORAGE_KEY = 'axon.web.reboot.chat-open'
const EDITOR_OPEN_STORAGE_KEY = 'axon.web.reboot.editor-open'
const RAIL_MODE_STORAGE_KEY = 'axon.web.reboot.rail-mode'
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
    if (v === 'sessions' || v === 'files' || v === 'pages' || v === 'agents') return v
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

export function AxonShell() {
  const pathname = usePathname()
  const { pulseModel, pulsePermissionLevel, acpConfigOptions, pulseAgent } = useWsWorkspaceState()
  const { setPulseModel, setPulsePermissionLevel, setPulseAgent } = useWsMessageActions()
  const { copiedId, copy: copyMessage } = useCopyFeedback()
  const mcp = useMcpServers()
  const workspace = useWorkspaceFiles()

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [railMode, setRailMode] = useState<RailMode>('sessions')
  const [mobilePane, setMobilePane] = useState<AxonMobilePane>('chat')
  const [railQuery, setRailQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [editorOpen, setEditorOpen] = useState(true)
  // ↑ defaults used for SSR; localStorage overrides applied in mount effect below
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [sessionKey, setSessionKey] = useState(0)
  const [liveMessages, setLiveMessages] = useState<MessageItem[]>([])
  const [activeFile, setActiveFile] = useState('')
  const [editorMarkdown, setEditorMarkdown] = useState('# New document\n')
  const [composerFiles, setComposerFiles] = useState<PromptInputFile[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT)
  const [chatFlex, setChatFlex] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [layoutRestored, setLayoutRestored] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)

  // Live session list from ~/.claude/projects
  const { sessions: rawSessions, reload: reloadSessions } = useRecentSessions()

  // Load JSONL history for the active session
  const {
    messages: historicalMessages,
    loading: sessionLoading,
    error: sessionError,
    reload: reloadSession,
  } = useAxonSession(activeSessionId)

  const onSessionIdChange = useCallback((newId: string) => {
    setActiveSessionId(newId)
  }, [])

  const onMessagesChange = useCallback((updater: (prev: MessageItem[]) => MessageItem[]) => {
    setLiveMessages(updater)
  }, [])

  const onTurnComplete = useCallback(() => {
    reloadSessions()
  }, [reloadSessions])

  const { submitPrompt, isStreaming, connected } = useAxonAcp({
    activeSessionId,
    onSessionIdChange,
    onSessionFallback: undefined,
    onMessagesChange,
    onTurnComplete,
  })

  // Sync JSONL history into live messages when session changes.
  // Guard against overwriting a partially-streamed assistant message when
  // session_fallback triggers a new sessionId mid-stream.
  useEffect(() => {
    if (isStreaming) return
    setLiveMessages(historicalMessages)
  }, [historicalMessages, isStreaming])

  // Derive active session metadata for display
  const activeSession = useMemo(
    () => rawSessions.find((s) => s.id === activeSessionId) ?? null,
    [rawSessions, activeSessionId],
  )

  const modelOptions = useMemo(() => {
    const modelOption = getAcpModelConfigOption(acpConfigOptions)
    if (!modelOption?.options?.length) return []
    return modelOption.options.map((option) => ({
      value: option.value,
      label: option.name,
    }))
  }, [acpConfigOptions])

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
      if (saved === 'sidebar' || saved === 'chat' || saved === 'editor') setMobilePane(saved)
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
    setEditorOpen(readStoredBool(EDITOR_OPEN_STORAGE_KEY, true))
    setRailMode(readStoredRailMode(RAIL_MODE_STORAGE_KEY, 'sessions'))
    setLayoutRestored(true)
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
      if (!open && !chatOpen && !editorOpen) return
      setSidebarOpen(open)
      try {
        window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open))
      } catch {
        /* ignore */
      }
    },
    [chatOpen, editorOpen],
  )

  const persistChatOpen = useCallback(
    (open: boolean) => {
      if (!open && !sidebarOpen && !editorOpen) return
      setChatOpen(open)
      try {
        window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(open))
      } catch {
        /* ignore */
      }
    },
    [sidebarOpen, editorOpen],
  )

  const persistEditorOpen = useCallback(
    (open: boolean) => {
      if (!open && !sidebarOpen && !chatOpen) return
      setEditorOpen(open)
      try {
        window.localStorage.setItem(EDITOR_OPEN_STORAGE_KEY, String(open))
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
      persistEditorOpen(true)
    },
    [workspace, persistEditorOpen],
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

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    setSessionKey((k) => k + 1)
  }, [])

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null)
    setLiveMessages([])
    setSessionKey((k) => k + 1)
  }, [])

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

  const sidebarProps = {
    sessions: rawSessions,
    railMode,
    onRailModeChange: setRailModeTracked,
    railQuery,
    onRailQueryChange: setRailQuery,
    pathname,
    activeSessionId,
    activeSessionRepo: activeSession?.project ?? '',
    fileEntries: workspace.fileEntries,
    fileLoading: workspace.fileLoading,
    selectedFilePath: workspace.selectedFilePath,
    onNewSession: handleNewSession,
  } as const

  const composerProps = {
    files: composerFiles,
    onFilesChange: setComposerFiles,
    onSubmit: handlePromptSubmit,
    modelOptions,
    pulseModel: pulseModel ?? 'sonnet',
    pulsePermissionLevel,
    onModelChange: (value: string) => setPulseModel(value),
    onPermissionChange: (value: AxonPermissionValue) => setPulsePermissionLevel(value),
    toolsState: composerToolsState,
    onToggleMcpServer: mcp.toggleMcpServer,
    pulseAgent: (pulseAgent ?? 'claude') as PulseAgent,
    onAgentChange: (value: PulseAgent) => {
      setPulseAgent(value)
      setPulseModel('default')
    },
    isStreaming,
    connected,
  } as const

  // Cast liveMessages to the shape AxonMessageList expects.
  // The types overlap on the fields AxonMessageList actually renders:
  // id, role, content, files?, blocks?, steps?, reasoning?, timestamp?.
  // Surplus fields (streaming, chainOfThought) are ignored at render time.
  const displayMessages = liveMessages as unknown as import('./axon-mock-data').MessageItem[]

  const transitionClass =
    isDragging || !layoutRestored ? '' : 'transition-[width,flex] duration-300 ease-out'

  // Title and message count for the chat header
  const chatTitle = activeSession?.preview?.slice(0, 60) ?? activeSession?.project ?? 'New chat'
  const agentLabel = agentDisplayName(pulseAgent ?? 'claude')

  return (
    <AxonFrame>
      <div className="flex h-dvh min-h-dvh flex-col">
        {/* ── Mobile layout ── */}
        <section className="flex min-h-0 flex-1 flex-col lg:hidden">
          <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[rgba(7,12,26,0.55)] backdrop-blur-sm px-3">
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
                onClick={() => setTerminalOpen((current) => !current)}
                aria-label="Toggle terminal drawer"
                aria-pressed={terminalOpen}
                className={`inline-flex size-7 items-center justify-center rounded border transition-colors ${
                  terminalOpen
                    ? 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                }`}
              >
                <TerminalSquare className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setLogsOpen(true)}
                aria-label="Open logs"
                className="inline-flex size-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-dim)] transition-colors hover:text-[var(--text-primary)]"
              >
                <ScrollText className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMcpOpen(true)}
                aria-label="Open MCP servers"
                className="inline-flex size-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-dim)] transition-colors hover:text-[var(--text-primary)]"
              >
                <McpIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMobilePaneTracked('sidebar')}
                aria-label="Sidebar pane"
                aria-pressed={mobilePane === 'sidebar'}
                className={`inline-flex size-7 items-center justify-center rounded border transition-colors ${
                  mobilePane === 'sidebar'
                    ? 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-input)] text-[var(--text-dim)] hover:text-[var(--text-primary)]'
                }`}
              >
                <PanelLeft className="size-3.5" />
              </button>
              <PulseMobilePaneSwitcher
                mobilePane={mobilePane === 'editor' ? 'editor' : 'chat'}
                onMobilePaneChange={(pane) =>
                  setMobilePaneTracked(pane === 'editor' ? 'editor' : 'chat')
                }
              />
            </div>
          </div>

          <div
            className={`flex min-h-0 flex-1 flex-col ${terminalOpen ? 'pb-[calc(42dvh+0.75rem)]' : ''}`}
          >
            {mobilePane === 'sidebar' ? (
              <AxonSidebar
                variant="mobile"
                {...sidebarProps}
                onSelectSession={handleMobileSelectSession}
                onSelectFile={handleMobileFileSelect}
              />
            ) : mobilePane === 'chat' ? (
              <div className="flex h-full min-h-0 flex-col bg-[var(--glass-chat)] backdrop-blur-sm">
                <Conversation className="w-full flex-1 px-3 py-3">
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
                  />
                  <ConversationScrollButton className="animate-scale-in" />
                </Conversation>

                <div className="border-t border-[var(--border-subtle)] px-3 py-3">
                  <AxonPromptComposer compact {...composerProps} />
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col bg-[var(--glass-editor)]">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <PulseEditorPane
                    markdown={editorMarkdown}
                    onMarkdownChange={setEditorMarkdown}
                    scrollStorageKey="axon.web.reboot.editor-scroll"
                  />
                </div>
              </div>
            )}
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
            <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-[var(--border-subtle)] bg-[var(--glass-panel)] pt-1">
              <button
                type="button"
                onClick={() => persistSidebarOpen(true)}
                aria-label="Expand sidebar"
                className="flex size-7 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[rgba(175,215,255,0.06)] hover:text-[var(--axon-primary)]"
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
                        ? 'text-[var(--axon-primary)]'
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
              className={`h-full min-h-0 overflow-hidden bg-[var(--glass-chat)] backdrop-blur-sm animate-fade-in ${transitionClass}`}
              style={{ flex: `${chatFlex} ${chatFlex} 0%`, minWidth: PANE_WIDTH_MIN }}
            >
              <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
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
                    className={
                      terminalOpen ? 'text-[var(--axon-primary)]' : 'text-[var(--text-secondary)]'
                    }
                    onClick={() => setTerminalOpen((current) => !current)}
                  >
                    <TerminalSquare className="size-4" />
                    <span className="sr-only">Toggle terminal</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-[var(--text-secondary)]"
                    onClick={() => setLogsOpen(true)}
                  >
                    <ScrollText className="size-4" />
                    <span className="sr-only">Open logs</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-[var(--text-secondary)]"
                    onClick={() => setMcpOpen(true)}
                  >
                    <McpIcon className="size-4" />
                    <span className="sr-only">Open MCP servers</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={
                      chatOpen ? 'text-[var(--axon-primary)]' : 'text-[var(--text-secondary)]'
                    }
                    onClick={() => persistChatOpen(!chatOpen)}
                  >
                    <MessageSquareText className="size-4" />
                    <span className="sr-only">Toggle chat</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={
                      editorOpen ? 'text-[var(--axon-primary)]' : 'text-[var(--text-secondary)]'
                    }
                    onClick={() => persistEditorOpen(!editorOpen)}
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
                  />
                  <ConversationScrollButton className="animate-scale-in" />
                </Conversation>

                <div className="border-t border-[var(--border-subtle)] px-4 py-3">
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

          {/* Editor pane */}
          {editorOpen ? (
            <aside
              className={`h-full min-h-0 overflow-hidden bg-[var(--glass-editor)] animate-fade-in ${transitionClass}`}
              style={{ flex: '1 1 0%', minWidth: PANE_WIDTH_MIN }}
            >
              <PulseEditorPane
                markdown={editorMarkdown}
                onMarkdownChange={setEditorMarkdown}
                scrollStorageKey="axon.web.reboot.editor-scroll"
              />
            </aside>
          ) : (
            <AxonPaneHandle label="Editor" side="right" onClick={() => persistEditorOpen(true)} />
          )}
        </section>
      </div>
      <AxonLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
      <AxonMcpDialog open={mcpOpen} onOpenChange={setMcpOpen} />
      <AxonTerminalDialog open={terminalOpen} onOpenChange={setTerminalOpen} />
    </AxonFrame>
  )
}
