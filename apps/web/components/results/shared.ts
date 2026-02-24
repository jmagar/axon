/** Shared utilities for result renderers. */

export function fmtNum(n: number): string {
  return n.toLocaleString()
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
