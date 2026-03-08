'use client'

import { ChevronDown, PanelLeft, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import {
  Queue,
  QueueList,
  QueueSection,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue'
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
import {
  AGENT_ITEMS,
  PAGE_ITEMS,
  RAIL_MODES,
  type RailMode,
  SESSION_ITEMS,
} from './reboot-mock-data'

function railItemClass(isActive: boolean) {
  return isActive
    ? 'border-[var(--axon-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)]'
    : 'border-transparent text-[var(--text-secondary)] hover:border-[rgba(175,215,255,0.18)] hover:bg-[rgba(175,215,255,0.03)] hover:text-[var(--text-primary)]'
}

function isPageActive(pathname: string | null, href: string) {
  if (href === '/cortex/status') return pathname?.startsWith('/cortex') ?? false
  if (href === '/') return pathname === '/'
  return pathname === href
}

function RailContent({
  mode,
  pathname,
  activeSessionId,
  onSelectSession,
  fileEntries,
  fileLoading,
  selectedFilePath,
  onSelectFile,
  query,
}: {
  mode: RailMode
  pathname: string | null
  activeSessionId: string
  onSelectSession: (sessionId: string) => void
  fileEntries: FileEntry[]
  fileLoading: boolean
  selectedFilePath: string | null
  onSelectFile: (entry: FileEntry) => void
  query: string
}) {
  const normalizedQuery = query.trim().toLowerCase()

  if (mode === 'sessions') {
    const filteredSessions = SESSION_ITEMS.filter((session) => {
      if (!normalizedQuery) return true
      return [session.title, session.repo, session.branch, session.agent].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      )
    })

    return (
      <QueueList className="mt-1 space-y-0.5">
        {filteredSessions.map((session) => {
          const isActive = session.id === activeSessionId
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
                    <div className="flex items-start gap-2">
                      {session.hasUnread ? (
                        <span
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--axon-primary)]"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span
                        className={`text-[13px] ${session.hasUnread ? 'font-semibold text-[var(--text-primary)]' : 'font-medium'}`}
                      >
                        {session.title}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--text-dim)]">
                      {session.lastMessageAt}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">
                    {session.repo} · {session.branch} · {session.agent}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </QueueList>
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

  if (mode === 'pages') {
    const filteredPages = PAGE_ITEMS.filter((page) => {
      if (!normalizedQuery) return true
      return page.label.toLowerCase().includes(normalizedQuery)
    })
    const primaryPages = filteredPages.filter((page) => page.group === 'primary')
    const footerPages = filteredPages.filter((page) => page.group === 'footer')

    return (
      <div className="flex min-h-full flex-col">
        <Queue className="rounded-none border-none bg-transparent px-0 pb-0 pt-0 shadow-none">
          <QueueSection defaultOpen>
            <QueueSectionTrigger className="h-8 rounded-none border-b border-[rgba(175,215,255,0.08)] px-0 text-[var(--text-secondary)] hover:bg-transparent hover:text-[var(--text-primary)]">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-dim)]">
                Pages
              </span>
            </QueueSectionTrigger>
            <QueueList className="mt-1 space-y-0.5">
              {primaryPages.map((page) => {
                const Icon = page.icon
                const active = isPageActive(pathname, page.href)
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2 border-l-2 px-3 py-2 text-[13px] transition-colors ${railItemClass(active)}`}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="truncate">{page.label}</span>
                    </Link>
                  </li>
                )
              })}
            </QueueList>
          </QueueSection>
        </Queue>

        {footerPages.length > 0 ? (
          <div className="mt-auto border-t border-[rgba(175,215,255,0.08)] pt-2">
            <QueueList className="space-y-0.5">
              {footerPages.map((page) => {
                const Icon = page.icon
                const active = isPageActive(pathname, page.href)
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2 border-l-2 px-3 py-2 text-[13px] transition-colors ${railItemClass(active)}`}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="truncate">{page.label}</span>
                    </Link>
                  </li>
                )
              })}
            </QueueList>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Queue className="rounded-none border-none bg-transparent px-0 pb-0 pt-0 shadow-none">
      <QueueSection defaultOpen>
        <QueueSectionTrigger className="h-8 rounded-none border-b border-[rgba(175,215,255,0.08)] px-0 text-[var(--text-secondary)] hover:bg-transparent hover:text-[var(--text-primary)]">
          <QueueSectionLabel count={AGENT_ITEMS.length} label="agents" />
        </QueueSectionTrigger>
        <QueueList className="mt-1 space-y-0.5">
          {AGENT_ITEMS.map((agent) => (
            <li key={agent.name}>
              <div className="flex w-full items-start justify-between gap-3 border-l-2 border-transparent px-3 py-2 text-left text-[var(--text-secondary)]">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {agent.name}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{agent.detail}</div>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-[var(--text-dim)]">
                  {agent.status}
                </span>
              </div>
            </li>
          ))}
        </QueueList>
      </QueueSection>
    </Queue>
  )
}

export function RebootSidebar({
  variant,
  railMode,
  onRailModeChange,
  railQuery,
  onRailQueryChange,
  pathname,
  activeSessionId,
  activeSessionRepo,
  onSelectSession,
  fileEntries,
  fileLoading,
  selectedFilePath,
  onSelectFile,
  onCollapse,
}: {
  variant: 'mobile' | 'desktop'
  railMode: RailMode
  onRailModeChange: (mode: RailMode) => void
  railQuery: string
  onRailQueryChange: (query: string) => void
  pathname: string | null
  activeSessionId: string
  activeSessionRepo: string
  onSelectSession: (sessionId: string) => void
  fileEntries: FileEntry[]
  fileLoading: boolean
  selectedFilePath: string | null
  onSelectFile: (entry: FileEntry) => void
  onCollapse?: () => void
}) {
  const activeMode = RAIL_MODES.find((mode) => mode.id === railMode) ?? RAIL_MODES[0]!
  const ActiveModeIcon = activeMode.icon
  const isDesktop = variant === 'desktop'
  const toolbarH = isDesktop ? 'h-8' : 'h-10'
  const searchH = isDesktop ? 'h-6 text-xs' : 'h-8 text-[13px]'
  const subtitle =
    railMode === 'sessions'
      ? activeSessionRepo
      : railMode === 'files'
        ? 'workspace root'
        : railMode === 'pages'
          ? 'navigation'
          : 'assistant lanes'

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
            className={`flex ${isDesktop ? 'size-6' : 'size-8'} items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--text-primary)]`}
          >
            <Plus className="size-3.5" />
            <span className="sr-only">New item</span>
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
                : railMode === 'files'
                  ? 'Search files...'
                  : 'Search...'
            }
            aria-label={`Search ${activeMode.label.toLowerCase()}`}
            className={`${searchH} w-full border border-[var(--border-subtle)] bg-[rgba(10,18,35,0.32)] pl-7 pr-2 text-[var(--text-secondary)] placeholder:text-[var(--text-dim)] focus:border-[rgba(175,215,255,0.18)] focus:outline-none`}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-1">
        <RailContent
          mode={railMode}
          pathname={pathname}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
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
