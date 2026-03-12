'use client'

import { SiAnthropic, SiGoogle } from '@icons-pack/react-simple-icons'
import { ChevronDown, PanelLeft, Plus, Search } from 'lucide-react'
import { SiOpenai } from 'react-icons/si'
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
import {
  formatLastMessageTime,
  formatSessionSubtitle,
  formatSessionTitle,
} from './axon-sidebar-utils'
import { RAIL_MODES, type RailMode } from './axon-ui-config'

const AGENT_BADGE: Record<string, { label: string; colorClass: string }> = {
  claude: { label: 'C', colorClass: 'text-[#d4b07a]' },
  codex: { label: 'O', colorClass: 'text-[#9ad1ff]' },
  gemini: { label: 'G', colorClass: 'text-[#7db8f7]' },
}

function AgentLogo({ agent }: { agent?: string }) {
  const normalized = (agent ?? 'claude').toLowerCase()
  if (normalized === 'gemini') {
    return <SiGoogle className="size-3.5 text-[#8ab4f8]" title="Google (Gemini)" />
  }
  if (normalized === 'codex') {
    return <SiOpenai className="size-3.5 text-[#9ad1ff]" title="OpenAI (Codex)" />
  }
  return <SiAnthropic className="size-3.5 text-[#d4b07a]" title="Anthropic (Claude)" />
}

