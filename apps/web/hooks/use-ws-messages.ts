'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAxonWs } from '@/hooks/use-axon-ws'
import type { CrawlFile, WsLifecycleEntry, WsServerMsg } from '@/lib/ws-protocol'
import { handleWsMessage } from './ws-messages/handlers'
import { makeInitialRuntimeState, reduceRuntimeState } from './ws-messages/runtime'
import type {
  CancelResponseState,
  CrawlProgress,
  LogLine,
  PulseWorkspaceModel,
  PulseWorkspacePermission,
  RecentRun,
  ScreenshotFile,
  WorkspaceContextState,
  WsMessagesContextValue,
} from './ws-messages/types'

const WsMessagesContext = createContext<WsMessagesContextValue | null>(null)

export function useWsMessages() {
  const ctx = useContext(WsMessagesContext)
  if (!ctx) throw new Error('useWsMessages must be used within WsMessagesProvider')
  return ctx
}

export { WsMessagesContext, makeInitialRuntimeState, reduceRuntimeState }
export type {
  CancelResponseState,
  CrawlProgress,
  LogLine,
  PulseWorkspaceModel,
  PulseWorkspacePermission,
  RecentRun,
  ScreenshotFile,
  WorkspaceContextState,
}

export function useWsMessagesProvider() {
  const { subscribe, send } = useAxonWs()
  const [markdownContent, setMarkdownContent] = useState('')
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([])
  const runIdCounter = useRef(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [hasResults, setHasResults] = useState(false)
  const [crawlFiles, setCrawlFiles] = useState<CrawlFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [virtualFileContentByPath, setVirtualFileContentByPath] = useState<Record<string, string>>(
    {},
  )
  const [currentOutputDir, setCurrentOutputDir] = useState<string | null>(null)
  const currentModeRef = useRef('')
  const currentInputRef = useRef('')
  const [currentMode, setCurrentMode] = useState('')
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null)
  const [stdoutLines, setStdoutLines] = useState<string[]>([])
  const [stdoutJson, setStdoutJson] = useState<unknown[]>([])
  const [commandMode, setCommandMode] = useState<string | null>(null)
  const [screenshotFiles, setScreenshotFiles] = useState<ScreenshotFile[]>([])
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const currentJobIdRef = useRef<string | null>(null)
  const [lifecycleEntries, setLifecycleEntries] = useState<WsLifecycleEntry[]>([])
  const [cancelResponse, setCancelResponse] = useState<CancelResponseState | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<string | null>('pulse')
  const [workspacePrompt, setWorkspacePrompt] = useState<string | null>(null)
  const [workspacePromptVersion, setWorkspacePromptVersion] = useState(0)
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContextState | null>(null)
  const [pulseModel, setPulseModel] = useState<PulseWorkspaceModel>('sonnet')
  const [pulsePermissionLevel, setPulsePermissionLevel] =
    useState<PulseWorkspacePermission>('accept-edits')

  const selectedFileRef = useRef<string | null>(null)
  const crawlFilesRef = useRef<CrawlFile[]>([])
  const stdoutJsonRef = useRef<unknown[]>([])
  const currentOutputDirRef = useRef<string | null>(null)
  const virtualFileContentByPathRef = useRef<Record<string, string>>({})

  useEffect(() => {
    crawlFilesRef.current = crawlFiles
  }, [crawlFiles])

  useEffect(() => {
    selectedFileRef.current = selectedFile
  }, [selectedFile])

  useEffect(() => {
    stdoutJsonRef.current = stdoutJson
  }, [stdoutJson])

  useEffect(() => {
    currentOutputDirRef.current = currentOutputDir
  }, [currentOutputDir])

  useEffect(() => {
    virtualFileContentByPathRef.current = virtualFileContentByPath
  }, [virtualFileContentByPath])

  useEffect(() => {
    try {
      if (workspaceMode === null) {
        window.localStorage.removeItem('axon.web.workspace-mode')
      } else {
        window.localStorage.setItem('axon.web.workspace-mode', workspaceMode)
      }
    } catch {
      // Ignore storage errors.
    }
  }, [workspaceMode])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('axon.web.workspace-mode')
      if (stored) setWorkspaceMode(stored)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      const m = localStorage.getItem('axon.web.pulse-model') as PulseWorkspaceModel
      if (m && ['sonnet', 'opus', 'haiku'].includes(m)) setPulseModel(m)
      const p = localStorage.getItem('axon.web.pulse-permission') as PulseWorkspacePermission
      if (p && ['plan', 'accept-edits', 'bypass-permissions'].includes(p)) {
        setPulsePermissionLevel(p)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('axon.web.pulse-model', pulseModel)
    } catch {
      /* ignore */
    }
  }, [pulseModel])

  useEffect(() => {
    try {
      localStorage.setItem('axon.web.pulse-permission', pulsePermissionLevel)
    } catch {
      /* ignore */
    }
  }, [pulsePermissionLevel])

  const setCurrentJobIdTracked = useCallback((jobId: string | null) => {
    currentJobIdRef.current = jobId
    setCurrentJobId(jobId)
  }, [])

  useEffect(() => {
    const refs = {
      currentModeRef,
      currentInputRef,
      currentJobIdRef,
      selectedFileRef,
      crawlFilesRef,
      stdoutJsonRef,
      currentOutputDirRef,
      virtualFileContentByPathRef,
      runIdCounter,
    }
    const setters = {
      setLogLines,
      setMarkdownContent,
      setHasResults,
      setCrawlFiles,
      setCurrentOutputDir,
      setSelectedFile,
      setCrawlProgress,
      setCommandMode,
      setStdoutLines,
      setStdoutJson,
      setVirtualFileContentByPath,
      setScreenshotFiles,
      setLifecycleEntries,
      setCancelResponse,
      setIsProcessing,
      setErrorMessage,
      setRecentRuns,
      setWorkspaceMode,
      setWorkspacePrompt,
      setWorkspacePromptVersion,
      setCurrentJobIdTracked,
    }
    return subscribe((msg: WsServerMsg) => handleWsMessage(msg, refs, setters))
  }, [setCurrentJobIdTracked, subscribe])

  const selectFile = useCallback(
    (relativePath: string) => {
      setSelectedFile(relativePath)
      setMarkdownContent('')
      const virtualContent = virtualFileContentByPathRef.current[relativePath]
      if (typeof virtualContent === 'string') {
        setMarkdownContent(virtualContent)
        return
      }
      send({ type: 'read_file', path: relativePath })
    },
    [send],
  )

  const startExecution = useCallback(
    (mode: string, input?: string, options?: { preserveWorkspace?: boolean }) => {
      const preserveWorkspace = options?.preserveWorkspace === true
      currentModeRef.current = mode
      currentInputRef.current = input ?? ''
      setCurrentMode(mode)
      setMarkdownContent('')
      setLogLines([])
      setErrorMessage('')
      setIsProcessing(true)
      setHasResults(true)
      setCrawlFiles([])
      setSelectedFile(null)
      setVirtualFileContentByPath({})
      setCurrentOutputDir(null)
      setCrawlProgress(null)
      setStdoutLines([])
      setStdoutJson([])
      setCommandMode(null)
      setScreenshotFiles([])
      setCurrentJobIdTracked(null)
      setLifecycleEntries([])
      setCancelResponse(null)
      if (!preserveWorkspace) {
        setWorkspaceMode(null)
        setWorkspacePrompt(null)
        setWorkspacePromptVersion(0)
        setWorkspaceContext(null)
      }
    },
    [setCurrentJobIdTracked],
  )

  const activateWorkspace = useCallback(
    (mode: string) => {
      currentModeRef.current = mode
      currentInputRef.current = ''
      setCurrentMode(mode)
      setMarkdownContent('')
      setLogLines([])
      setErrorMessage('')
      setHasResults(false)
      setIsProcessing(false)
      setCrawlFiles([])
      setSelectedFile(null)
      setVirtualFileContentByPath({})
      setCurrentOutputDir(null)
      setCrawlProgress(null)
      setStdoutLines([])
      setStdoutJson([])
      setCommandMode(null)
      setScreenshotFiles([])
      setCurrentJobIdTracked(null)
      setLifecycleEntries([])
      setCancelResponse(null)
      setWorkspaceMode(mode)
      setWorkspacePrompt(null)
      setWorkspacePromptVersion(0)
      setWorkspaceContext(null)
    },
    [setCurrentJobIdTracked],
  )

  const submitWorkspacePrompt = useCallback((prompt: string) => {
    setWorkspaceMode('pulse')
    setHasResults(true)
    setWorkspacePrompt(prompt)
    setWorkspacePromptVersion((prev) => prev + 1)
  }, [])

  const deactivateWorkspace = useCallback(() => {
    currentModeRef.current = ''
    currentInputRef.current = ''
    setCurrentMode('')
    setWorkspaceMode(null)
    try {
      window.localStorage.removeItem('axon.web.workspace-mode')
    } catch {
      // Ignore storage errors.
    }
    setWorkspacePrompt(null)
    setWorkspacePromptVersion(0)
    setWorkspaceContext(null)
  }, [])

  const updateWorkspaceContext = useCallback((context: WorkspaceContextState | null) => {
    setWorkspaceContext(context)
  }, [])

  return {
    markdownContent,
    logLines,
    errorMessage,
    recentRuns,
    isProcessing,
    hasResults,
    currentMode,
    crawlFiles,
    selectedFile,
    selectFile,
    crawlProgress,
    stdoutLines,
    stdoutJson,
    commandMode,
    screenshotFiles,
    currentJobId,
    lifecycleEntries,
    cancelResponse,
    workspaceMode,
    workspacePrompt,
    workspacePromptVersion,
    workspaceContext,
    pulseModel,
    pulsePermissionLevel,
    setPulseModel,
    setPulsePermissionLevel,
    activateWorkspace,
    submitWorkspacePrompt,
    deactivateWorkspace,
    updateWorkspaceContext,
    startExecution,
  }
}
