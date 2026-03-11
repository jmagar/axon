'use client'

import { ChevronDown, PanelLeft, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { FileEntry } from '@/components/workspace/file-tree'
import { FileTree } from '@/components/workspace/file-tree'
import type { SessionSummary } from '@/hooks/use-recent-sessions'
import { RAIL_MODES, type RailMode } from './axon-ui-config'

const AGENT_BADGE: Record<string, { label: string; colorClass: string }> = {
  claude: { label: 'C', colorClass: 'text-[#afd7ff]' },
  codex: { label: 'Cx', colorClass: 'text-[#7dda7d]' },
  gemini: { label: 'G', colorClass: 'text-[#7db8f7]' },
}

function railItemClass(isActive: boolean) {
  return isActive
    ? 'border-[var(--axon-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)]'
    : 'border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.18)] hover:bg-[rgba(175,215,255,0.03)] hover:text-[var(--text-primary)]'
}

function RailContent({
  mode,
  sessions,
  activeSessionId,
  onSelectSession,
  assistantSessions,
  activeAssistantSessionId,
  onSelectAssistantSession,
  fileEntries,
  fileLoading,
  selectedFilePath,
  onSelectFile,
  query,
}: {
  mode: RailMode
  sessions: SessionSummary[]
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  assistantSessions: SessionSummary[]
  activeAssistantSessionId: string | null
  onSelectAssistantSession: (sessionId: string) => void
  fileEntries: FileEntry[]
  fileLoading: boolean
  selectedFilePath: string | null
  onSelectFile: (entry: FileEntry) => void
  query: string
}) {
  const normalizedQuery = query.trim().toLowerCase()

  if (mode === 'sessions') {
    const filteredSessions = sessions.filter((session) => {
      if (!normalizedQuery) return true
      return (
        session.preview?.toLowerCase().includes(normalizedQuery) ||
        session.project?.toLowerCase().includes(normalizedQuery) ||
        session.repo?.toLowerCase().includes(normalizedQuery) ||
        session.branch?.toLowerCase().includes(normalizedQuery)
      )
    })

    return (
      <ul className="mt-1 space-y-0.5">
        {filteredSessions.map((session) => {
          const isActive = session.id === activeSessionId
          const title = session.preview?.slice(0, 60) ?? session.project ?? 'Untitled'
          const meta = session.repo ?? session.project ?? ''
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full border-l-2 px-0 py-2 text-left transition-colors ${railItemClass(isActive)}`}
              >
                <div className="px-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium">{title}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {session.agent && session.agent !== 'claude' ? (
                        <span
                          className={`text-[10px] font-bold uppercase tracking-[0.1em] ${AGENT_BADGE[session.agent]?.colorClass ?? ''}`}
                        >
                          {AGENT_BADGE[session.agent]?.label}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-[var(--text-dim)]">
                        {formatRelativeTime(session.mtimeMs)}
                      </span>
                    </div>
                  </div>
                  {meta ? (
                    <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{meta}</div>
                  ) : null}
                  {session.branch ? (
                    <span className="text-xs text-muted-foreground">{session.branch}</span>
                  ) : null}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  if (mode === 'files') {
    const filteredFileEntries = !normalizedQuery
      ? fileEntries
      : fileEntries.filter((entry) => entry.path.toLowerCase().includes(normalizedQuery))

    if (fileLoading) {
      return <div className="px-3 py-4 text-xs text-[var(--text-dim)]">Loading workspace...</div>
    }

    return (
      <div className="pt-1">
        <FileTree
          entries={filteredFileEntries}
          selectedPath={selectedFilePath}
          onSelect={onSelectFile}
        />
      </div>
    )
  }

  if (mode === 'assistant') {
    const filteredSessions = assistantSessions.filter((session) => {
      if (!normalizedQuery) return true
      return session.preview?.toLowerCase().includes(normalizedQuery) ?? false
    })

    return (
      <ul className="mt-1 space-y-0.5">
        {filteredSessions.length === 0 ? (
          <li className="px-3 py-4 text-xs text-[var(--text-dim)]">
            No assistant chats yet. Start a conversation below.
          </li>
        ) : null}
        {filteredSessions.map((session) => {
          const isActive = session.id === activeAssistantSessionId
          const title = session.preview?.slice(0, 60) ?? 'Untitled'
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelectAssistantSession(session.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full border-l-2 px-0 py-2 text-left transition-colors ${railItemClass(isActive)}`}
              >
                <div className="px-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium">{title}</span>
                    <span className="text-[11px] text-[var(--text-dim)]">
                      {formatRelativeTime(session.mtimeMs)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return null
}

export function AxonSidebar({
  variant,
  sessions,
  railMode,
  onRailModeChange,
  railQuery,
  onRailQueryChange,
  activeSessionId,
  activeSessionRepo,
  onSelectSession,
  assistantSessions,
  activeAssistantSessionId,
  onSelectAssistantSession,
  fileEntries,
  fileLoading,
  selectedFilePath,
  onSelectFile,
  onCollapse,
  onNewSession,
}: {
  variant: 'mobile' | 'desktop'
  sessions: SessionSummary[]
  railMode: RailMode
  onRailModeChange: (mode: RailMode) => void
  railQuery: string
  onRailQueryChange: (query: string) => void
  activeSessionId: string | null
  activeSessionRepo: string
  onSelectSession: (sessionId: string) => void
  assistantSessions: SessionSummary[]
  activeAssistantSessionId: string | null
  onSelectAssistantSession: (sessionId: string) => void
  fileEntries: FileEntry[]
  fileLoading: boolean
  selectedFilePath: string | null
  onSelectFile: (entry: FileEntry) => void
  onCollapse?: () => void
  onNewSession?: () => void
}) {
  const activeMode = RAIL_MODES.find((mode) => mode.id === railMode) ?? RAIL_MODES[0]!
  const ActiveModeIcon = activeMode.icon
  const isDesktop = variant === 'desktop'
  const toolbarH = isDesktop ? 'h-8' : 'h-10'
  const searchH = isDesktop ? 'h-6 text-xs' : 'h-8 text-[13px]'
  const subtitle =
    railMode === 'sessions'
      ? activeSessionRepo
      : railMode === 'assistant'
        ? 'assistant'
        : 'workspace root'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--glass-panel)] animate-fade-in">
      <div
        className={`flex ${toolbarH} items-center justify-between border-b border-[var(--border-subtle)] px-2`}
      >
        <div className="flex items-center gap-1">
          {isDesktop && onCollapse ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={onCollapse}
              >
                <PanelLeft className="size-4" />
                <span className="sr-only">Collapse sidebar</span>
              </Button>
              <div className="h-4 w-px bg-[var(--border-subtle)]" />
            </>
          ) : null}
          {isDesktop ? (
            <span
              className="select-none pl-1 text-sm font-extrabold tracking-[3px]"
              style={{
                background: 'linear-gradient(135deg, #afd7ff 0%, #ff87af 50%, #8787af 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              AXON
            </span>
          ) : null}
          {!isDesktop ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 pl-1 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--axon-primary)]"
                >
                  <ActiveModeIcon className="size-3.5 text-[var(--axon-primary)]" />
                  <span>{activeMode.label}</span>
                  <span className="text-[11px] font-normal text-[var(--text-dim)]">{subtitle}</span>
                  <ChevronDown className="size-3 text-[var(--text-dim)]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-[220px] border-[var(--border-subtle)] bg-[var(--glass-overlay)] text-[var(--text-primary)] backdrop-blur-xl"
              >
                {RAIL_MODES.map((mode) => {
                  const Icon = mode.icon
                  return (
                    <DropdownMenuItem
                      key={mode.id}
                      onClick={() => onRailModeChange(mode.id)}
                      className="gap-2 text-sm"
                    >
                      <Icon className="size-4 text-[var(--axon-primary)]" />
                      {mode.label}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewSession}
            className={`flex ${isDesktop ? 'size-6' : 'size-8'} items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--text-primary)]`}
          >
            <Plus className="size-3.5" />
            <span className="sr-only">New session</span>
          </button>
        </div>
      </div>

      {isDesktop ? (
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 pl-1 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--axon-primary)]"
              >
                <ActiveModeIcon className="size-3.5 text-[var(--axon-primary)]" />
                <span>{activeMode.label}</span>
                <span className="text-[11px] font-normal text-[var(--text-dim)]">{subtitle}</span>
                <ChevronDown className="size-3 text-[var(--text-dim)]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-[220px] border-[var(--border-subtle)] bg-[var(--glass-overlay)] text-[var(--text-primary)] backdrop-blur-xl"
            >
              {RAIL_MODES.map((mode) => {
                const Icon = mode.icon
                return (
                  <DropdownMenuItem
                    key={mode.id}
                    onClick={() => onRailModeChange(mode.id)}
                    className="gap-2 text-sm"
                  >
                    <Icon className="size-4 text-[var(--axon-primary)]" />
                    {mode.label}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      <div className="border-b border-[var(--border-subtle)] px-2 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-dim)]" />
          <input
            value={railQuery}
            onChange={(event) => onRailQueryChange(event.target.value)}
            placeholder={
              railMode === 'sessions'
                ? 'Search sessions...'
                : railMode === 'assistant'
                  ? 'Search assistant chats...'
                  : 'Search files...'
            }
            aria-label={`Search ${activeMode.label.toLowerCase()}`}
            className={`${searchH} w-full rounded-md border border-[var(--border-subtle)] bg-[rgba(10,18,35,0.32)] pl-7 pr-2 font-sans text-[var(--text-secondary)] placeholder:text-[var(--text-dim)] focus:border-[rgba(175,215,255,0.18)] focus:outline-none`}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-1">
        <RailContent
          mode={railMode}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
          assistantSessions={assistantSessions}
          activeAssistantSessionId={activeAssistantSessionId}
          onSelectAssistantSession={onSelectAssistantSession}
          fileEntries={fileEntries}
          fileLoading={fileLoading}
          selectedFilePath={selectedFilePath}
          onSelectFile={onSelectFile}
          query={railQuery}
        />
      </ScrollArea>
    </div>
  )
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}