function railItemClass(isActive: boolean) {
  return isActive
    ? 'border-[rgba(175,215,255,0.56)] bg-[linear-gradient(140deg,rgba(135,175,255,0.18),rgba(135,175,255,0.06))] text-[var(--text-primary)] shadow-[0_0_18px_rgba(135,175,255,0.16)]'
    : 'border-transparent bg-[rgba(6,11,24,0.34)] text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.24)] hover:bg-[rgba(175,215,255,0.08)] hover:text-[var(--text-primary)]'
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
  onNewSession,
  compact = false,
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
  onNewSession?: () => void
  compact?: boolean
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const rowClass = compact ? 'py-1.5' : 'py-2'

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
        {filteredSessions.length === 0 ? (
          <li className="px-3 py-4">
            <div className="rounded-lg border border-dashed border-[rgba(175,215,255,0.26)] bg-[rgba(175,215,255,0.06)] p-3 text-left">
              <p className="text-[12px] font-medium text-[var(--text-primary)]">No sessions yet</p>
              <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                Start one from the + button above.
              </p>
              {onNewSession ? (
                <button
                  type="button"
                  onClick={onNewSession}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[rgba(175,215,255,0.32)] bg-[linear-gradient(145deg,rgba(135,175,255,0.24),rgba(135,175,255,0.1))] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)]"
                >
                  <Plus className="size-3" />
                  New session
                </button>
              ) : null}
            </div>
          </li>
        ) : null}
        {filteredSessions.map((session) => {
          const isActive = session.id === activeSessionId
          const title = formatSessionTitle(session.preview, session.project)
          const meta = formatSessionSubtitle(session.repo, session.project, session.branch)
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full rounded-md border-l-2 px-0 text-left transition-colors ${rowClass} ${railItemClass(isActive)}`}
                title={session.preview?.slice(0, 120) ?? title}
              >
                <div className="px-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="max-w-[78%] truncate text-[13px] font-medium">{title}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <AgentLogo agent={session.agent} />
                      <span
                        className={`text-[10px] font-bold uppercase tracking-[0.1em] ${AGENT_BADGE[session.agent ?? 'claude']?.colorClass ?? ''}`}
                      >
                        {AGENT_BADGE[session.agent ?? 'claude']?.label ?? 'C'}
                      </span>
                      <span className="text-[11px] text-[var(--text-dim)]">
                        {formatLastMessageTime(session.mtimeMs)}
                      </span>
                    </div>
                  </div>
                  {meta ? (
                    <div
                      className="mt-0.5 truncate text-[11px] text-[var(--text-dim)]"
                      title={`Workspace context: ${meta}`}
                    >
                      {meta}
                    </div>
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
          <li className="px-3 py-4">
            <div className="rounded-lg border border-dashed border-[rgba(255,135,175,0.28)] bg-[rgba(255,135,175,0.06)] p-3 text-left">
              <p className="text-[12px] font-medium text-[var(--text-primary)]">
                No assistant chats yet
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                Kick one off with the + button above.
              </p>
              {onNewSession ? (
                <button
                  type="button"
                  onClick={onNewSession}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[rgba(255,135,175,0.34)] bg-[linear-gradient(145deg,rgba(255,135,175,0.24),rgba(255,135,175,0.08))] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)]"
                >
                  <Plus className="size-3" />
                  New assistant chat
                </button>
              ) : null}
            </div>
          </li>
        ) : null}
        {filteredSessions.map((session) => {
          const isActive = session.id === activeAssistantSessionId
          const title = formatSessionTitle(session.preview, undefined)
          const meta = formatSessionSubtitle(session.repo, session.project, session.branch)
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelectAssistantSession(session.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full rounded-md border-l-2 px-0 text-left transition-colors ${rowClass} ${railItemClass(isActive)}`}
                title={session.preview ?? title}
              >
                <div className="px-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="max-w-[80%] truncate text-[13px] font-medium">{title}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <AgentLogo agent={session.agent} />
                      <span
                        className={`text-[10px] font-bold uppercase tracking-[0.1em] ${AGENT_BADGE[session.agent ?? 'claude']?.colorClass ?? ''}`}
                      >
                        {AGENT_BADGE[session.agent ?? 'claude']?.label ?? 'C'}
                      </span>
                      <span className="text-[11px] text-[var(--text-dim)]">
                        {formatLastMessageTime(session.mtimeMs)}
                      </span>
                    </div>
                  </div>
                  {meta ? (
                    <div
                      className="mt-0.5 truncate text-[11px] text-[var(--text-dim)]"
                      title={`Workspace context: ${meta}`}
                    >
                      {meta}
                    </div>
                  ) : null}
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
    <div className="axon-glass-panel flex h-full min-h-0 flex-col animate-fade-in">
      <div className={`axon-toolbar flex ${toolbarH} items-center justify-between px-2`}>
        <div className="flex items-center gap-1">
          {isDesktop && onCollapse ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 border border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.2)] hover:bg-[rgba(175,215,255,0.07)] hover:text-[var(--text-primary)]"
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
          {isDesktop ? (
            <button
              type="button"
              onClick={onNewSession}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[rgba(175,215,255,0.34)] bg-[linear-gradient(145deg,rgba(135,175,255,0.28),rgba(135,175,255,0.1))] px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)] shadow-[0_0_14px_rgba(135,175,255,0.2)] transition-colors hover:border-[rgba(175,215,255,0.48)] hover:bg-[linear-gradient(145deg,rgba(135,175,255,0.36),rgba(135,175,255,0.14))]"
            >
              <Plus className="size-3.5" />
              New
            </button>
          ) : (
            <button
              type="button"
              onClick={onNewSession}
              className={`inline-flex ${isDesktop ? 'size-6' : 'size-8'} items-center justify-center rounded-md border border-[rgba(175,215,255,0.34)] bg-[linear-gradient(145deg,rgba(135,175,255,0.28),rgba(135,175,255,0.1))] text-[var(--text-primary)] shadow-[0_0_14px_rgba(135,175,255,0.2)]`}
            >
              <Plus className="size-3.5" />
              <span className="sr-only">New session</span>
            </button>
          )}
        </div>
      </div>

      {isDesktop ? (
        <div className="axon-toolbar flex items-center justify-between px-2 py-1">
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
            className={`axon-input ${searchH} w-full rounded-md pl-7 pr-2 font-sans`}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 bg-[rgba(6,11,24,0.2)] px-2 py-1">
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
          onNewSession={onNewSession}
          compact={!isDesktop}
        />
      </ScrollArea>
    </div>
  )
}
