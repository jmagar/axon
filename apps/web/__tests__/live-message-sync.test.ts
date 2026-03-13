import { describe, expect, it } from 'vitest'
import {
  mergeHistoricalMessages,
  shouldSyncHistoricalMessages,
} from '@/components/shell/live-message-sync'

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

describe('mergeHistoricalMessages', () => {
  it('matches by sourceMessageId before index/content fallback', () => {
    const historical = [
      {
        id: 'h1',
        sourceMessageId: 'msg-2',
        role: 'assistant' as const,
        content: 'Second',
        timestamp: 1,
      },
      {
        id: 'h2',
        sourceMessageId: 'msg-1',
        role: 'assistant' as const,
        content: 'First',
        timestamp: 1,
      },
    ]
    const live = [
      {
        id: 'l1',
        sourceMessageId: 'msg-1',
        role: 'assistant' as const,
        content: 'First',
        timestamp: 1,
      },
      {
        id: 'l2',
        sourceMessageId: 'msg-2',
        role: 'assistant' as const,
        content: 'Second',
        timestamp: 1,
        toolUses: [{ name: 'exec_command', input: {}, toolCallId: 't2' }],
      },
    ]

    const merged = mergeHistoricalMessages(historical, live)
    expect(merged[0]?.toolUses?.[0]?.toolCallId).toBe('t2')
  })

  it('does not fuzzy-match by whitespace-normalized content', () => {
    const historical = [
      { id: 'h1', role: 'assistant' as const, content: 'Hello world', timestamp: 1 },
    ]
    const live = [
      {
        id: 'l1',
        role: 'assistant' as const,
        content: 'Hello   world',
        timestamp: 1,
        toolUses: [{ name: 'exec_command', input: {}, toolCallId: 't1', status: 'completed' }],
      },
    ]

    const merged = mergeHistoricalMessages(historical, live)
    expect(merged[0]?.toolUses).toBeUndefined()
  })

  it('does not attach metadata across role mismatch', () => {
    const historical = [{ id: 'h1', role: 'assistant' as const, content: 'Done', timestamp: 1 }]
    const live = [
      {
        id: 'l1',
        role: 'user' as const,
        content: 'Done',
        timestamp: 1,
        toolUses: [{ name: 'exec_command', input: {} }],
      },
    ]

    const merged = mergeHistoricalMessages(historical, live)
    expect(merged[0]?.toolUses).toBeUndefined()
  })
})
