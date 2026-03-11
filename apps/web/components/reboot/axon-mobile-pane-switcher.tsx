'use client'

import {
  Brain,
  MessageSquare,
  Network,
  PenLine,
  ScrollText,
  Settings2,
  TerminalSquare,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { MobilePane } from '@/hooks/use-split-pane'

interface AxonMobilePaneSwitcherProps {
  mobilePane: MobilePane
  onMobilePaneChange: (pane: MobilePane) => void
}

const PANE_BUTTONS: {
  id: MobilePane
  Icon: ComponentType<{ className?: string }>
  label: string
  activeClass: string
}[] = [
  {
    id: 'chat',
    Icon: MessageSquare,
    label: 'Chat pane',
    activeClass: 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]',
  },
  {
    id: 'editor',
    Icon: PenLine,
    label: 'Editor pane',
    activeClass: 'border-[rgba(255,135,175,0.25)] bg-[var(--axon-secondary)] text-[var(--axon-bg)]',
  },
  {
    id: 'terminal',
    Icon: TerminalSquare,
    label: 'Terminal pane',
    activeClass: 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]',
  },
  {
    id: 'logs',
    Icon: ScrollText,
    label: 'Logs pane',
    activeClass: 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]',
  },
  {
    id: 'mcp',
    Icon: Network,
    label: 'MCP pane',
    activeClass: 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]',
  },
  {
    id: 'cortex',
    Icon: Brain,
    label: 'Cortex pane',
    activeClass: 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]',
  },
  {
    id: 'settings',
    Icon: Settings2,
    label: 'Settings pane',
    activeClass: 'border-[rgba(175,215,255,0.25)] bg-[var(--axon-primary)] text-[var(--axon-bg)]',
  },
]

const INACTIVE_CLASS =
  'border-[var(--border-subtle)] bg-[rgba(10,18,35,0.42)] text-[var(--text-dim)] hover:border-[rgba(175,215,255,0.25)] hover:text-[var(--axon-primary-strong)]'

export function AxonMobilePaneSwitcher({
  mobilePane,
  onMobilePaneChange,
}: AxonMobilePaneSwitcherProps) {
  return (
    <div role="tablist" aria-label="Workspace pane" className="inline-flex items-center gap-0.5">
      {PANE_BUTTONS.map(({ id, Icon, label, activeClass }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mobilePane === id}
          aria-label={label}
          onClick={() => onMobilePaneChange(id)}
          className={`inline-flex size-6 items-center justify-center rounded border transition-all duration-200 backdrop-blur-sm ${
            mobilePane === id ? activeClass : INACTIVE_CLASS
          }`}
        >
          <Icon className="size-3" />
        </button>
      ))}
    </div>
  )
}
