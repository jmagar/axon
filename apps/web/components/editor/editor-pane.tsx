'use client'

import { serializeMd } from '@platejs/markdown'
import {
  Bold,
  Braces,
  Code2,
  FileJson,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Slash,
  Sparkles,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
} from 'lucide-react'
import { Plate, usePlateEditor } from 'platejs/react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import {
  AlignButton,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  MoreFormattingDropdown,
} from '@/components/editor/editor-pane-controls'
import { SourceViewPanel } from '@/components/editor/editor-source-view-panel'
import { CopilotKit } from '@/components/editor/plugins/copilot-kit'
import { AIToolbarButton } from '@/components/ui/ai-toolbar-button'
import { BlockContextMenu } from '@/components/ui/block-context-menu'
import { BlockTypeButton } from '@/components/ui/block-type-button'
import { CommentToolbarButton } from '@/components/ui/comment-toolbar-button'
import { Editor, EditorContainer } from '@/components/ui/editor'
import { ExportToolbarButton } from '@/components/ui/export-toolbar-button'
import { FloatingLink } from '@/components/ui/floating-link'
import { FloatingToolbar } from '@/components/ui/floating-toolbar'
import { LinkToolbarButton } from '@/components/ui/link-toolbar-button'
import { ListToolbarButton } from '@/components/ui/list-toolbar-button'
import { MarkToolbarButton } from '@/components/ui/mark-toolbar-button'
import { Toolbar, ToolbarButton, ToolbarGroup } from '@/components/ui/toolbar'
import { markdownToPlateNodes } from '@/lib/markdown'

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((s) => /\w/.test(s)).length
}

const EXTERNAL_UPDATE_RETRY_LIMIT = 3

interface PulseEditorPaneProps {
  markdown: string
  onMarkdownChange: (md: string) => void
  scrollStorageKey?: string
}

