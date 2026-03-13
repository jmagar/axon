import { describe, expect, it } from 'vitest'
import type { WsServerMsg } from '@/lib/ws-protocol'

describe('ws-protocol editor_update', () => {
  it('editor_update replace message is assignable to WsServerMsg', () => {
    const msg: WsServerMsg = {
      type: 'editor_update',
      content: '# README\n\nHello world',
      operation: 'replace',
    }
    expect(msg.type).toBe('editor_update')
    expect(msg.content).toBe('# README\n\nHello world')
    expect(msg.operation).toBe('replace')
  })

  it('editor_update append message is assignable to WsServerMsg', () => {
    const msg: WsServerMsg = {
      type: 'editor_update',
      content: '\n## Additional section',
      operation: 'append',
    }
    expect(msg.operation).toBe('append')
  })

  it('editor_update content and operation are required', () => {
    // This is a compile-time check; just verify we can construct one
    const msgs: WsServerMsg[] = [
      { type: 'editor_update', content: 'test', operation: 'replace' },
      { type: 'editor_update', content: '', operation: 'append' },
    ]
    expect(msgs).toHaveLength(2)
  })
})
