'use client'

// Stub — full implementation pending in feat/crawl-download-pack

import type { CrawlFile } from '@/lib/ws-protocol'

interface CrawlFileExplorerProps {
  files: CrawlFile[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
  jobId: string | null
}

export function CrawlFileExplorer({ files, selectedFile, onSelectFile }: CrawlFileExplorerProps) {
  if (files.length === 0) return null
  return (
    <aside
      className="hidden w-56 shrink-0 border-r border-[var(--border-subtle)] md:flex md:flex-col"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="px-3 py-2 text-[9px] font-semibold uppercase tracking-widest text-[var(--text-dim)]">
        Files ({files.length})
      </div>
      <ul className="flex-1 overflow-y-auto">
        {files.map((f) => (
          <li key={f.relative_path}>
            <button
              type="button"
              onClick={() => onSelectFile(f.relative_path)}
              className={[
                'w-full truncate px-3 py-1.5 text-left text-[10px] transition-colors',
                selectedFile === f.relative_path
                  ? 'bg-[rgba(135,175,255,0.12)] text-[var(--axon-primary)]'
                  : 'text-[var(--text-dim)] hover:bg-[var(--surface-float)] hover:text-[var(--text-secondary)]',
              ].join(' ')}
            >
              {f.relative_path.split('/').pop() ?? f.relative_path}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
