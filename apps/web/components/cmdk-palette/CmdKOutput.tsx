'use client'

import { useEffect, useRef } from 'react'
import type { ModeDefinition } from '@/lib/ws-protocol'
import type { PaletteProgress } from './CmdKPalette'

interface Props {
  mode: ModeDefinition
  lines: string[]
  progress: PaletteProgress | null
  exitCode: number | null
  errorMsg: string | null
  elapsedMs: number | null
  jobId: string | null
  onDismiss: () => void
  onCancel: () => void
  phase: 'running' | 'done'
}

const ASYNC_MODES = new Set(['crawl', 'embed', 'github', 'reddit', 'youtube', 'extract'])
const URL_MODES = new Set(['scrape', 'crawl', 'map', 'extract', 'retrieve'])

function classifyLine(line: string): 'json' | 'error' | 'log' {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (/error|failed|panic/i.test(trimmed)) return 'error'
  return 'log'
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function CmdKOutput({
  mode,
  lines,
  progress,
  exitCode,
  errorMsg,
  elapsedMs,
  jobId,
  onDismiss,
  onCancel,
  phase,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAsync = ASYNC_MODES.has(mode.id)

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — lines triggers scroll, scrollHeight is read from DOM not state
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const isSuccess = !errorMsg && exitCode === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px 12px',
          // Design system: --border-subtle for section dividers
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--axon-primary)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={mode.icon} />
          </svg>
          <span
            className="ui-chip"
            style={{
              color: 'var(--axon-primary)',
              letterSpacing: '0.1em',
            }}
          >
            {mode.label}
          </span>
          {/* Running indicator — design system: animate-breathing for idle indicators */}
          {phase === 'running' && (
            <span
              className="animate-breathing"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
            >
              ●
            </span>
          )}
        </div>

        {phase === 'running' ? (
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              // Design system: --axon-secondary = pink for error/alert actions
              color: 'var(--axon-secondary)',
              // Design system: --axon-danger-bg for error-tinted backgrounds
              background: 'var(--axon-danger-bg)',
              // Design system: --border-accent for pink-tinted controls
              border: '1px solid var(--border-accent)',
              borderRadius: 6,
              padding: '3px 10px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {elapsedMs !== null && (
              <span className="ui-meta" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatElapsed(elapsedMs)}
              </span>
            )}
            {/* Exit badge — design system: --axon-success / --axon-secondary for status */}
            <span
              className="ui-chip-status"
              style={{
                color: isSuccess ? 'var(--axon-success)' : 'var(--axon-secondary)',
                background: isSuccess ? 'var(--axon-success-bg)' : 'var(--axon-danger-bg)',
                border: `1px solid ${isSuccess ? 'var(--axon-success-border)' : 'var(--border-accent)'}`,
              }}
            >
              {errorMsg ? 'ERROR' : isSuccess ? 'OK' : `EXIT ${exitCode ?? 1}`}
            </span>
          </div>
        )}
      </div>

      {/* Async progress bar */}
      {isAsync && progress && (
        <div style={{ padding: '12px 20px 8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 8,
            }}
          >
            {/* Phase label — design system: ui-chip for uppercase labels */}
            <span className="ui-chip" style={{ color: 'var(--text-muted)' }}>
              {progress.phase}
            </span>
            {progress.processed !== undefined && progress.total !== undefined && (
              <span className="ui-meta" style={{ fontFamily: 'var(--font-mono)' }}>
                {progress.processed}/{progress.total}
              </span>
            )}
            {progress.percent !== undefined && (
              <span
                className="ui-meta"
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--axon-primary)',
                }}
              >
                {Math.round(progress.percent)}%
              </span>
            )}
          </div>
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: 'var(--surface-primary)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress.percent ?? 0}%`,
                background: 'var(--axon-primary)',
                borderRadius: 2,
                transition: 'width 300ms ease',
                boxShadow: '0 0 8px rgba(135, 175, 255, 0.45)',
              }}
            />
          </div>
        </div>
      )}

      {/* Output lines */}
      {lines.length > 0 && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 300,
            overflowY: 'auto',
            padding: '10px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {lines.map((line, i) => {
            const kind = classifyLine(line)
            // Design system text tokens:
            // JSON → --axon-primary (actionable/interactive)
            // Error → --axon-secondary (alert state)
            // Log → --text-secondary (default content)
            const color =
              kind === 'json'
                ? 'var(--axon-primary)'
                : kind === 'error'
                  ? 'var(--axon-secondary)'
                  : 'var(--text-secondary)'
            return (
              <div
                key={i}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 'var(--leading-copy)',
                  color,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {line}
              </div>
            )
          })}
        </div>
      )}

      {/* Done footer */}
      {phase === 'done' && (
        <div
          style={{
            padding: '10px 20px 14px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {jobId && (URL_MODES.has(mode.id) || isAsync) && (
            <a
              href={`/jobs/${jobId}`}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                // Design system: --text-muted for subdued links
                color: 'var(--text-muted)',
                textDecoration: 'none',
                // Design system: --border-subtle for passive controls
                border: '1px solid var(--border-subtle)',
                borderRadius: 5,
                padding: '3px 10px',
              }}
            >
              View Job ↗
            </a>
          )}
          <button
            type="button"
            onClick={onDismiss}
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 5,
              padding: '3px 10px',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
