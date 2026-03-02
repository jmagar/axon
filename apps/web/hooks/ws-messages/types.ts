import type { WsLifecycleEntry, WsServerMsg } from '@/lib/ws-protocol'

export interface LogLine {
  content: string
  timestamp: number
}

export interface RecentRun {
  id: string
  status: 'done' | 'failed'
  mode: string
  target: string
  duration: string
  lines: number
  time: string
}

export interface CrawlProgress {
  pages_crawled: number
  pages_discovered: number
  md_created: number
  thin_md: number
  phase: string
}

export interface ScreenshotFile {
  path: string
  name: string
  serve_url?: string
  size_bytes?: number
  url?: string
}

export interface CancelResponseState {
  ok: boolean
  message: string
  mode?: string
  job_id?: string
}

export interface WorkspaceContextState {
  turns: number
  sourceCount: number
  threadSourceCount: number
  contextCharsTotal: number
  contextBudgetChars: number
  lastLatencyMs: number
  model: 'sonnet' | 'opus' | 'haiku'
  permissionLevel: 'plan' | 'accept-edits' | 'bypass-permissions'
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
}

export type PulseWorkspaceModel = 'sonnet' | 'opus' | 'haiku'
export type PulseWorkspacePermission = 'plan' | 'accept-edits' | 'bypass-permissions'

export interface WsMessagesRuntimeState {
  currentJobId: string | null
  commandMode: string | null
  markdownContent: string
  crawlProgress: CrawlProgress | null
  screenshotFiles: ScreenshotFile[]
  lifecycleEntries: WsLifecycleEntry[]
  stdoutJson: unknown[]
  cancelResponse: CancelResponseState | null
}

export interface RuntimeHandoffSnapshot {
  modeLabel: string
  targetInput: string
  filesSnapshot: Array<{ relative_path: string; markdown_chars: number; url: string }>
  outputDir: string | null
  stdoutSnapshot: unknown[]
  virtualFileContentByPath: Record<string, string>
}

export interface RuntimeHandoffResult {
  handoffPrompt: string
  hasResults: boolean
  workspaceMode: 'pulse'
}

export interface WsMessagesContextValue {
  markdownContent: string
  logLines: LogLine[]
  errorMessage: string
  recentRuns: RecentRun[]
  isProcessing: boolean
  hasResults: boolean
  currentMode: string
  crawlFiles: Array<{
    url: string
    relative_path: string
    markdown_chars: number
  }>
  selectedFile: string | null
  selectFile: (relativePath: string) => void
  crawlProgress: CrawlProgress | null
  stdoutLines: string[]
  stdoutJson: unknown[]
  commandMode: string | null
  screenshotFiles: ScreenshotFile[]
  currentJobId: string | null
  lifecycleEntries: WsLifecycleEntry[]
  cancelResponse: CancelResponseState | null
  workspaceMode: string | null
  workspacePrompt: string | null
  workspacePromptVersion: number
  workspaceContext: WorkspaceContextState | null
  pulseModel: PulseWorkspaceModel
  pulsePermissionLevel: PulseWorkspacePermission
  setPulseModel: (model: PulseWorkspaceModel) => void
  setPulsePermissionLevel: (level: PulseWorkspacePermission) => void
  activateWorkspace: (mode: string) => void
  submitWorkspacePrompt: (prompt: string) => void
  deactivateWorkspace: () => void
  updateWorkspaceContext: (context: WorkspaceContextState | null) => void
  startExecution: (mode: string, input?: string, options?: { preserveWorkspace?: boolean }) => void
}

export interface WsMessageRuntimeMappers {
  toProgress: (msg: Extract<WsServerMsg, { type: 'crawl_progress' }>) => CrawlProgress
}
