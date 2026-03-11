'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalHandle } from '@/components/terminal/terminal-emulator'
import { useShellSession } from '@/hooks/use-shell-session'

const TerminalEmulatorWrapper = dynamic(
  () =>
    import('@/components/terminal/terminal-emulator-wrapper').then((m) => ({
      default: m.TerminalEmulatorWrapper,
    })),
  { ssr: false },
)

export function PulseTerminalPane() {
  const paneRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<TerminalHandle | null>(null)
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchVisibleRef = useRef(searchVisible)

  const { sendInput, resize } = useShellSession({
    onOutput: (data) => terminalRef.current?.write(data),
  })

  const handleData = useCallback(
    (data: string) => {
      sendInput(data)
    },
    [sendInput],
  )
  const handleResize = useCallback(
    (cols: number, rows: number) => {
      resize(cols, rows)
    },
    [resize],
  )
  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val)
    if (val) terminalRef.current?.search(val)
  }, [])

  useEffect(() => {
    searchVisibleRef.current = searchVisible
  }, [searchVisible])

  // Ctrl+F / Cmd+F toggles the search overlay
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeWithinPane =
        !!paneRef.current &&
        !!document.activeElement &&
        paneRef.current.contains(document.activeElement)
      if (isEditableTarget(e.target)) return
      if (!activeWithinPane) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setSearchVisible((prev) => {
          if (prev) {
            setSearchQuery('')
            terminalRef.current?.focus()
            return false
          }
          return true
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div ref={paneRef} className="flex h-full flex-col overflow-hidden">
      <div className="relative flex-1 overflow-hidden p-1.5">
        <div
          className="relative h-full overflow-hidden rounded-xl border"
          style={{
            background: 'rgba(3,7,18,0.95)',
            borderColor: 'var(--axon-border, rgba(255,135,175,0.12))',
          }}
        >
          {searchVisible && (
            <div
              className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md border px-2 py-1"
              style={{ background: 'rgba(9,18,37,0.95)', borderColor: 'rgba(175,215,255,0.2)' }}
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchVisible(false)
                    setSearchQuery('')
                    terminalRef.current?.focus()
                  }
                  if (e.key === 'Enter') terminalRef.current?.search(searchQuery)
                }}
                placeholder="Search..."
                className="w-40 bg-transparent font-mono text-xs outline-none"
                style={{ color: 'var(--text-primary)' }}
                aria-label="Terminal search"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchVisible(false)
                  setSearchQuery('')
                  terminalRef.current?.focus()
                }}
                className="ml-1 text-xs"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Close search"
              >
                ✕
              </button>
            </div>
          )}
          <TerminalEmulatorWrapper
            ref={terminalRef}
            onData={handleData}
            onResize={handleResize}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  )
}
