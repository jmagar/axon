'use client'

import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  HardDrive,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { CodeViewer } from '@/components/workspace/code-viewer'
import { type FileEntry, FileTree } from '@/components/workspace/file-tree'

const ContentViewer = dynamic(
  () => import('@/components/content-viewer').then((m) => ({ default: m.ContentViewer })),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-4 rounded bg-[var(--surface-elevated)]" />,
  },
)

interface FileData {
  type: 'text' | 'binary'
  name: string
  ext?: string
  size: number
  modified: string
  content?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function Breadcrumb({ filePath }: { filePath: string | null }) {
  if (!filePath) {
    return <span className="text-[var(--text-dim)] text-xs font-mono">/workspace</span>
  }
  const parts = filePath.split('/').filter(Boolean)
  return (
    <div className="flex items-center gap-1 font-mono text-xs overflow-x-auto">
      <span className="text-[var(--text-muted)] shrink-0">workspace</span>
      {parts.map((part, i) => {
        const partPath = parts.slice(0, i + 1).join('/')
        const isLast = i === parts.length - 1
        return (
          <span key={partPath} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="size-3 text-[var(--text-dim)]" />
            <span className={isLast ? 'text-[var(--axon-secondary)]' : 'text-[var(--text-muted)]'}>
              {part}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export default function WorkspacePage() {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [fileData, setFileData] = useState<FileData | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/workspace?action=list&path=')
      .then((r) => r.json())
      .then((data: { items?: FileEntry[] }) => setRootEntries(data.items ?? []))
      .catch(() => setRootEntries([]))
  }, [])

  const handleSelectFile = useCallback(async (entry: FileEntry) => {
    if (entry.type === 'directory') return
    setSelectedFile(entry)
    setFileData(null)
    setFileError(null)
    setLoadingFile(true)
    try {
      const res = await fetch(`/api/workspace?action=read&path=${encodeURIComponent(entry.path)}`)
      if (!res.ok) {
        const err = await res.json()
        setFileError(err.error ?? 'Failed to load file')
        return
      }
      setFileData(await res.json())
    } catch {
      setFileError('Network error loading file')
    } finally {
      setLoadingFile(false)
    }
  }, [])

  const isMarkdown = fileData?.ext === '.md' || fileData?.ext === '.mdx'

  const copyPath = useCallback(() => {
    if (!selectedFile) return
    navigator.clipboard.writeText(selectedFile.path).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [selectedFile])

  return (
    <div
      className="flex h-screen flex-col overflow-hidden text-[var(--text-primary)]"
      style={{
        background:
          'radial-gradient(ellipse at 14% 10%, rgba(135,175,255,0.08), transparent 34%), radial-gradient(ellipse at 82% 16%, rgba(255,135,175,0.07), transparent 38%), linear-gradient(180deg,#02040b 0%,#030712 60%,#040a14 100%)',
      }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4"
        style={{
          minHeight: '52px',
          background: 'rgba(10,18,35,0.9)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <Link
          href="/"
          className="flex size-7 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-float)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--axon-primary)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-1"
        >
          <ArrowLeft className="size-3.5" />
        </Link>

        <div className="flex size-7 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-float)]">
          <FolderOpen className="size-3.5 text-[var(--axon-primary)]" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold font-display text-[var(--text-primary)] leading-none">
            Workspace
          </h1>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)] font-mono">
            Browse your workspace files
          </p>
        </div>

        {selectedFile && (
          <button
            type="button"
            onClick={copyPath}
            className="flex items-center gap-1.5 rounded border border-[var(--border-accent)] bg-[rgba(255,135,175,0.07)] px-3 py-1.5 text-xs text-[var(--axon-secondary)] transition-colors hover:bg-[rgba(255,135,175,0.12)] hover:text-[var(--axon-secondary-strong)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-1"
          >
            {copied ? (
              <>
                <Check className="size-3" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3" /> Copy path
              </>
            )}
          </button>
        )}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar drawer overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 sm:hidden">
            <button
              type="button"
              aria-label="Close sidebar"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
            <aside
              className="absolute inset-y-0 left-0 flex w-[80vw] max-w-[280px] flex-col overflow-hidden border-r border-[var(--border-subtle)]"
              style={{ background: 'rgba(10,18,35,0.97)' }}
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  Explorer
                </span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--axon-primary)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)]"
                  aria-label="Close sidebar"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-3.5"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 px-1">
                {rootEntries.length === 0 ? (
                  <div className="px-3 py-4 text-[11px] text-[var(--text-dim)] italic">
                    Loading workspace...
                  </div>
                ) : (
                  <FileTree
                    entries={rootEntries}
                    selectedPath={selectedFile?.path ?? null}
                    onSelect={(entry) => {
                      handleSelectFile(entry)
                      setSidebarOpen(false)
                    }}
                  />
                )}
              </div>
            </aside>
          </div>
        )}

        {/* Desktop sidebar — inline collapsible */}
        <aside
          className={[
            'hidden sm:flex flex-shrink-0 flex-col border-r border-[var(--border-subtle)] overflow-hidden transition-all duration-300',
            sidebarOpen ? 'sm:w-64' : 'sm:w-0',
          ].join(' ')}
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Explorer
            </span>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 px-1">
            {rootEntries.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-[var(--text-dim)] italic">
                Loading workspace...
              </div>
            ) : (
              <FileTree
                entries={rootEntries}
                selectedPath={selectedFile?.path ?? null}
                onSelect={handleSelectFile}
              />
            )}
          </div>
        </aside>

        {/* Main viewer */}
        <main className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Breadcrumb bar */}
          <div
            className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 sm:gap-3 sm:px-4"
            style={{ minHeight: '44px' }}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--axon-primary)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-1 sm:min-h-0 sm:min-w-0"
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <FolderOpen className="size-3.5" />
            </button>
            <Breadcrumb filePath={selectedFile?.path ?? null} />
            {fileData && (
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  <HardDrive className="size-3" />
                  {formatBytes(fileData.size)}
                </span>
                <span className="hidden items-center gap-1 text-[10px] text-[var(--text-muted)] sm:flex">
                  <Clock className="size-3" />
                  {formatDate(fileData.modified)}
                </span>
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-auto p-4">
            {!selectedFile && !loadingFile && !fileError && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <FolderOpen className="mx-auto mb-3 size-10 text-[var(--text-dim)]" />
                  <p className="text-sm text-[var(--text-muted)]">
                    Select a file to view its contents
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                    <span className="sm:hidden">Tap the folder icon to browse files</span>
                    <span className="hidden sm:inline">Browse the workspace tree on the left</span>
                  </p>
                </div>
              </div>
            )}

            {loadingFile && (
              <div className="flex h-full items-center justify-center">
                <div className="size-6 animate-spin rounded-full border-2 border-[var(--border-subtle)] border-t-[var(--axon-primary)]" />
              </div>
            )}

            {fileError && (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border-accent)] bg-[rgba(255,135,175,0.05)] px-4 py-3 text-sm text-[var(--axon-secondary)]">
                <AlertCircle className="size-4 shrink-0" />
                {fileError}
              </div>
            )}

            {fileData?.type === 'binary' && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-float)] p-6 text-center">
                <FileText className="mx-auto mb-3 size-8 text-[var(--text-dim)]" />
                <p className="text-sm text-[var(--text-muted)]">Binary file — cannot display</p>
                <p className="mt-1 text-xs text-[var(--text-dim)]">{formatBytes(fileData.size)}</p>
              </div>
            )}

            {fileData?.type === 'text' &&
              fileData.content !== undefined &&
              (isMarkdown ? (
                <div className="prose-invert max-w-none">
                  <ContentViewer markdown={fileData.content} isProcessing={false} />
                </div>
              ) : (
                <div className="h-full">
                  <CodeViewer
                    content={fileData.content}
                    language={fileData.ext?.slice(1)}
                    fileName={fileData.name}
                  />
                </div>
              ))}
          </div>
        </main>
      </div>
    </div>
  )
}
