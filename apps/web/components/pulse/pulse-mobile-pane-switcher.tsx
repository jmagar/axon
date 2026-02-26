'use client'

import { MessageSquare, PenLine } from 'lucide-react'

interface PulseMobilePaneSwitcherProps {
  mobilePane: 'chat' | 'editor'
  onMobilePaneChange: (pane: 'chat' | 'editor') => void
}

export function PulseMobilePaneSwitcher({
  mobilePane,
  onMobilePaneChange,
}: PulseMobilePaneSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="Mobile pane switcher"
      className="inline-flex items-center gap-1 rounded-md border border-[rgba(255,135,175,0.16)] bg-[rgba(10,18,35,0.42)] p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mobilePane === 'chat'}
        aria-label="Show chat pane"
        onClick={() => onMobilePaneChange('chat')}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[length:var(--text-2xs)] transition-colors ${
          mobilePane === 'chat'
            ? 'bg-[rgba(175,215,255,0.18)] text-[var(--axon-accent-pink-strong)]'
            : 'text-[var(--axon-text-dim)]'
        }`}
      >
        <MessageSquare className="size-3" />
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mobilePane === 'editor'}
        aria-label="Show editor pane"
        onClick={() => onMobilePaneChange('editor')}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[length:var(--text-2xs)] transition-colors ${
          mobilePane === 'editor'
            ? 'bg-[rgba(175,215,255,0.18)] text-[var(--axon-accent-pink-strong)]'
            : 'text-[var(--axon-text-dim)]'
        }`}
      >
        <PenLine className="size-3" />
        Editor
      </button>
    </div>
  )
}
