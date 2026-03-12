'use client'

import { PulseAgent, PulsePermissionLevel } from '@/lib/pulse/types'
import { getStorageItem, removeStorageItem, setStorageItem } from '@/lib/storage'

// ── localStorage keys ────────────────────────────────────────────────────────

export const LS_WORKSPACE_MODE = 'axon.web.workspace-mode'
export const LS_PULSE_AGENT = 'axon.web.pulse-agent'
export const LS_PULSE_MODEL = 'axon.web.pulse-model'
export const LS_PULSE_PERMISSION = 'axon.web.pulse-permission'

export const VALID_AGENTS = new Set(PulseAgent.options)
export const VALID_PERMISSIONS = new Set(PulsePermissionLevel.options)

// ── localStorage helpers — thin aliases over lib/storage ─────────────────────
// These exist so provider.ts imports stay local to the hooks/ws-messages module.

export const safeGetItem = getStorageItem
export const safeSetItem = setStorageItem
export const safeRemoveItem = removeStorageItem

/**
 * Validate a raw localStorage string against a known set of allowed values.
 * Returns the validated value or the fallback if invalid/missing.
 */
export function validateStoredEnum<T extends string>(
  raw: string | null,
  allowed: Set<string>,
  fallback: T,
): T {
  if (raw && allowed.has(raw)) return raw as T
  return fallback
}
