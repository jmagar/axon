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
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { useMcpServers } from '@/hooks/use-mcp-servers'
import { useWorkspaceFiles } from '@/hooks/use-workspace-files'
import { useWsMessageActions, useWsWorkspaceState } from '@/hooks/use-ws-messages'
import { apiFetch } from '@/lib/api-fetch'
import { getAcpModelConfigOption } from '@/lib/pulse/acp-config'
import { RebootFrame } from './reboot-frame'
import { RebootLogsDialog } from './reboot-logs-dialog'
import { RebootMessageList } from './reboot-message-list'
import {
  EDITOR_FILES,
  INITIAL_MESSAGES,
  type MessageItem,
  RAIL_MODES,
  type RailMode,
  REBOOT_FALLBACK_MODEL_OPTIONS,
  type RebootPermissionValue,
  SESSION_ITEMS,
} from './reboot-mock-data'
import { RebootPaneHandle } from './reboot-pane-handle'
import { RebootPromptComposer } from './reboot-prompt-composer'
import { RebootSidebar } from './reboot-sidebar'
import { RebootTerminalDialog } from './reboot-terminal-dialog'

const PulseEditorPane = dynamic(
  () =>
    import('@/components/pulse/pulse-editor-pane').then((m) => ({ default: m.PulseEditorPane })),
  { ssr: false },
)

type RebootMobilePane = 'sidebar' | 'chat' | 'editor'
const REBOOT_MOBILE_PANE_STORAGE_KEY = 'axon.web.reboot.mobile-pane'

function buildEditorMarkdown(path: string) {
  const body = EDITOR_FILES[path] ?? '# New document\n'
  if (path.endsWith('.md') || path.endsWith('.mdx')) return body
  const language = path.split('.').at(-1) ?? 'text'
  return `# ${path}\n\n\`\`\`${language}\n${body}\n\`\`\`\n`
}

