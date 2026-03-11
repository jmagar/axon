import { describe, expect, it } from 'vitest'
import { shouldSyncHistoricalMessages } from '@/components/reboot/live-message-sync'

describe('shouldSyncHistoricalMessages', () => {
  it('blocks sync while streaming/loading/error', () => {
    expect(
      shouldSyncHistoricalMessages({
        isStreaming: true,
        sessionLoading: false,
        sessionError: null,
        sessionChanged: false,
        historicalCount: 10,
        liveCount: 10,
      }),
    ).toBe(false)

    expect(
      shouldSyncHistoricalMessages({
        isStreaming: false,
        sessionLoading: true,
        sessionError: null,
        sessionChanged: false,
        historicalCount: 10,
        liveCount: 10,
      }),
    ).toBe(false)

    expect(
      shouldSyncHistoricalMessages({
        isStreaming: false,
        sessionLoading: false,
        sessionError: 'boom',
        sessionChanged: false,
        historicalCount: 10,
        liveCount: 10,
      }),
    ).toBe(false)
  })

  it('still blocks empty/stale overwrite even when sessionChanged is true', () => {
    expect(
      shouldSyncHistoricalMessages({
        isStreaming: false,
        sessionLoading: false,
        sessionError: null,
        sessionChanged: true,
        historicalCount: 0,
        liveCount: 8,
      }),
    ).toBe(false)
  })

  it('blocks stale historical overwrite when live has more messages', () => {
    expect(
      shouldSyncHistoricalMessages({
        isStreaming: false,
        sessionLoading: false,
        sessionError: null,
        sessionChanged: false,
        historicalCount: 0,
        liveCount: 2,
      }),
    ).toBe(false)

    expect(
      shouldSyncHistoricalMessages({
        isStreaming: false,
        sessionLoading: false,
        sessionError: null,
        sessionChanged: false,
        historicalCount: 2,
        liveCount: 4,
      }),
    ).toBe(false)
  })

  it('allows sync when historical is current or richer', () => {
    expect(
      shouldSyncHistoricalMessages({
        isStreaming: false,
        sessionLoading: false,
        sessionError: null,
        sessionChanged: false,
        historicalCount: 3,
        liveCount: 3,
      }),
    ).toBe(true)

    expect(
      shouldSyncHistoricalMessages({
        isStreaming: false,
        sessionLoading: false,
        sessionError: null,
        sessionChanged: false,
        historicalCount: 5,
        liveCount: 3,
      }),
    ).toBe(true)
  })
})
