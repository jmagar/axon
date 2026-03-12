'use client'

import { AlertCircle, BrainCircuit, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import {
  buildMissionControlModel,
  type MissionControlModel,
} from '@/lib/cortex/mission-control-model'
import type { CortexOverview } from '@/lib/cortex/overview-normalize'
import type { DoctorResult, SourcesPagedResult, SourcesResult } from '@/lib/result-types'
import { ActionRail } from './mission-control/action-rail'
import { CorpusMap } from './mission-control/corpus-map'
import { HealthStrip } from './mission-control/health-strip'
import { HeroKpis } from './mission-control/hero-kpis'
import { JobsConsole } from './mission-control/jobs-console'
import { QueueRadar } from './mission-control/queue-radar'

interface OverviewResponse {
  ok: boolean
  data?: CortexOverview
  error?: string
}

interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

function toSourceCount(payload: SourcesResult): number {
  if (payload && typeof payload === 'object' && 'urls' in payload) {
    return (payload as SourcesPagedResult).count ?? (payload as SourcesPagedResult).urls.length
  }
  return Object.keys(payload ?? {}).length
}

export function MissionControlPane() {
  const [model, setModel] = useState<MissionControlModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [sourcesBusy, setSourcesBusy] = useState(false)
  const [railMessage, setRailMessage] = useState<string | null>(null)
  const [jobsConsoleOpen, setJobsConsoleOpen] = useState(false)
  const jobsConsoleRef = useRef<HTMLElement | null>(null)

  const load = useCallback(async (manual = false) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), 12_000)
    if (manual) setRefreshing(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cortex/overview', { signal: controller.signal })
      const json = (await res.json()) as OverviewResponse
      if (!json.ok || !json.data) {
        throw new Error(json.error ?? 'Failed to load mission control overview')
      }
      setModel(buildMissionControlModel(json.data))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('aborted') || message.includes('AbortError')) {
        setError('Cortex overview timed out. Try Refresh to retry.')
      } else {
        setError(message)
      }
    } finally {
      clearTimeout(timer)
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runDoctorSweep = useCallback(async () => {
    setDoctorBusy(true)
    setRailMessage('Running doctor sweep…')
    try {
      const res = await apiFetch('/api/cortex/doctor')
      const json = (await res.json()) as ApiResponse<DoctorResult>
      if (!json.ok || !json.data) {
        throw new Error(json.error ?? 'Doctor sweep failed')
      }
      const unhealthy = Object.values(json.data.services ?? {}).filter((svc) => !svc.ok).length
      setRailMessage(
        json.data.all_ok
          ? 'Doctor sweep complete: all services healthy.'
          : `Doctor sweep complete: ${unhealthy} unhealthy service(s).`,
      )
      await load(true)
    } catch (err) {
      setRailMessage(`Doctor sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDoctorBusy(false)
    }
  }, [load])

  const inspectSources = useCallback(async () => {
    setSourcesBusy(true)
    setRailMessage('Inspecting indexed sources…')
    try {
      const res = await apiFetch('/api/cortex/sources')
      const json = (await res.json()) as ApiResponse<SourcesResult>
      if (!json.ok || !json.data) {
        throw new Error(json.error ?? 'Source inspection failed')
      }
      setRailMessage(`Indexed sources discovered: ${toSourceCount(json.data)}.`)
      await load(true)
    } catch (err) {
      setRailMessage(
        `Source inspection failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setSourcesBusy(false)
    }
  }, [load])

  const openJobsConsole = useCallback(() => {
    setJobsConsoleOpen(true)
    setRailMessage('Jobs console opened.')
    requestAnimationFrame(() => {
      jobsConsoleRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  return (
    <section className="axon-mission-control mx-auto w-full max-w-7xl p-4 md:p-6">
      <header className="mb-4 flex items-center gap-2">
        <BrainCircuit className="size-5 text-[var(--mc-accent-cyan)]" />
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Mission Control
        </h1>
      </header>

      {loading && (
        <div className="axon-mission-card flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 className="size-4 animate-spin" />
          Loading mission telemetry…
        </div>
      )}

      {!loading && error && (
        <div className="axon-mission-card flex items-start gap-2 text-sm text-[var(--status-failed)]">
          <AlertCircle className="size-4" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          <div className="axon-mission-grid grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <HeroKpis model={model} />
              <HealthStrip model={model} />
              <QueueRadar model={model} />
              <CorpusMap model={model} />
            </div>
            <ActionRail
              model={model}
              onRefresh={() => void load(true)}
              onDoctorSweep={() => void runDoctorSweep()}
              onInspectSources={() => void inspectSources()}
              onOpenJobsConsole={openJobsConsole}
              jobsConsoleOpen={jobsConsoleOpen}
              railMessage={railMessage}
              doctorBusy={doctorBusy}
              sourcesBusy={sourcesBusy}
              refreshing={refreshing}
            />
          </div>

          {jobsConsoleOpen && <JobsConsole model={model} panelRef={jobsConsoleRef} />}
        </div>
      )}
    </section>
  )
}
