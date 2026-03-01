'use client'

export interface LogEntry {
  text: string
  ts: number
}

function getLineColor(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('error')) return 'text-red-400'
  if (lower.includes('warn')) return 'text-yellow-400'
  if (lower.includes('debug')) return 'text-[var(--text-dim)]'
  if (lower.includes('info')) return 'text-[var(--text-secondary)]'
  return 'text-[var(--text-secondary)]'
}

interface LogLineProps {
  entry: LogEntry
}

export function LogLine({ entry }: LogLineProps) {
  return (
    <div
      className={`select-text break-all leading-relaxed ${getLineColor(entry.text)}`}
      style={{ paddingBlock: '1px' }}
    >
      {entry.text}
    </div>
  )
}
