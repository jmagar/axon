'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useAxonWs } from '@/hooks/use-axon-ws'
import { useWsMessages } from '@/hooks/use-ws-messages'
import { getCommandSpec } from '@/lib/axon-command-map'
import {
  deriveOmniboxPhase,
  extractActiveMention,
  extractMentionLabels,
  getMentionKind,
  type LocalDocFile,
  type MentionKind,
  replaceActiveMention,
} from '@/lib/omnibox'
import type { ModeCategory, ModeDefinition } from '@/lib/ws-protocol'
import { MODE_CATEGORY_ORDER, MODES, type ModeId, NO_INPUT_MODES } from '@/lib/ws-protocol'
import type { CommandOptionValues } from '../command-options-panel'
import { useOmniboxEffects } from './omnibox-effects'
import type { CompletionStatus } from './omnibox-types'
import {
  normalizeUrlInput,
  shouldPreservePulseWorkspaceForMode,
  shouldRunCommandForInput,
} from './utils'

export function useOmniboxState() {
  const { send, subscribe } = useAxonWs()
  const {
    startExecution,
    activateWorkspace,
    submitWorkspacePrompt,
    currentJobId,
    currentMode,
    workspaceMode,
    workspaceContext,
    pulseModel,
    pulsePermissionLevel,
    setPulseModel,
    setPulsePermissionLevel,
  } = useWsMessages()

  // ── Core state ──────────────────────────────────────────────────────
  const [mode, setMode] = useState<ModeId>('scrape')
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [statusType, setStatusType] = useState<'processing' | 'done' | 'error'>('processing')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [mentionSuggestions, setMentionSuggestions] = useState<ModeDefinition[]>([])
  const [fileSuggestions, setFileSuggestions] = useState<LocalDocFile[]>([])
  const [mentionSelectionIndex, setMentionSelectionIndex] = useState(0)
  const [modeAppliedLabel, setModeAppliedLabel] = useState<string | null>(null)
  const [localDocFiles, setLocalDocFiles] = useState<LocalDocFile[]>([])
  const [fileContextMentions, setFileContextMentions] = useState<Record<string, LocalDocFile>>({})
  const [recentFileSelections, setRecentFileSelections] = useState<Record<string, number>>({})
  const [showModeSelector, setShowModeSelector] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [optionValues, setOptionValues] = useState<CommandOptionValues>({})
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [placeholderVisible, setPlaceholderVisible] = useState(true)
  const [isFocused, setIsFocused] = useState(false)
  const [completionStatus, setCompletionStatus] = useState<CompletionStatus | null>(null)
  const [mentionTipSeen, setMentionTipSeen] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('axon-mention-tip-seen') === '1'
  })

  // ── Refs ────────────────────────────────────────────────────────────
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const omniboxRef = useRef<HTMLDivElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const startTimeRef = useRef(0)
  const execIdRef = useRef(0)

  // ── Derived values ──────────────────────────────────────────────────
  const selectedModeDef = MODES.find((m) => m.id === mode) ?? MODES[0]
  const hasOptions = (getCommandSpec(mode)?.commandOptions.length ?? 0) > 0
  const activeOptionCount = useMemo(
    () => Object.values(optionValues).filter((val) => val !== '' && val !== false).length,
    [optionValues],
  )
  const activeMentionToken = useMemo(() => extractActiveMention(input), [input])
  const mentionKind: MentionKind = useMemo(
    () => getMentionKind(input, activeMentionToken),
    [input, activeMentionToken],
  )
  const activeSuggestions = mentionKind === 'mode' ? mentionSuggestions : fileSuggestions
  const effectiveDropdownOpen = dropdownOpen || mentionKind === 'mode'
  const willRunAsCommand = useMemo(() => shouldRunCommandForInput(mode, input), [mode, input])
  const omniboxPhase = useMemo(
    () =>
      deriveOmniboxPhase({
        isProcessing,
        input,
        mentionKind,
        hasModeFeedback: Boolean(modeAppliedLabel),
      }),
    [input, isProcessing, mentionKind, modeAppliedLabel],
  )
  const contextUtilizationPercent = useMemo(() => {
    if (!workspaceContext || workspaceContext.contextBudgetChars <= 0) return 0
    const ratio = (workspaceContext.contextCharsTotal / workspaceContext.contextBudgetChars) * 100
    if (ratio <= 0) return 0
    return Math.min(100, ratio)
  }, [workspaceContext])
  const groupedModes = useMemo(() => {
    const groups = new Map<ModeCategory, ModeDefinition[]>()
    for (const cat of MODE_CATEGORY_ORDER) {
      groups.set(cat, [])
    }
    for (const m of MODES) {
      const list = groups.get(m.category)
      if (list) list.push(m)
    }
    return groups
  }, [])

  // ── Effects ─────────────────────────────────────────────────────────
  useOmniboxEffects({
    mode,
    input,
    isProcessing,
    isFocused,
    statusText,
    statusType,
    modeAppliedLabel,
    activeMentionToken,
    mentionKind,
    localDocFiles,
    recentFileSelections,
    workspaceMode,
    inputRef,
    omniboxRef,
    setDropdownOpen,
    setOptionsOpen,
    setToolsOpen,
    setIsProcessing,
    setStatusText,
    setStatusType,
    setCompletionStatus,
    setShowModeSelector,
    setLocalDocFiles,
    setMentionSuggestions,
    setFileSuggestions,
    setMentionSelectionIndex,
    setModeAppliedLabel,
    setPlaceholderVisible,
    setPlaceholderIdx,
    setInput,
    subscribe,
  })

  // ── Callbacks ───────────────────────────────────────────────────────

  const buildInputWithFileContext = useCallback(
    async (rawInput: string) => {
      const mentionLabels = extractMentionLabels(rawInput)
      const matchingFiles = mentionLabels
        .map((label) => fileContextMentions[label.toLowerCase()])
        .filter((file): file is LocalDocFile => Boolean(file))
        .slice(0, 3)

      if (matchingFiles.length === 0) {
        return { enrichedInput: rawInput.trim(), contextFileLabels: [] as string[] }
      }

      const contextBlocks = await Promise.all(
        matchingFiles.map(async (file) => {
          try {
            const res = await fetch(`/api/omnibox/files?id=${encodeURIComponent(file.id)}`)
            if (!res.ok) return null
            const data = (await res.json()) as { file?: { content?: string; label?: string } }
            const content = data.file?.content?.trim()
            if (!content) return null
            const label = data.file?.label ?? file.label
            return `### ${label}\n${content.slice(0, 2400)}`
          } catch {
            return null
          }
        }),
      )

      const usableBlocks = contextBlocks.filter((block): block is string => Boolean(block))
      if (usableBlocks.length === 0) {
        return { enrichedInput: rawInput.trim(), contextFileLabels: [] as string[] }
      }

      const contextSection = `\n\nLocal file context:\n${usableBlocks.join('\n\n---\n\n')}`
      return {
        enrichedInput: `${rawInput.trim()}${contextSection}`,
        contextFileLabels: matchingFiles.map((file) => file.label),
      }
    },
    [fileContextMentions],
  )

  const executeCommand = useCallback(
    async (execMode: ModeId, execInput: string) => {
      if (isProcessing) return

      const trimmedInput = execInput.trim()
      if (!trimmedInput && !NO_INPUT_MODES.has(execMode)) return
      const shouldRunCommand = shouldRunCommandForInput(execMode, trimmedInput)
      if (!shouldRunCommand) {
        if (workspaceMode !== 'pulse') {
          activateWorkspace('pulse')
        }
        if (trimmedInput) submitWorkspacePrompt(trimmedInput)
        return
      }

      const normalizedInput = normalizeUrlInput(trimmedInput)
      const { enrichedInput, contextFileLabels } = await buildInputWithFileContext(normalizedInput)

      execIdRef.current += 1
      setIsProcessing(true)
      startTimeRef.current = Date.now()
      setStatusText('processing...')
      setStatusType('processing')

      const flags: Record<string, string> = {}
      for (const [key, val] of Object.entries(optionValues)) {
        if (val === '' || val === false) continue
        flags[key] = String(val)
      }
      if (contextFileLabels.length > 0) {
        flags.context_files = contextFileLabels.join(',')
      }

      send({
        type: 'execute',
        mode: execMode,
        input: enrichedInput,
        flags,
      })

      const preservePulseWorkspace = shouldPreservePulseWorkspaceForMode(workspaceMode, execMode)
      startExecution(execMode, enrichedInput, { preserveWorkspace: preservePulseWorkspace })
    },
    [
      isProcessing,
      buildInputWithFileContext,
      activateWorkspace,
      workspaceMode,
      submitWorkspacePrompt,
      send,
      startExecution,
      optionValues,
    ],
  )

  const execute = useCallback(() => {
    const hasTypedInput = input.trim().length > 0
    void executeCommand(mode, input)
    if (hasTypedInput) setInput('')
  }, [executeCommand, mode, input])

  const cancel = useCallback(() => {
    if (!isProcessing) return
    const fallbackId = String(execIdRef.current)
    const cancelId = currentJobId ?? fallbackId
    send({
      type: 'cancel',
      id: cancelId,
      mode,
      job_id: currentJobId ?? undefined,
    })
    setIsProcessing(false)
    const elapsed = Date.now() - startTimeRef.current
    const secs = (elapsed / 1000).toFixed(1)
    setStatusText(`${secs}s \u00b7 cancelled`)
    setStatusType('error')
  }, [currentJobId, isProcessing, mode, send])

  const selectMode = useCallback(
    (id: ModeId) => {
      setMode(id)
      setDropdownOpen(false)
      setOptionsOpen(false)
      setOptionValues({})
      if (mentionKind === 'mode') {
        setInput('')
        setMentionSuggestions([])
        setFileSuggestions([])
        setMentionSelectionIndex(0)
        setModeAppliedLabel(MODES.find((m) => m.id === id)?.label ?? null)
      }
      if (NO_INPUT_MODES.has(id)) {
        setTimeout(() => {
          void executeCommand(id, '')
        }, 0)
      } else {
        inputRef.current?.focus()
      }
    },
    [executeCommand, mentionKind],
  )

  const applyModeMentionCandidate = useCallback(
    (candidate: ModeDefinition) => {
      selectMode(candidate.id as ModeId)
      setInput('')
      setMentionSuggestions([])
      setFileSuggestions([])
      setMentionSelectionIndex(0)
      setModeAppliedLabel(candidate.label)
      return true
    },
    [selectMode],
  )

  const applyFileMentionCandidate = useCallback(
    (candidate: LocalDocFile) => {
      if (!activeMentionToken) return false
      const nextInput = replaceActiveMention(input, activeMentionToken, `@${candidate.label} `)
      setInput(nextInput)
      setFileSuggestions([])
      setMentionSuggestions([])
      setMentionSelectionIndex(0)
      setFileContextMentions((prev) => ({
        ...prev,
        [candidate.label.toLowerCase()]: candidate,
      }))
      setRecentFileSelections((prev) => ({
        ...prev,
        [candidate.id]: Date.now(),
      }))
      return true
    },
    [activeMentionToken, input],
  )

  const removeFileContextMention = useCallback((label: string) => {
    setFileContextMentions((prev) => {
      const next = { ...prev }
      delete next[label]
      return next
    })
  }, [])

  const applyActiveSuggestion = useCallback(() => {
    if (mentionKind === 'mode') {
      const selected = mentionSuggestions[mentionSelectionIndex]
      return selected ? applyModeMentionCandidate(selected) : false
    }
    const selected = fileSuggestions[mentionSelectionIndex]
    return selected ? applyFileMentionCandidate(selected) : false
  }, [
    mentionSelectionIndex,
    mentionKind,
    mentionSuggestions,
    fileSuggestions,
    applyModeMentionCandidate,
    applyFileMentionCandidate,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const hasMentionSelection = activeSuggestions.length > 0 && mentionKind !== 'none'
      if (e.key === 'ArrowDown' && hasMentionSelection) {
        e.preventDefault()
        setMentionSelectionIndex((prev) => (prev + 1) % activeSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp' && hasMentionSelection) {
        e.preventDefault()
        setMentionSelectionIndex(
          (prev) => (prev - 1 + activeSuggestions.length) % activeSuggestions.length,
        )
        return
      }
      if (e.key === 'Tab' && hasMentionSelection) {
        e.preventDefault()
        applyActiveSuggestion()
        return
      }
      if (e.key === 'Enter') {
        if (hasMentionSelection) {
          e.preventDefault()
          applyActiveSuggestion()
          return
        }
        if ((e.metaKey || e.ctrlKey) && !e.altKey) {
          e.preventDefault()
          execute()
          return
        }
        e.preventDefault()
        execute()
      }
      if (e.key === 'Escape') {
        setDropdownOpen(false)
        setOptionsOpen(false)
        setMentionSuggestions([])
        setFileSuggestions([])
        if (mentionKind === 'mode') {
          setInput('')
        }
      }
    },
    [activeSuggestions, mentionKind, applyActiveSuggestion, execute],
  )

  return {
    // State
    mode,
    input,
    isProcessing,
    statusText,
    statusType,
    dropdownOpen,
    optionsOpen,
    mentionSuggestions,
    fileSuggestions,
    mentionSelectionIndex,
    modeAppliedLabel,
    fileContextMentions,
    showModeSelector,
    toolsOpen,
    optionValues,
    placeholderIdx,
    placeholderVisible,
    isFocused,
    completionStatus,
    mentionTipSeen,

    // Derived
    activeMentionToken,
    selectedModeDef,
    hasOptions,
    activeOptionCount,
    mentionKind,
    activeSuggestions,
    effectiveDropdownOpen,
    willRunAsCommand,
    omniboxPhase,
    contextUtilizationPercent,
    groupedModes,

    // Workspace
    workspaceMode,
    workspaceContext,
    pulseModel,
    pulsePermissionLevel,
    currentMode,
    isProcessingWithCurrentMode: isProcessing && Boolean(currentMode),

    // Actions
    setInput,
    setDropdownOpen,
    setOptionsOpen,
    setToolsOpen,
    setMentionSelectionIndex,
    setIsFocused,
    setMentionTipSeen,
    setPulseModel,
    setPulsePermissionLevel,
    execute,
    cancel,
    selectMode,
    applyActiveSuggestion,
    applyFileMentionCandidate,
    removeFileContextMention,
    setOptionValues,
    handleKeyDown,

    // Refs
    inputRef,
    omniboxRef,
    toolsRef,
  }
}
