import { describe, expect, it } from 'vitest'
import type {
  WsServerMsg,
  WsV2ArtifactListMsg,
  WsV2CommandContext,
  WsV2CommandStartMsg,
  WsV2JobProgressMsg,
  WsV2JobStatusMsg,
} from '../ws-protocol'

describe('ws protocol v2 message shapes', () => {
  const ctx: WsV2CommandContext = {
    exec_id: 'exec-123',
    mode: 'crawl',
    input: 'https://example.com',
  }

  it('models command.start with shared ctx inside data', () => {
    const message: WsV2CommandStartMsg = {
      type: 'command.start',
      data: {
        ctx,
      },
    }
    const serverMessage: WsServerMsg = message

    expect(serverMessage).toEqual({
      type: 'command.start',
      data: { ctx },
    })
  })

  it('models job.status payload including metrics and optional error', () => {
    const message: WsV2JobStatusMsg = {
      type: 'job.status',
      data: {
        ctx,
        payload: {
          status: 'running',
          error: 'none',
          metrics: {
            pages_crawled: 2,
            thin_pages: 0,
          },
        },
      },
    }
    const serverMessage: WsServerMsg = message

    expect(serverMessage).toEqual({
      type: 'job.status',
      data: {
        ctx,
        payload: {
          status: 'running',
          error: 'none',
          metrics: {
            pages_crawled: 2,
            thin_pages: 0,
          },
        },
      },
    })
  })

  it('models job.progress payload with optional counters omitted', () => {
    const message: WsV2JobProgressMsg = {
      type: 'job.progress',
      data: {
        ctx,
        payload: {
          phase: 'fetching',
          percent: 25,
        },
      },
    }

    expect(message.data.payload.phase).toBe('fetching')
    expect(message.data.payload.percent).toBe(25)
    expect(message.data.payload.processed).toBeUndefined()
    expect(message.data.payload.total).toBeUndefined()
  })

  it('models artifact.list entries with optional fields', () => {
    const message: WsV2ArtifactListMsg = {
      type: 'artifact.list',
      data: {
        ctx,
        artifacts: [
          {
            kind: 'screenshot',
            path: 'output/report.png',
            download_url: '/download/job-1/file/output/report.png',
            mime: 'image/png',
            size_bytes: 1024,
          },
          {
            path: 'output/summary.md',
          },
        ],
      },
    }

    expect(message.data.artifacts).toHaveLength(2)
    expect(message.data.artifacts[0]).toMatchObject({
      kind: 'screenshot',
      size_bytes: 1024,
    })
    expect(message.data.artifacts[1]).toEqual({
      path: 'output/summary.md',
    })
  })
})
