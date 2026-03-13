'use client'

import { serializeMd } from '@platejs/markdown'
import { Check, Copy } from 'lucide-react'
import type { usePlateEditor } from 'platejs/react'
import { useEffect, useRef, useState } from 'react'

/** Read-only panel showing the raw Markdown or JSON source of the current document. */
export function SourceViewPanel({
  mode,
  editor,
}: {
  mode: 'markdown' | 'json'
  editor: ReturnType<typeof usePlateEditor>
  onClose: () => void
}) {
  const content =
    editor == null
      ? ''
      : mode === 'json'
        ? JSON.stringify(editor.children, null, 2)
        : serializeMd(editor)

  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center justify-between px-3 py-1.5"
        style={{ boxShadow: '0 1px 0 rgba(135, 175, 255, 0.07)' }}
      >
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
          {mode === 'json' ? 'JSON Document' : 'Markdown Source'}
        </span>
        <span className="text-[10px] text-[var(--text-dim)] opacity-50">read-only</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex h-6 items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-input)] px-2 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-standard)] hover:text-[var(--text-primary)]"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[rgba(4,8,20,0.55)]">
        <pre className="p-6 font-mono text-xs leading-[1.7] text-[var(--text-secondary)] whitespace-pre">
          {content}
        </pre>
      </div>
    </div>
  )
}
