'use client'

import { MessageSquareText, PanelLeft, PanelRight } from 'lucide-react'

const ICONS = {
  Sidebar: PanelLeft,
  Chat: MessageSquareText,
  Editor: PanelRight,
} as const

export function AxonPaneHandle({
  label,
  side,
  onClick,
}: {
  label: string
  side: 'left' | 'right'
  onClick: () => void
}) {
  const Icon = ICONS[label as keyof typeof ICONS] ?? (side === 'left' ? PanelLeft : PanelRight)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Expand ${label}`}
      className={`flex h-full w-10 flex-col items-center justify-start bg-[var(--glass-panel)] pt-2 text-[var(--text-dim)] transition-colors hover:text-[var(--axon-primary)] ${side === 'left' ? 'border-r border-[var(--border-subtle)]' : 'border-l border-[var(--border-subtle)]'}`}
    >
      <span className="flex size-7 items-center justify-center rounded transition-colors hover:bg-[rgba(175,215,255,0.06)]">
        <Icon className="size-3.5" />
      </span>
    </button>
  )
}
