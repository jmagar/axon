'use client'

import { Command } from 'cmdk'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAxonWs } from '@/hooks/use-axon-ws'
import type { WsServerMsg } from '@/lib/ws-protocol'
import {
  MODE_CATEGORY_LABELS,
  MODE_CATEGORY_ORDER,
  MODES,
  type ModeDefinition,
  NO_INPUT_MODES,
} from '@/lib/ws-protocol'
import { CmdKOutput } from './CmdKOutput'

type PalettePhase = 'idle' | 'select' | 'input' | 'running' | 'done'

export interface PaletteProgress {
  phase: string
  percent?: number
  processed?: number
  total?: number
}

const URL_MODES = new Set(['scrape', 'crawl', 'map', 'extract', 'retrieve'])
const PALETTE_CATEGORIES: ReadonlySet<string> = new Set(['content', 'rag'])

interface SelectPanelProps {
  search: string
  setSearch: (value: string) => void
  handleSelectMode: (mode: ModeDefinition) => void
}

function SelectPanel({ search, setSearch, handleSelectMode }: SelectPanelProps) {
  return (
    <Command>
      <div data-cmdk-input-wrapper="">
        <Command.Input
          placeholder="Search commands..."
          value={search}
          onValueChange={setSearch}
          autoFocus
        />
      </div>
      <Command.List>
        <Command.Empty>No commands found.</Command.Empty>
        {MODE_CATEGORY_ORDER.filter((cat) => PALETTE_CATEGORIES.has(cat)).map((cat) => {
          const items = MODES.filter((m) => m.category === cat)
          if (!items.length) return null
          return (
            <Command.Group key={cat} heading={MODE_CATEGORY_LABELS[cat]}>
              {items.map((mode) => (
                <Command.Item
                  key={mode.id}
                  value={`${mode.label} ${mode.id}`}
                  onSelect={() => handleSelectMode(mode)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, opacity: 0.65 }}
                  >
                    <path d={mode.icon} />
                  </svg>
                  {mode.label}
                </Command.Item>
              ))}
            </Command.Group>
          )
        })}
      </Command.List>
    </Command>
  )
}

interface InputPanelProps {
  selectedMode: ModeDefinition
  inputValue: string
  setInputValue: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  onBack: () => void
  handleExecute: () => void
}

