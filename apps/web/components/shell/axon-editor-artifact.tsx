'use client'

import { Check, Copy, FileCode2, Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '@/components/ai-elements/artifact'
import { MessageResponse } from '@/components/ai-elements/message'

// ── <axon:editor> block parsing ───────────────────────────────────────────────

const EDITOR_BLOCK_RE = /<axon:editor(?:\s[^>]*)?>[\s\S]*?<\/axon:editor>/g

/**
 * Remove all `<axon:editor>…</axon:editor>` blocks from a string, trimming the result.
 * Exported so tests can verify the production implementation directly.
 */
export function stripEditorBlocks(content: string): string {
  return content.replace(EDITOR_BLOCK_RE, '').trim()
}

export interface EditorArtifact {
  content: string
  operation: 'replace' | 'append'
  title: string
  wordCount: number
}

function extractTitle(md: string): string {
  const m = md.match(/^#{1,3}\s+(.+)$/m)
  return m ? m[1].trim() : 'Document'
}

/** Body text with headings and blank lines stripped, up to `limit` chars. */
function extractPreview(md: string, limit: number): string {
  return md
    .split('\n')
    .filter((line) => line.trim() && !line.match(/^#{1,6}\s/))
    .join(' ')
    .slice(0, limit)
    .trimEnd()
}

/**
 * Replace fenced code blocks (``` … ```) and inline code spans (` … `) with
 * placeholder text of equal length so that index positions in the original
 * string are preserved and `<axon:editor>` tags inside code are not matched.
 */
function maskCodeRegions(text: string): string {
  // Fenced code blocks: ```…``` (may have a language hint after the opening fence)
  const masked = text.replace(/```[\s\S]*?```/g, (m) => '\x00'.repeat(m.length))
  // Inline code spans: `…` (single backtick, non-greedy)
  return masked.replace(/`[^`\n]*`/g, (m) => '\x00'.repeat(m.length))
}

export function parseEditorArtifacts(content: string): {
  displayText: string
  artifacts: EditorArtifact[]
} {
  const masked = maskCodeRegions(content)
  const artifacts: EditorArtifact[] = []

  // Collect all match offsets from the masked string so that tags inside
  // code fences or inline-code spans are silently ignored.
  const matchRanges: Array<{ start: number; end: number }> = []
  for (const m of masked.matchAll(EDITOR_BLOCK_RE)) {
    matchRanges.push({ start: m.index, end: m.index + m[0].length })
  }

  // Build displayText by removing matched ranges from the *original* content.
  let displayText = ''
  let cursor = 0
  for (const range of matchRanges) {
    displayText += content.slice(cursor, range.start)
    // Extract artifact data from the original content at this range
    const original = content.slice(range.start, range.end)
    const op = original.match(/op="(replace|append)"/)
    const operation: 'replace' | 'append' = op?.[1] === 'append' ? 'append' : 'replace'
    const inner = original.match(/<axon:editor[^>]*>([\s\S]*?)<\/axon:editor>/)
    const blockContent = inner?.[1]?.trim() ?? ''
    if (blockContent) {
      artifacts.push({
        content: blockContent,
        operation,
        title: extractTitle(blockContent),
        wordCount: blockContent.split(/\s+/).filter(Boolean).length,
      })
    }
    cursor = range.end
  }
  displayText += content.slice(cursor)
  return { displayText: displayText.trim(), artifacts }
}

function EditorArtifactCard({
  artifact,
  onEditorContent,
  variant = 'desktop',
}: {
  artifact: EditorArtifact
  onEditorContent?: (content: string, operation: 'replace' | 'append') => void
  variant?: 'mobile' | 'desktop'
}) {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the pending copy-reset timer if the card unmounts before it fires.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  function openInEditor() {
    onEditorContent?.(artifact.content, artifact.operation)
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(artifact.content)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const previewLimit = variant === 'desktop' ? 600 : 280
  const preview = extractPreview(artifact.content, previewLimit)
  const bodyLength = artifact.content.replace(/^#{1,6}\s.+$/gm, '').trim().length

  return (
    <Artifact
      className="mt-2 cursor-pointer border-[rgba(135,175,255,0.2)] bg-[linear-gradient(140deg,rgba(135,175,255,0.07),rgba(7,12,26,0.85))] transition-colors hover:border-[rgba(135,175,255,0.35)] hover:bg-[linear-gradient(140deg,rgba(135,175,255,0.1),rgba(7,12,26,0.9))]"
      onClick={openInEditor}
    >
      <ArtifactHeader>
        <div className="flex min-w-0 items-center gap-2.5">
          <FileCode2 className="size-4 shrink-0 text-[var(--axon-primary)]" />
          <div className="min-w-0">
            <ArtifactTitle className="truncate">{artifact.title}</ArtifactTitle>
            <ArtifactDescription>
              {artifact.wordCount} words
              {' · '}
              {artifact.operation === 'append' ? 'appended to editor' : 'opened in editor'}
            </ArtifactDescription>
          </div>
        </div>
        <ArtifactActions onClick={(e) => e.stopPropagation()}>
          <ArtifactAction
            tooltip={copied ? 'Copied!' : 'Copy'}
            label="Copy content"
            icon={copied ? Check : Copy}
            onClick={() => void copyContent()}
          />
          <ArtifactAction
            tooltip="Open in editor"
            label="Open in editor"
            icon={Pencil}
            onClick={openInEditor}
          />
        </ArtifactActions>
      </ArtifactHeader>
      {preview ? (
        <ArtifactContent className="border-[rgba(135,175,255,0.12)]">
          <p
            className={`text-xs leading-relaxed text-[var(--text-secondary)] ${variant === 'desktop' ? 'line-clamp-6' : 'line-clamp-3'}`}
          >
            {preview}
            {bodyLength > previewLimit ? '…' : ''}
          </p>
        </ArtifactContent>
      ) : null}
    </Artifact>
  )
}

export function AssistantMessageBody({
  content,
  onEditorContent,
  variant = 'desktop',
}: {
  content: string
  onEditorContent?: (content: string, operation: 'replace' | 'append') => void
  variant?: 'mobile' | 'desktop'
}) {
  const { displayText, artifacts } = parseEditorArtifacts(content)
  return (
    <>
      {displayText ? <MessageResponse>{displayText}</MessageResponse> : null}
      {artifacts.map((artifact, i) => (
        <EditorArtifactCard
          key={i}
          artifact={artifact}
          onEditorContent={onEditorContent}
          variant={variant}
        />
      ))}
    </>
  )
}
