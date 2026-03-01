'use client'

import { useEffect, useRef, useState } from 'react'

interface DocMeta {
  createdAt: string
  tags: string[]
  collections: string[]
}

export function usePulseAutosave(
  documentMarkdown: string,
  documentTitle: string,
  docFilename?: string | null,
) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedFilename, setSavedFilename] = useState<string | null>(docFilename ?? null)
  const filenameRef = useRef<string | null>(docFilename ?? null)
  // Caches createdAt/tags/collections from last save response — sent back on updates
  // so updatePulseDoc can skip the file read entirely.
  const docMetaRef = useRef<DocMeta | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveAbortRef = useRef<AbortController | null>(null)
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedSnapshotRef = useRef('')

  // Keep refs in sync when docFilename prop changes (e.g. after loading a different file).
  // Reset snapshot guard so loaded content doesn't trigger a phantom re-save.
  useEffect(() => {
    filenameRef.current = docFilename ?? null
    docMetaRef.current = null
    setSavedFilename(docFilename ?? null)
    lastSavedSnapshotRef.current = ''
  }, [docFilename])

  // Debounced save effect — 1500ms debounce, POST to /api/pulse/save
  useEffect(() => {
    if (!documentMarkdown || !documentTitle) return

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    const snapshot = `${documentTitle}\n---\n${documentMarkdown}`
    if (snapshot === lastSavedSnapshotRef.current) return
    autosaveTimerRef.current = setTimeout(() => {
      void (async () => {
        if (autosaveAbortRef.current) {
          autosaveAbortRef.current.abort()
        }
        const controller = new AbortController()
        autosaveAbortRef.current = controller
        try {
          setSaveStatus('saving')
          const body: Record<string, unknown> = {
            title: documentTitle,
            markdown: documentMarkdown,
            embed: true,
          }
          if (filenameRef.current) {
            body.filename = filenameRef.current
            // Include cached metadata so the server can skip the file read on updates
            if (docMetaRef.current) {
              body.createdAt = docMetaRef.current.createdAt
              body.tags = docMetaRef.current.tags
              body.collections = docMetaRef.current.collections
            }
          }
          const response = await fetch('/api/pulse/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify(body),
          })
          if (response.ok) {
            lastSavedSnapshotRef.current = snapshot
            setSaveStatus('saved')
            const data = (await response.json()) as {
              filename?: string
              createdAt?: string
              tags?: string[]
              collections?: string[]
            }
            if (data.filename) {
              filenameRef.current = data.filename
              setSavedFilename(data.filename)
            }
            // Cache metadata for next save to eliminate the file read
            if (data.createdAt && data.tags && data.collections) {
              docMetaRef.current = {
                createdAt: data.createdAt,
                tags: data.tags,
                collections: data.collections,
              }
            }
            // Reset to idle only on success — error state stays visible until next save attempt
            if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current)
            idleTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
          } else {
            setSaveStatus('error')
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') return
          setSaveStatus('error')
        } finally {
          if (autosaveAbortRef.current === controller) {
            autosaveAbortRef.current = null
          }
        }
      })()
    }, 1500)

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [documentMarkdown, documentTitle])

  // Cleanup on unmount — abort both timers and requests
  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current)
      if (autosaveAbortRef.current) {
        autosaveAbortRef.current.abort()
        autosaveAbortRef.current = null
      }
    }
  }, [])

  return { saveStatus, savedFilename }
}
