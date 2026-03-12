type LogLevel = 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

function emit(level: LogLevel, event: string, context: LogContext = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  }

  const line = JSON.stringify(payload)
  if (level === 'error') {
    console.error(line)
    return
  }
  if (level === 'warn') {
    console.warn(line)
    return
  }
  console.log(line)
}

export function logInfo(event: string, context?: LogContext): void {
  emit('info', event, context)
}

export function logWarn(event: string, context?: LogContext): void {
  emit('warn', event, context)
}

export function logError(event: string, context?: LogContext): void {
  emit('error', event, context)
}
