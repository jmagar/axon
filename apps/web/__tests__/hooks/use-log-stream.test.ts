/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { useLogStream } from '../../hooks/use-log-stream'

describe('useLogStream', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('connects and receives log entries', async () => {
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(`data: ${JSON.stringify({ line: 'hello', ts: 1 })}\n\n`),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }

    ;(global.fetch as Mock).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => mockReader,
      },
    })

    const { result } = renderHook(() => useLogStream({ service: 'all', tail: 10, enabled: true }))

    await waitFor(() => {
      expect(result.current.lines).toHaveLength(1)
      expect(result.current.lines[0]!.text).toBe('hello')
    })
    await waitFor(() => {
      expect(result.current.isConnected).toBe(false)
    })
  })

  it('handles empty buffer via clear()', () => {
    const { result } = renderHook(() => useLogStream({ service: 'all', tail: 10, enabled: false }))
    act(() => {
      result.current.clear()
    })
    expect(result.current.lines).toEqual([])
  })
})
