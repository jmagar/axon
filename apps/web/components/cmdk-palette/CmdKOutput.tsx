'use client'

import { type RefObject, useEffect, useRef } from 'react'
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

interface CmdKHeaderProps {
  mode: ModeDefinition
  phase: 'running' | 'done'
  elapsedMs: number | null
  exitCode: number | null
  errorMsg: string | null
  isSuccess: boolean
  onCancel: () => void
}

interface CmdKAsyncProgressProps {
  progress: PaletteProgress
}

interface CmdKOutputLinesProps {
  lines: string[]
  scrollRef: RefObject<HTMLDivElement | null>
}

interface CmdKFooterProps {
  mode: ModeDefinition
  phase: 'running' | 'done'
  jobId: string | null
  isAsync: boolean
  onDismiss: () => void
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

function CmdKHeader({
  mode,
  phase,
  elapsedMs,
  exitCode,
  errorMsg,
  isSuccess,
  onCancel,
}: CmdKHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px 12px',
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
            color: 'var(--axon-secondary)',
            background: 'var(--axon-danger-bg)',
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
  )
}

function CmdKAsyncProgress({ progress }: CmdKAsyncProgressProps) {
  return (
    <div style={{ padding: '12px 20px 8px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 8,
        }}
      >
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
  )
}

function CmdKOutputLines({ lines, scrollRef }: CmdKOutputLinesProps) {
  if (lines.length === 0) return null

  return (
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
  )
}

function CmdKFooter({ mode, phase, jobId, isAsync, onDismiss }: CmdKFooterProps) {
  if (phase !== 'done') return null

  return (
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
            color: 'var(--text-muted)',
            textDecoration: 'none',
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
  )
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
  const isSuccess = !errorMsg && exitCode === 0

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — lines triggers scroll, scrollHeight is read from DOM not state
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <CmdKHeader
        mode={mode}
        phase={phase}
        elapsedMs={elapsedMs}
        exitCode={exitCode}
        errorMsg={errorMsg}
        isSuccess={isSuccess}
        onCancel={onCancel}
      />
      {isAsync && progress && <CmdKAsyncProgress progress={progress} />}
      <CmdKOutputLines lines={lines} scrollRef={scrollRef} />
      <CmdKFooter mode={mode} phase={phase} jobId={jobId} isAsync={isAsync} onDismiss={onDismiss} />
    </div>
  )
}
