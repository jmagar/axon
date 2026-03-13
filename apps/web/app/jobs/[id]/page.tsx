'use client'

import { use, useCallback, useEffect, useState } from 'react'
import type { JobDetail } from '@/app/api/jobs/[id]/route'
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling'
import { apiFetch } from '@/lib/api-fetch'
import {
  buildJobDetailRequestPath,
  shouldRefetchArtifactsOnTerminalTransition,
} from './job-detail-helpers'
import { JobDetailErrorState, JobDetailLoadingState, JobDetailView } from './job-detail-ui'

export {
  buildJobDetailRequestPath,
  flattenJsonEntries,
  getRefreshSummaryRows,
  shouldRefetchArtifactsOnTerminalTransition,
} from './job-detail-helpers'

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [job, setJob] = useState<JobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchJob = useCallback(
    async (includeArtifacts = true) => {
      try {
        const res = await apiFetch(buildJobDetailRequestPath(id, includeArtifacts))
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        const data = (await res.json()) as JobDetail
        let needsArtifactRefetch = false
        setJob((previous) => {
          if (
            previous &&
            !includeArtifacts &&
            shouldRefetchArtifactsOnTerminalTransition(previous.status, data.status)
          ) {
            needsArtifactRefetch = true
          }
          if (!previous) return data
          return {
            ...data,
            observedUrls: data.observedUrls ?? previous.observedUrls,
            markdownFiles: data.markdownFiles ?? previous.markdownFiles,
            thinUrls: data.thinUrls ?? previous.thinUrls,
            wafBlockedUrls: data.wafBlockedUrls ?? previous.wafBlockedUrls,
          }
        })
        if (needsArtifactRefetch) {
          void fetchJob(true)
        }
        setError(null)
      } catch {
        setError('Failed to fetch job')
      } finally {
        setLoading(false)
      }
    },
    [id],
  )

  useEffect(() => {
    void fetchJob(true)
  }, [fetchJob])

  useAdaptivePolling(() => fetchJob(false), 3000, {
    enabled: job?.status === 'running',
    pauseWhenHidden: true,
    jitterRatio: 0.1,
  })

  if (loading) return <JobDetailLoadingState />
  if (error || !job) return <JobDetailErrorState error={error} />
  return <JobDetailView job={job} />
}
