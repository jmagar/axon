import { describe, expect, it } from 'vitest'

interface LogEntry {
  text: string
  ts: number
  service?: string
}

function appendLogEntry(buffer: LogEntry[], entry: LogEntry, maxLines: number): LogEntry[] {
  if (buffer.length >= maxLines) {
    const trimmed = buffer.slice(buffer.length - maxLines + 1)
    trimmed.push(entry)
    return trimmed
  }
  return [...buffer, entry]
}

describe('appendLogEntry', () => {
  it('appends entry within limit', () => {
    const buf: LogEntry[] = [
      { text: 'a', ts: 1 },
      { text: 'b', ts: 2 },
    ]
    const result = appendLogEntry(buf, { text: 'c', ts: 3 }, 10)
    expect(result).toHaveLength(3)
    expect(result[2].text).toBe('c')
  })

  it('trims oldest when at limit', () => {
    const buf: LogEntry[] = [
      { text: 'a', ts: 1 },
      { text: 'b', ts: 2 },
      { text: 'c', ts: 3 },
    ]
    const result = appendLogEntry(buf, { text: 'd', ts: 4 }, 3)
    expect(result).toHaveLength(3)
    expect(result[0].text).toBe('b')
    expect(result[2].text).toBe('d')
  })

  it('handles empty buffer', () => {
    const result = appendLogEntry([], { text: 'x', ts: 1 }, 5)
    expect(result).toEqual([{ text: 'x', ts: 1 }])
  })
})