export const PulseEditorPane = memo(function PulseEditorPane({
  markdown,
  onMarkdownChange,
  scrollStorageKey = 'axon.web.pulse.editor-scroll',
}: PulseEditorPaneProps) {
  // Memoize the initial Plate value so markdownToPlateNodes() is not called on every render.
  // Only the first markdown prop matters — subsequent updates are applied via the effect below.
  const [initialMarkdown] = useState(markdown)
  const initialValue = useMemo(() => markdownToPlateNodes(initialMarkdown), [initialMarkdown])
  const editor = usePlateEditor({
    plugins: CopilotKit,
    // biome-ignore lint/suspicious/noExplicitAny: Plate value typing mismatch with Descendant[]
    value: initialValue as any,
  })
  const isApplyingExternalUpdateRef = useRef(false)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAppliedMarkdownRef = useRef<string>(markdown)
  const lastAttemptedMarkdownRef = useRef<string>(markdown)
  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const externalUpdateRetryCountRef = useRef(0)
  const [wordCount, setWordCount] = useState(() => countWords(markdown))
  const [sourceMode, setSourceMode] = useState<'markdown' | 'json' | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (markdown !== lastAttemptedMarkdownRef.current) {
      externalUpdateRetryCountRef.current = 0
      lastAttemptedMarkdownRef.current = markdown
    }

    // retryTick is intentionally in the dependency array to force a re-run after
    // a catch failure below — reading it here satisfies the exhaustive-deps rule.
    void retryTick
    if (markdown === lastAppliedMarkdownRef.current) return
    const current = serializeMd(editor)
    if (current === markdown) {
      lastAppliedMarkdownRef.current = markdown
      return
    }
    isApplyingExternalUpdateRef.current = true
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Plate editor value assignment is not strongly typed
      ;(editor as any).children = markdownToPlateNodes(markdown) as any
      // Null the selection before onChange so Plate's normalization doesn't try to
      // resolve a cursor path that no longer exists in the new node tree (scraped
      // content can have a very different structure from what was there before).
      // biome-ignore lint/suspicious/noExplicitAny: Plate selection reset
      ;(editor as any).selection = null
      ;(editor as unknown as { onChange: () => void }).onChange()
    } catch (err) {
      // onChange threw (e.g. a plugin normalizer failed on complex scraped content).
      // Reset the guard flag and schedule a retry — bumping retryTick forces this
      // effect to re-run even though markdown/editor haven't changed.
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PulseEditorPane] external update failed, scheduling retry:', err)
      }
      isApplyingExternalUpdateRef.current = false
      externalUpdateRetryCountRef.current += 1
      if (externalUpdateRetryCountRef.current > EXTERNAL_UPDATE_RETRY_LIMIT) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PulseEditorPane] external update retry limit reached')
        }
        return
      }
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => setRetryTick((n) => n + 1), 500)
      return
    }
    isApplyingExternalUpdateRef.current = false
    lastAppliedMarkdownRef.current = markdown
    setWordCount(countWords(markdown))
  }, [editor, markdown, retryTick])

  // Defer scroll restore one frame so content has rendered before we set scrollTop.
  useEffect(() => {
    const node = editorScrollRef.current
    if (!node) return
    const timerId = setTimeout(() => {
      try {
        const saved = Number(window.localStorage.getItem(scrollStorageKey) ?? 0)
        if (Number.isFinite(saved) && saved > 0) node.scrollTop = saved
      } catch {
        // Ignore storage restore failures.
      }
    }, 0)
    return () => clearTimeout(timerId)
  }, [scrollStorageKey])

  // Cleanup debounce timers on unmount.
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      if (wordCountTimerRef.current) clearTimeout(wordCountTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  return (
    <DndProvider backend={HTML5Backend}>
      <Plate
        editor={editor}
        onChange={() => {
          if (isApplyingExternalUpdateRef.current) return
          const md = serializeMd(editor)
          lastAppliedMarkdownRef.current = md
          onMarkdownChange(md)
          if (wordCountTimerRef.current) clearTimeout(wordCountTimerRef.current)
          wordCountTimerRef.current = setTimeout(() => setWordCount(countWords(md)), 300)
        }}
      >
        <div className="axon-editor flex h-full min-h-0 flex-col">
          {/* ── Desktop toolbar (hidden on mobile) ─────────────────────────────── */}
          <div
            className="bg-[rgba(10,18,35,0.32)] px-1.5 py-1"
            style={{
              backdropFilter: 'blur(8px) saturate(180%)',
              boxShadow: '0 1px 0 rgba(135, 175, 255, 0.07)',
            }}
          >
            <div className="mb-1 flex items-center justify-between px-1.5">
              <p className="ui-label flex-none">Editor</p>
            </div>

            {/* Mobile compact toolbar */}
            <Toolbar className="flex items-center gap-0.5 sm:hidden">
              <AIToolbarButton size="sm" tooltip="AI (Ctrl+J)">
                <Sparkles className="size-3.5" />
              </AIToolbarButton>
              <MarkToolbarButton nodeType="bold" tooltip="Bold (Ctrl+B)">
                <Bold className="size-3.5" />
              </MarkToolbarButton>
              <MarkToolbarButton nodeType="italic" tooltip="Italic (Ctrl+I)">
                <Italic className="size-3.5" />
              </MarkToolbarButton>
              <LinkToolbarButton size="sm" tooltip="Link (Ctrl+K)">
                <Link2 className="size-3.5" />
              </LinkToolbarButton>
              <MoreFormattingDropdown />
            </Toolbar>

            {/* Desktop full toolbar */}
            <Toolbar className="hidden flex-wrap gap-0.5 sm:flex">
              <ToolbarGroup>
                <ToolbarButton
                  size="sm"
                  tooltip="Undo (Ctrl+Z)"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.undo()
                  }}
                >
                  <Undo2 className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton
                  size="sm"
                  tooltip="Redo (Ctrl+Y)"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.redo()
                  }}
                >
                  <Redo2 className="size-3.5" />
                </ToolbarButton>
              </ToolbarGroup>
              <ToolbarGroup>
                <AIToolbarButton size="sm" tooltip="AI (Ctrl+J)">
                  <Sparkles className="size-3.5" />
                </AIToolbarButton>
              </ToolbarGroup>
              <ToolbarGroup>
                <BlockTypeButton nodeType="h1" tooltip="Heading 1 (Ctrl+Alt+1)">
                  <Heading1 className="size-3.5" />
                </BlockTypeButton>
                <BlockTypeButton nodeType="h2" tooltip="Heading 2 (Ctrl+Alt+2)">
                  <Heading2 className="size-3.5" />
                </BlockTypeButton>
                <BlockTypeButton nodeType="h3" tooltip="Heading 3 (Ctrl+Alt+3)">
                  <Heading3 className="size-3.5" />
                </BlockTypeButton>
                <BlockTypeButton nodeType="blockquote" tooltip="Quote (Ctrl+Shift+.)">
                  <Quote className="size-3.5" />
                </BlockTypeButton>
                <BlockTypeButton nodeType="code_block" tooltip="Code Block (```)">
                  <Braces className="size-3.5" />
                </BlockTypeButton>
              </ToolbarGroup>
              <ToolbarGroup>
                <ListToolbarButton nodeType="disc" tooltip="Bullet List">
                  <List className="size-3.5" />
                </ListToolbarButton>
                <ListToolbarButton nodeType="decimal" tooltip="Numbered List">
                  <ListOrdered className="size-3.5" />
                </ListToolbarButton>
              </ToolbarGroup>
              <ToolbarGroup>
                <MarkToolbarButton nodeType="bold" tooltip="Bold (Ctrl+B)">
                  <Bold className="size-3.5" />
                </MarkToolbarButton>
                <MarkToolbarButton nodeType="italic" tooltip="Italic (Ctrl+I)">
                  <Italic className="size-3.5" />
                </MarkToolbarButton>
                <MarkToolbarButton nodeType="underline" tooltip="Underline (Ctrl+U)">
                  <Underline className="size-3.5" />
                </MarkToolbarButton>
                <MarkToolbarButton nodeType="strikethrough" tooltip="Strike (Ctrl+Shift+X)">
                  <Strikethrough className="size-3.5" />
                </MarkToolbarButton>
                <MarkToolbarButton nodeType="code" tooltip="Inline code (Ctrl+E)">
                  <Code2 className="size-3.5" />
                </MarkToolbarButton>
                <LinkToolbarButton size="sm" tooltip="Link (Ctrl+K)">
                  <Link2 className="size-3.5" />
                </LinkToolbarButton>
              </ToolbarGroup>
              <ToolbarGroup>
                <MarkToolbarButton nodeType="highlight" tooltip="Highlight (Ctrl+Shift+H)">
                  <Highlighter className="size-3.5" />
                </MarkToolbarButton>
                <MarkToolbarButton nodeType="superscript" tooltip="Superscript (Ctrl+.)">
                  <Superscript className="size-3.5" />
                </MarkToolbarButton>
                <MarkToolbarButton nodeType="subscript" tooltip="Subscript (Ctrl+,)">
                  <Subscript className="size-3.5" />
                </MarkToolbarButton>
              </ToolbarGroup>
              <ToolbarGroup>
                <AlignButton align="left" tooltip="Align left">
                  <AlignLeftIcon className="size-3.5" />
                </AlignButton>
                <AlignButton align="center" tooltip="Align center">
                  <AlignCenterIcon className="size-3.5" />
                </AlignButton>
                <AlignButton align="right" tooltip="Align right">
                  <AlignRightIcon className="size-3.5" />
                </AlignButton>
              </ToolbarGroup>
              <ToolbarGroup>
                <CommentToolbarButton />
                <ExportToolbarButton />
              </ToolbarGroup>
              <ToolbarGroup>
                <ToolbarButton
                  size="sm"
                  tooltip="Markdown source"
                  pressed={sourceMode === 'markdown'}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setSourceMode((sm) => (sm === 'markdown' ? null : 'markdown'))
                  }}
                >
                  <FileText className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton
                  size="sm"
                  tooltip="JSON document"
                  pressed={sourceMode === 'json'}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setSourceMode((sm) => (sm === 'json' ? null : 'json'))
                  }}
                >
                  <FileJson className="size-3.5" />
                </ToolbarButton>
              </ToolbarGroup>
            </Toolbar>
          </div>

          {sourceMode ? (
            <SourceViewPanel
              mode={sourceMode}
              editor={editor}
              onClose={() => setSourceMode(null)}
            />
          ) : (
            <BlockContextMenu>
              <EditorContainer
                ref={editorScrollRef}
                onScroll={() => {
                  if (!editorScrollRef.current) return
                  if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
                  scrollSaveTimerRef.current = setTimeout(() => {
                    try {
                      window.localStorage.setItem(
                        scrollStorageKey,
                        String(editorScrollRef.current?.scrollTop ?? 0),
                      )
                    } catch {
                      // Ignore storage failures.
                    }
                  }, 200)
                }}
                variant="default"
                className="min-h-0 flex-1 overscroll-y-contain"
              >
                <Editor variant="default" placeholder="Start writing, or ask Cortex to help..." />
                <FloatingToolbar />
                <FloatingLink />
              </EditorContainer>
            </BlockContextMenu>
          )}

          {/* ── Desktop footer ──────────────────────────────────────────────────── */}
          <div
            className="hidden shrink-0 items-center gap-2 px-2.5 py-1 sm:flex"
            style={{ boxShadow: '0 -1px 0 rgba(135, 175, 255, 0.07)' }}
          >
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
              <Sparkles className="size-2.5" />
              AI copilot active
            </span>
            <span className="text-[10px] text-[var(--text-dim)] opacity-60">·</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
              <Slash className="size-2.5" />
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-1 font-mono text-[length:var(--text-2xs)] text-[var(--text-dim)]">
                /
              </kbd>{' '}
              slash menu
            </span>
            <span className="text-[10px] text-[var(--text-dim)] opacity-60">·</span>
            <span className="text-[10px] text-[var(--text-dim)]">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-1 font-mono text-[length:var(--text-2xs)] text-[var(--text-dim)]">
                Ctrl+Space
              </kbd>{' '}
              suggest
            </span>
            <span className="text-[10px] text-[var(--text-dim)] opacity-60">·</span>
            <span className="text-[10px] text-[var(--text-dim)]">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-1 font-mono text-[length:var(--text-2xs)] text-[var(--text-dim)]">
                Tab
              </kbd>{' '}
              accept
            </span>
            <span className="text-[10px] text-[var(--text-dim)] opacity-60">·</span>
            <span className="text-[10px] text-[var(--text-dim)]">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-1 font-mono text-[length:var(--text-2xs)] text-[var(--text-dim)]">
                Esc
              </kbd>{' '}
              dismiss
            </span>
            <span className="text-[10px] text-[var(--text-dim)] opacity-60">·</span>
            <span className="tabular-nums text-[10px] text-[var(--text-dim)]">
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
            </span>
          </div>

          {/* ── Mobile footer ───────────────────────────────────────────────────── */}
          <Toolbar
            className="shrink-0 gap-2 px-2.5 py-1.5 sm:hidden pb-[env(safe-area-inset-bottom)]"
            style={{ boxShadow: '0 -1px 0 rgba(135, 175, 255, 0.07)' }}
          >
            <AIToolbarButton size="sm" tooltip="AI">
              <Sparkles className="size-4" />
            </AIToolbarButton>
            <CommentToolbarButton />
            <ExportToolbarButton />
          </Toolbar>
        </div>
      </Plate>
    </DndProvider>
  )
})