export function RebootShell() {
  const pathname = usePathname()
  const { pulseModel, pulsePermissionLevel, acpConfigOptions } = useWsWorkspaceState()
  const { setPulseModel, setPulsePermissionLevel } = useWsMessageActions()
  const { copiedId, copy: copyMessage } = useCopyFeedback()
  const mcp = useMcpServers()
  const workspace = useWorkspaceFiles()

  const [railMode, setRailMode] = useState<RailMode>('sessions')
  const [mobilePane, setMobilePane] = useState<RebootMobilePane>('chat')
  const [railQuery, setRailQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [editorOpen, setEditorOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState(SESSION_ITEMS[0]!.id)
  const [sessionKey, setSessionKey] = useState(0)
  const [messageMap, setMessageMap] = useState(INITIAL_MESSAGES)
  const [activeFile, setActiveFile] = useState('lib/supabase.ts')
  const [editorMarkdown, setEditorMarkdown] = useState(() => buildEditorMarkdown('lib/supabase.ts'))
  const [composerFiles, setComposerFiles] = useState<PromptInputFile[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

  const activeSession = useMemo(
    () => SESSION_ITEMS.find((session) => session.id === activeSessionId) ?? SESSION_ITEMS[0]!,
    [activeSessionId],
  )
  const activeMessages = messageMap[activeSessionId] ?? []

  const modelOptions = useMemo(() => {
    const modelOption = getAcpModelConfigOption(acpConfigOptions)
    if (!modelOption?.options?.length) {
      return REBOOT_FALLBACK_MODEL_OPTIONS.map((option) => ({ ...option }))
    }
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
    try {
      const saved = window.localStorage.getItem(REBOOT_MOBILE_PANE_STORAGE_KEY)
      if (saved === 'sidebar' || saved === 'chat' || saved === 'editor') {
        setMobilePane(saved)
      }
    } catch {
      /* ignore */
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: railMode is intentional trigger
  useEffect(() => {
    setRailQuery('')
  }, [railMode])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
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

  const gridTemplateColumns = useMemo(() => {
    const columns: string[] = []
    columns.push(sidebarOpen ? 'minmax(220px, 0.45fr)' : '40px')
    columns.push(chatOpen ? 'minmax(0, 1fr)' : '40px')
    columns.push(editorOpen ? 'minmax(0, 1fr)' : '40px')
    return columns.join(' ')
  }, [chatOpen, editorOpen, sidebarOpen])

  const openFile = useCallback(
    (path: string) => {
      setActiveFile(path)
      workspace.setSelectedFilePath(path)
      setEditorOpen(true)
    },
    [workspace],
  )

  function handleSidebarFileSelect(entry: FileEntry) {
    workspace.setSelectedFilePath(entry.path)
    if (entry.type === 'file') {
      openFile(entry.path)
    }
  }

  const setMobilePaneTracked = useCallback((nextPane: RebootMobilePane) => {
    setMobilePane(nextPane)
    try {
      window.localStorage.setItem(REBOOT_MOBILE_PANE_STORAGE_KEY, nextPane)
    } catch {
      /* ignore */
    }
  }, [])

  async function handlePromptSubmit(message: PromptInputMessage) {
    const userMessage: MessageItem = {
      id: crypto.randomUUID(),
      role: 'user',
      content:
        message.text ||
        `Attached ${message.files.length} file${message.files.length === 1 ? '' : 's'}.`,
      files: message.files.map((file) => file.filename ?? file.url),
    }
    const assistantMessage: MessageItem = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content:
        'Acknowledged. The shell remains flexible: each pane can collapse or expand without losing the active session, editor state, or terminal surface.',
      reasoning:
        'The shell should act like infrastructure, not a page. Pane visibility is a layout choice, not a route choice.',
      steps: [
        { label: 'Parsed user intent', status: 'complete' },
        {
          label: 'Evaluated shell layout constraints',
          description: 'Pane independence verified — no coupled state',
          status: 'complete',
        },
        { label: 'Confirmed no breaking changes', status: 'complete' },
      ],
      files: ['apps/web/components/reboot/reboot-shell.tsx'],
    }

    setMessageMap((current) => ({
      ...current,
      [activeSessionId]: [...(current[activeSessionId] ?? []), userMessage],
    }))
    setIsTyping(true)

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      setMessageMap((current) => ({
        ...current,
        [activeSessionId]: [...(current[activeSessionId] ?? []), assistantMessage],
      }))
      setIsTyping(false)
    }, 1200)

    setEditorOpen(true)
  }

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
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
    railMode,
    onRailModeChange: setRailMode,
    railQuery,
    onRailQueryChange: setRailQuery,
    pathname,
    activeSessionId,
    activeSessionRepo: activeSession.repo,
    fileEntries: workspace.fileEntries,
    fileLoading: workspace.fileLoading,
    selectedFilePath: workspace.selectedFilePath,
  } as const

  const composerProps = {
    files: composerFiles,
    onFilesChange: setComposerFiles,
    onSubmit: handlePromptSubmit,
    modelOptions,
    pulseModel: pulseModel ?? 'sonnet',
    pulsePermissionLevel,
    onModelChange: (value: string) => setPulseModel(value),
    onPermissionChange: (value: RebootPermissionValue) => setPulsePermissionLevel(value),
    toolsState: composerToolsState,
    onToggleMcpServer: mcp.toggleMcpServer,
  } as const

  return (
    <RebootFrame>
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
              <RebootSidebar
                variant="mobile"
                {...sidebarProps}
                onSelectSession={handleMobileSelectSession}
                onSelectFile={handleMobileFileSelect}
              />
            ) : mobilePane === 'chat' ? (
              <div className="flex h-full min-h-0 flex-col bg-[var(--glass-chat)] backdrop-blur-sm">
                <Conversation className="w-full flex-1 px-3 py-3">
                  <RebootMessageList
                    messages={activeMessages}
                    agentName={activeSession.agent}
                    sessionKey={sessionKey}
                    copiedId={copiedId}
                    copyMessage={copyMessage}
                    onOpenFile={handleMobileOpenFile}
                    isTyping={isTyping}
                    variant="mobile"
                  />
                  <ConversationScrollButton className="animate-scale-in" />
                </Conversation>

                <div className="border-t border-[var(--border-subtle)] px-3 py-3">
                  <RebootPromptComposer compact {...composerProps} />
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
        <section
          className="hidden min-h-0 flex-1 grid-rows-[1fr] transition-[grid-template-columns] duration-300 ease-out lg:grid"
          style={{ gridTemplateColumns }}
        >
          {sidebarOpen ? (
            <aside className="h-full min-h-0 overflow-hidden border-r border-[var(--border-subtle)]">
              <RebootSidebar
                variant="desktop"
                {...sidebarProps}
                onSelectSession={handleSelectSession}
                onSelectFile={handleSidebarFileSelect}
                onCollapse={() => setSidebarOpen(false)}
              />
            </aside>
          ) : (
            <div className="flex h-full w-10 flex-col items-center border-r border-[var(--border-subtle)] bg-[var(--glass-panel)] pt-1">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
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
                      setRailMode(mode.id)
                      setSidebarOpen(true)
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

          {chatOpen ? (
            <div className="h-full min-h-0 overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--glass-chat)] backdrop-blur-sm animate-fade-in">
              <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-[var(--text-primary)]">
                    {activeSession.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-dim)]">
                    <span>{activeSession.agent}</span>
                    <span>·</span>
                    <span>{activeMessages.length} messages</span>
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
                    className={
                      chatOpen ? 'text-[var(--axon-primary)]' : 'text-[var(--text-secondary)]'
                    }
                    onClick={() => setChatOpen((current) => !current)}
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
                    onClick={() => setEditorOpen((current) => !current)}
                  >
                    <PanelRight className="size-4" />
                    <span className="sr-only">Toggle editor</span>
                  </Button>
                </div>
              </div>

              <div className="flex h-[calc(100%-56px)] min-h-0 flex-col">
                <Conversation className="w-full flex-1 px-4 py-4">
                  <RebootMessageList
                    messages={activeMessages}
                    agentName={activeSession.agent}
                    sessionKey={sessionKey}
                    copiedId={copiedId}
                    copyMessage={copyMessage}
                    onOpenFile={openFile}
                    isTyping={isTyping}
                    variant="desktop"
                  />
                  <ConversationScrollButton className="animate-scale-in" />
                </Conversation>

                <div className="border-t border-[var(--border-subtle)] px-4 py-3">
                  <RebootPromptComposer {...composerProps} />
                </div>
              </div>
            </div>
          ) : (
            <RebootPaneHandle label="Chat" side="left" onClick={() => setChatOpen(true)} />
          )}

          {editorOpen ? (
            <aside className="h-full min-h-0 overflow-hidden bg-[var(--glass-editor)] animate-fade-in">
              <PulseEditorPane
                markdown={editorMarkdown}
                onMarkdownChange={setEditorMarkdown}
                scrollStorageKey="axon.web.reboot.editor-scroll"
              />
            </aside>
          ) : (
            <RebootPaneHandle label="Editor" side="right" onClick={() => setEditorOpen(true)} />
          )}
        </section>
      </div>
      <RebootLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
      <RebootTerminalDialog open={terminalOpen} onOpenChange={setTerminalOpen} />
    </RebootFrame>
  )
}
