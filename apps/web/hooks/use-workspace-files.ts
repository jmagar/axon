'use client'

import { useEffect, useState } from 'react'
import type { FileEntry } from '@/components/workspace/file-tree'
import { apiFetch } from '@/lib/api-fetch'

export function useWorkspaceFiles() {
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [fileLoading, setFileLoading] = useState(true)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>('lib/supabase.ts')

  useEffect(() => {
    let cancelled = false

    setFileLoading(true)
    apiFetch('/api/workspace?action=list&path=')
      .then(async (response) => {
        const data = (await response.json()) as { items?: FileEntry[] }
        if (!cancelled) {
          setFileEntries(data.items ?? [])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFileEntries([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFileLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { fileEntries, fileLoading, selectedFilePath, setSelectedFilePath }
}
