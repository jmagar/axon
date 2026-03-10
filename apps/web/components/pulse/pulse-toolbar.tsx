'use client'

import { Network, PenLine, Plus, ScrollText, Settings2, TerminalSquare } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import type { RightPanelId } from '@/lib/pulse/types'

interface PulseToolbarProps {
  title: string
  onTitleChange: (title: string) => void
  isDesktop?: boolean
  onNewSession?: () => void
  rightPanel?: RightPanelId | null
  onTogglePanel?: (id: RightPanelId) => void
}

const PANEL_BUTTONS: {
  id: RightPanelId
  Icon: ComponentType<{ className?: string }>
  label: string
}[] = [
  { id: 'editor', Icon: PenLine, label: 'Editor [⌘⇧E]' },
  { id: 'terminal', Icon: TerminalSquare, label: 'Terminal [⌘⇧T]' },
  { id: 'logs', Icon: ScrollText, label: 'Logs [⌘⇧L]' },
  { id: 'mcp', Icon: Network, label: 'MCP Servers [⌘⇧M]' },
  { id: 'settings', Icon: Settings2, label: 'Settings [⌘⇧S]' },
]

export function PulseToolbar({
  title,
  onTitleChange,
  isDesktop = false,
  onNewSession,
  rightPanel = null,
  onTogglePanel,
}: PulseToolbarProps) {
  const [isDirty, setIsDirty] = useState(false)
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-x-[var(--pulse-control-gap)] border-b border-[var(--border-subtle)] bg-[rgba(10,18,35,0.65)] px-[var(--space-2)] py-[var(--space-2)] backdrop-blur-sm">
      <div className="relative flex min-w-0 flex-1 sm:flex-none sm:w-[40ch]">
        <input
          id="pulse-document-title"
          name="pulse_document_title"
          value={title}
          onChange={(e) => {
            onTitleChange(e.target.value)
            setIsDirty(true)
          }}
          className="w-full rounded-md border border-transparent bg-transparent px-[var(--space-2)] py-[var(--pulse-pill-pad-y)] text-[length:var(--text-md)] font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--border-standard)] focus:bg-[var(--surface-elevated)]"
          placeholder="Document title..."
        />
        {isDirty && (
          <span
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-[var(--axon-secondary)] animate-pulse"
            title="Unsaved changes"
          />
        )}
      </div>

      {isDesktop && (
        <div className="ml-auto flex items-center gap-1">
          {onTogglePanel && (
            <div className="flex items-center gap-0.5">
              {PANEL_BUTTONS.map(({ id, Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTogglePanel(id)}
                  title={label}
                  aria-pressed={rightPanel === id}
                  className={`inline-flex size-7 items-center justify-center rounded border transition-all duration-150 ${
                    rightPanel === id
                      ? 'border-[rgba(175,215,255,0.35)] bg-[rgba(175,215,255,0.12)] text-[var(--axon-primary-strong)]'
                      : 'border-transparent text-[var(--text-dim)] hover:border-[rgba(175,215,255,0.2)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>
          )}
          {onNewSession && (
            <>
              <span className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={onNewSession}
                title="New session — clears chat and document"
                className="ui-chip inline-flex items-center gap-1 rounded border border-[rgba(95,135,175,0.24)] bg-[rgba(10,18,35,0.45)] px-1.5 py-0.5 text-[var(--text-dim)] transition-colors hover:border-[rgba(175,215,255,0.35)] hover:text-[var(--text-secondary)]"
              >
                <Plus className="size-3" />
                <span className="text-[10px] font-medium leading-none">New</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
