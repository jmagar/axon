'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAxonWs } from '@/hooks/use-axon-ws'
import type { WsServerMsg } from '@/lib/ws-protocol'
import { type ModeDefinition, NO_INPUT_MODES } from '@/lib/ws-protocol'
import { PaletteDialog } from './cmdk-palette-dialog'
import type { PaletteDialogState, PalettePhase, PaletteProgress } from './cmdk-palette-types'

export type { PaletteProgress } from './cmdk-palette-types'

function useCmdKPaletteState() {
  const { send, subscribe } = useAxonWs()
  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<PalettePhase>('idle')
  const [selectedMode, setSelectedMode] = useState<ModeDefinition | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [jsonCount, setJsonCount] = useState(0)
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
    setJsonCount(0)
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
          setJsonCount((n) => n + 1)
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

  const dialogState: PaletteDialogState = {
    phase,
    search,
    selectedMode,
    inputValue,
    lines,
    jsonCount,
    progress,
    exitCode,
    errorMsg,
    elapsedMs,
    jobId,
  }

  return {
    mounted,
    setPhase,
    setInputValue,
    setSearch,
    inputRef,
    closeToIdle,
    cancelAndClose,
    handleSelectMode,
    handleExecute,
    dialogState,
  }
}

export function CmdKPalette() {
  const {
    mounted,
    setPhase,
    setInputValue,
    setSearch,
    inputRef,
    closeToIdle,
    cancelAndClose,
    handleSelectMode,
    handleExecute,
    dialogState,
  } = useCmdKPaletteState()

  if (!mounted || dialogState.phase === 'idle') return null

  return createPortal(
    <PaletteDialog
      state={dialogState}
      setPhase={setPhase}
      setSearch={setSearch}
      setInputValue={setInputValue}
      inputRef={inputRef}
      handleSelectMode={handleSelectMode}
      handleExecute={handleExecute}
      closeToIdle={closeToIdle}
      cancelAndClose={cancelAndClose}
    />,
    document.body,
  )
}
