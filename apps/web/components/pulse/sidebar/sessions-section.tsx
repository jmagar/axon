'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useWsMessageActions } from '@/hooks/use-ws-messages'

const ACTIVE_SESSION_ID_KEY = 'axon.web.pulse.active-session-id'

function formatRelativeTime(mtimeMs: number): string {
  const diffMs = Date.now() - mtimeMs
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

export function SessionsSection() {
  const router = useRouter()
  const { resumeWorkspaceSession } = useWsMessageActions()
  const { sessions, isLoading, error, loadSession, reload } = useRecentSessions()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(ACTIVE_SESSION_ID_KEY)
  })

  useEffect(() => {
    function syncActiveSessionFromStorage() {
      try {
        setActiveSessionId(window.localStorage.getItem(ACTIVE_SESSION_ID_KEY))
      } catch {
        setActiveSessionId(null)
      }
    }
    function onActiveSessionChanged(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string | null }>).detail
      setActiveSessionId(detail?.sessionId ?? null)
    }
    window.addEventListener('focus', syncActiveSessionFromStorage)
    window.addEventListener('storage', syncActiveSessionFromStorage)
    window.addEventListener('axon:active-session-changed', onActiveSessionChanged as EventListener)
    return () => {
      window.removeEventListener('focus', syncActiveSessionFromStorage)
      window.removeEventListener('storage', syncActiveSessionFromStorage)
      window.removeEventListener(
        'axon:active-session-changed',
        onActiveSessionChanged as EventListener,
      )
    }
  }, [])

  async function handleOpenSession(id: string) {
    if (loadingId) return
    setLoadingId(id)
    setFailedId(null)
    try {
      const ok = await loadSession(id)
      if (!ok) {
        setFailedId(id)
        return
      }
      router.push('/')
    } catch {
      setFailedId(id)
    } finally {
      setLoadingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="px-3 py-4 text-center text-[length:var(--text-md)] text-[var(--text-dim)]">
        Loading sessions...
      </div>
    )
  }

  if (sessions.length === 0 && !activeSessionId) {
    return (
      <div className="px-3 py-6 text-center text-[length:var(--text-md)] text-[var(--text-dim)]">
        No recent sessions
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-2 pb-2">
      {activeSessionId && (
        <button
          type="button"
          onClick={() => {
            resumeWorkspaceSession(activeSessionId)
            router.push('/')
          }}
          className="mb-2 w-full rounded border border-[rgba(175,215,255,0.3)] bg-[rgba(175,215,255,0.08)] px-2 py-1.5 text-left text-[length:var(--text-xs)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-standard)] hover:bg-[rgba(175,215,255,0.12)]"
          title={activeSessionId}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--axon-primary)]">
            Current conversation
          </p>
          <p className="truncate">Back to active conversation</p>
        </button>
      )}
      {error && (
        <div className="mb-2 rounded border border-[rgba(255,135,175,0.3)] bg-[rgba(255,135,175,0.08)] px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--axon-secondary)]">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-1 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:border-[var(--border-standard)]"
          >
            Retry
          </button>
        </div>
      )}
      <div className="space-y-1">
        {sessions.slice(0, 20).map((session) => {
          const isLoadingRow = loadingId === session.id
          const isFailedRow = failedId === session.id
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => void handleOpenSession(session.id)}
              disabled={isLoadingRow}
              className="w-full rounded border border-[var(--border-subtle)] bg-[rgba(10,18,35,0.45)] px-2 py-1.5 text-left transition-colors hover:border-[var(--border-standard)] hover:bg-[var(--surface-float)] disabled:opacity-60"
              title={session.filename}
            >
              {session.project !== 'tmp' && (
                <p className="truncate text-[10px] font-semibold text-[var(--axon-secondary)]">
                  {session.project}
                </p>
              )}
              <p className="truncate text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                {session.preview ?? session.filename}
              </p>
              <p
                className={`text-[10px] ${
                  isFailedRow ? 'text-[var(--axon-secondary)]' : 'text-[var(--text-dim)]'
                }`}
              >
                {isLoadingRow
                  ? 'Loading…'
                  : isFailedRow
                    ? 'Failed to load'
                    : formatRelativeTime(session.mtimeMs)}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