function InputPanel({
  selectedMode,
  inputValue,
  setInputValue,
  inputRef,
  onBack,
  handleExecute,
}: InputPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px 6px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-md)',
            padding: '0 4px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ←
        </button>
        <span
          className="ui-chip"
          style={{
            color: 'var(--axon-primary)',
            background: 'var(--surface-primary-active)',
            border: '1px solid var(--border-standard)',
            borderRadius: 5,
            padding: '2px 8px',
          }}
        >
          {selectedMode.label}
        </span>
      </div>
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={URL_MODES.has(selectedMode.id) ? 'https://example.com' : 'What is...'}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleExecute()
        }}
        style={{
          width: '100%',
          background: 'transparent',
          outline: 'none',
          border: 'none',
          color: 'var(--axon-primary)',
          caretColor: 'var(--axon-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-base)',
          padding: '18px 20px',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

interface PaletteDialogProps {
  phase: PalettePhase
  search: string
  setSearch: (value: string) => void
  handleSelectMode: (mode: ModeDefinition) => void
  selectedMode: ModeDefinition | null
  inputValue: string
  setInputValue: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  setPhase: (phase: PalettePhase) => void
  handleExecute: () => void
  lines: string[]
  progress: PaletteProgress | null
  exitCode: number | null
  errorMsg: string | null
  elapsedMs: number | null
  jobId: string | null
  closeToIdle: () => void
  cancelAndClose: () => void
}

function PaletteDialog({
  phase,
  search,
  setSearch,
  handleSelectMode,
  selectedMode,
  inputValue,
  setInputValue,
  inputRef,
  setPhase,
  handleExecute,
  lines,
  progress,
  exitCode,
  errorMsg,
  elapsedMs,
  jobId,
  closeToIdle,
  cancelAndClose,
}: PaletteDialogProps) {
  const onBackdropClick = phase === 'running' ? cancelAndClose : closeToIdle

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss is a recognized UX pattern for modals */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        style={{ zIndex: 100 }}
        onClick={onBackdropClick}
      />

      <div
        className="animate-cmdk-in"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          zIndex: 101,
          width: 'min(640px, 92vw)',
          maxHeight: '70vh',
          background: 'rgba(10, 18, 35, 0.97)',
          border: '1px solid var(--border-standard)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          [cmdk-root] { display: flex; flex-direction: column; flex: 1; min-height: 0; }
          [cmdk-input-wrapper] {
            border-bottom: 1px solid var(--border-subtle);
          }
          [cmdk-input] {
            width: 100%; background: transparent; outline: none; border: none;
            color: var(--axon-primary);
            caret-color: var(--axon-primary);
            font-family: var(--font-mono);
            font-size: var(--text-base);
            padding: 18px 20px;
          }
          [cmdk-input]::placeholder { color: var(--text-dim); }
          [cmdk-list] {
            overflow-y: auto; flex: 1; padding: 6px 8px;
            max-height: calc(70vh - 80px);
          }
          [cmdk-group-heading] {
            font-size: var(--text-2xs);
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--text-dim);
            padding: 8px 10px 4px;
            font-family: var(--font-mono);
          }
          [cmdk-item] {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 12px; border-radius: 8px; cursor: pointer;
            font-family: var(--font-mono);
            font-size: var(--text-md);
            color: var(--text-secondary);
            border-left: 2px solid transparent;
            transition: background 100ms, border-color 100ms, color 100ms;
          }
          [cmdk-item][data-selected=true] {
            background: var(--surface-primary-active);
            border-left-color: var(--axon-primary);
            color: var(--axon-primary);
          }
          [cmdk-item]:hover:not([data-selected=true]) {
            background: var(--surface-primary);
          }
          [cmdk-empty] {
            padding: 24px; text-align: center;
            font-family: var(--font-mono);
            font-size: var(--text-sm);
            color: var(--text-dim);
          }
        `}</style>

        {phase === 'select' && (
          <SelectPanel search={search} setSearch={setSearch} handleSelectMode={handleSelectMode} />
        )}

        {phase === 'input' && selectedMode && (
          <InputPanel
            selectedMode={selectedMode}
            inputValue={inputValue}
            setInputValue={setInputValue}
            inputRef={inputRef}
            onBack={() => setPhase('select')}
            handleExecute={handleExecute}
          />
        )}

        {(phase === 'running' || phase === 'done') && selectedMode && (
          <CmdKOutput
            mode={selectedMode}
            lines={lines}
            progress={progress}
            exitCode={exitCode}
            errorMsg={errorMsg}
            elapsedMs={elapsedMs}
            jobId={jobId}
            onDismiss={closeToIdle}
            onCancel={cancelAndClose}
            phase={phase}
          />
        )}
      </div>
    </>
  )
}

function useCmdKPaletteState() {
  const { send, subscribe } = useAxonWs()
  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<PalettePhase>('idle')
  const [selectedMode, setSelectedMode] = useState<ModeDefinition | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [progress, setProgress] = useState<PaletteProgress | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const execIdRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const resetOutput = useCallback(() => {
    setLines([])
    setProgress(null)
    setExitCode(null)
    setErrorMsg(null)
    setElapsedMs(null)
    setJobId(null)
    execIdRef.current = null
  }, [])

  const closeToIdle = useCallback(() => {
    unsubRef.current?.()
    unsubRef.current = null
    setPhase('idle')
    setSelectedMode(null)
    setInputValue('')
    setSearch('')
    resetOutput()
  }, [resetOutput])

  const cancelAndClose = useCallback(() => {
    if (execIdRef.current) {
      send({ type: 'cancel', id: execIdRef.current })
    }
    closeToIdle()
  }, [send, closeToIdle])

  useEffect(() => {
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'k') {
        e.preventDefault()
        setPhase((cur) => {
          if (cur !== 'idle') {
            closeToIdle()
            return 'idle'
          }
          return 'select'
        })
        return
      }
      if (e.key === 'Escape') {
        setPhase((cur) => {
          if (cur === 'idle') return cur
          if (cur === 'select') {
            setTimeout(closeToIdle, 0)
            return 'idle'
          }
          if (cur === 'input') return 'select'
          if (cur === 'running') {
            setTimeout(cancelAndClose, 0)
            return 'idle'
          }
          if (cur === 'done') {
            setTimeout(closeToIdle, 0)
            return 'idle'
          }
          return cur
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeToIdle, cancelAndClose])

  useEffect(() => {
    if (phase === 'input') {
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [phase])

  const executeMode = useCallback(
    (mode: ModeDefinition, input: string) => {
      resetOutput()
      execIdRef.current = null

      const unsub = subscribe((msg: WsServerMsg) => {
        if (msg.type === 'command.start') {
          execIdRef.current = msg.data.ctx.exec_id
          return
        }

        if (!execIdRef.current) return

        const ctxExecId = (msg as { data?: { ctx?: { exec_id?: string } } }).data?.ctx?.exec_id
        if (ctxExecId && ctxExecId !== execIdRef.current) return

        if (msg.type === 'command.output.line') {
          setLines((prev) => [...prev, msg.data.line])
        } else if (msg.type === 'command.output.json') {
          try {
            setLines((prev) => [...prev, JSON.stringify(msg.data.data, null, 2)])
          } catch {
            setLines((prev) => [...prev, String(msg.data.data)])
          }
        } else if (msg.type === 'job.progress') {
          const p = msg.data.payload
          setProgress({
            phase: p.phase,
            percent: p.percent,
            processed: p.processed,
            total: p.total,
          })
          const metrics = (msg.data as { metrics?: { job_id?: string } }).metrics
          if (metrics?.job_id) setJobId(metrics.job_id)
        } else if (msg.type === 'job.status') {
          const metrics = msg.data.payload.metrics as Record<string, unknown> | undefined
          const jid = (metrics?.job_id ?? metrics?.id) as string | undefined
          if (jid) setJobId(jid)
        } else if (msg.type === 'command.done') {
          setExitCode(msg.data.payload.exit_code)
          if (msg.data.payload.elapsed_ms !== undefined) setElapsedMs(msg.data.payload.elapsed_ms)
          setPhase('done')
          unsub()
          unsubRef.current = null
        } else if (msg.type === 'command.error') {
          setErrorMsg(msg.data.payload.message)
          if (msg.data.payload.elapsed_ms !== undefined) setElapsedMs(msg.data.payload.elapsed_ms)
          setExitCode(1)
          setPhase('done')
          unsub()
          unsubRef.current = null
        }
      })

      unsubRef.current = unsub
      send({ type: 'execute', mode: mode.id, input: input.trim(), flags: {} })
    },
    [send, subscribe, resetOutput],
  )

  const handleSelectMode = useCallback(
    (mode: ModeDefinition) => {
      setSelectedMode(mode)
      if (NO_INPUT_MODES.has(mode.id)) {
        setSearch('')
        resetOutput()
        setPhase('running')
        executeMode(mode, '')
      } else {
        setInputValue('')
        setPhase('input')
      }
    },
    [resetOutput, executeMode],
  )

  const handleExecute = useCallback(() => {
    if (!selectedMode) return
    const val = inputValue.trim()
    if (!val && !NO_INPUT_MODES.has(selectedMode.id)) return
    setPhase('running')
    executeMode(selectedMode, val)
  }, [selectedMode, inputValue, executeMode])

  return {
    mounted,
    phase,
    setPhase,
    selectedMode,
    inputValue,
    setInputValue,
    search,
    setSearch,
    lines,
    progress,
    exitCode,
    errorMsg,
    elapsedMs,
    jobId,
    inputRef,
    closeToIdle,
    cancelAndClose,
    handleSelectMode,
    handleExecute,
  }
}

export function CmdKPalette() {
  const {
    mounted,
    phase,
    setPhase,
    selectedMode,
    inputValue,
    setInputValue,
    search,
    setSearch,
    lines,
    progress,
    exitCode,
    errorMsg,
    elapsedMs,
    jobId,
    inputRef,
    closeToIdle,
    cancelAndClose,
    handleSelectMode,
    handleExecute,
  } = useCmdKPaletteState()

  if (!mounted || phase === 'idle') return null

  return createPortal(
    <PaletteDialog
      phase={phase}
      search={search}
      setSearch={setSearch}
      handleSelectMode={handleSelectMode}
      selectedMode={selectedMode}
      inputValue={inputValue}
      setInputValue={setInputValue}
      inputRef={inputRef}
      setPhase={setPhase}
      handleExecute={handleExecute}
      lines={lines}
      progress={progress}
      exitCode={exitCode}
      errorMsg={errorMsg}
      elapsedMs={elapsedMs}
      jobId={jobId}
      closeToIdle={closeToIdle}
      cancelAndClose={cancelAndClose}
    />,
    document.body,
  )
}
