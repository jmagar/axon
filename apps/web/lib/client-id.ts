/**
 * Generate client-side IDs in both secure and insecure contexts.
 * `crypto.randomUUID()` is unavailable on non-secure origins (for example
 * http://10.x.x.x on mobile LAN), so we must gracefully fall back.
 */
function createFallbackId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Create a client-side ID with an optional prefix.
 * Without a prefix, returns a bare UUID (or UUID-shaped fallback).
 * With a prefix, returns `${prefix}-${uuid}`.
 */
export function createClientId(prefix?: string): string {
  let uuid: string | undefined
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      uuid = crypto.randomUUID()
    }
  } catch {
    // Fall through to non-crypto fallback.
  }

  if (uuid !== undefined) {
    return prefix ? `${prefix}-${uuid}` : uuid
  }

  return prefix
    ? createFallbackId(prefix)
    : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}
