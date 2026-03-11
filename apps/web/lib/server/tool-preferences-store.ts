import { getJobsPgPool } from './pg-pool'

export interface ToolPresetRecord {
  id: string
  name: string
  enabledMcpServers: string[]
  enabledMcpTools: string[]
}

export interface ToolPreferencesRecord {
  enabledMcpServers: string[]
  enabledMcpTools: string[]
  presets: ToolPresetRecord[]
  updatedAt: string
}

const DEFAULT_TOOL_PREFERENCES: ToolPreferencesRecord = {
  enabledMcpServers: [],
  enabledMcpTools: [],
  presets: [],
  updatedAt: new Date(0).toISOString(),
}

const SETTINGS_KEY = 'default'

let initPromise: Promise<void> | null = null

async function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getJobsPgPool()
      await pool.query(`
        CREATE TABLE IF NOT EXISTS axon_web_tool_preferences (
          key TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
    })()
  }
  await initPromise
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizePresets(value: unknown): ToolPresetRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const obj = raw as Record<string, unknown>
      const id = typeof obj.id === 'string' ? obj.id.trim() : ''
      const name = typeof obj.name === 'string' ? obj.name.trim() : ''
      if (!id || !name) return null
      return {
        id,
        name,
        enabledMcpServers: normalizeStringArray(obj.enabledMcpServers),
        enabledMcpTools: normalizeStringArray(obj.enabledMcpTools),
      } satisfies ToolPresetRecord
    })
    .filter((item): item is ToolPresetRecord => item !== null)
    .slice(0, 50)
}

function normalizePayload(value: unknown): ToolPreferencesRecord {
  if (!value || typeof value !== 'object') return DEFAULT_TOOL_PREFERENCES
  const obj = value as Record<string, unknown>
  const updatedAt =
    typeof obj.updatedAt === 'string' && obj.updatedAt.trim().length > 0
      ? obj.updatedAt
      : new Date().toISOString()
  return {
    enabledMcpServers: normalizeStringArray(obj.enabledMcpServers),
    enabledMcpTools: normalizeStringArray(obj.enabledMcpTools),
    presets: normalizePresets(obj.presets),
    updatedAt,
  }
}

export async function loadToolPreferences(): Promise<ToolPreferencesRecord> {
  await ensureTable()
  const pool = getJobsPgPool()
  const result = await pool.query<{
    payload: unknown
    updated_at: string
  }>('SELECT payload, updated_at FROM axon_web_tool_preferences WHERE key = $1', [SETTINGS_KEY])
  if (result.rowCount === 0) return DEFAULT_TOOL_PREFERENCES
  const row = result.rows[0]
  const normalized = normalizePayload(row.payload)
  return {
    ...normalized,
    updatedAt: row.updated_at ?? normalized.updatedAt,
  }
}

export async function saveToolPreferences(
  payload: ToolPreferencesRecord,
): Promise<ToolPreferencesRecord> {
  await ensureTable()
  const pool = getJobsPgPool()
  const now = new Date().toISOString()
  const normalized: ToolPreferencesRecord = {
    enabledMcpServers: normalizeStringArray(payload.enabledMcpServers),
    enabledMcpTools: normalizeStringArray(payload.enabledMcpTools),
    presets: normalizePresets(payload.presets),
    updatedAt: now,
  }
  await pool.query(
    `
      INSERT INTO axon_web_tool_preferences (key, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `,
    [SETTINGS_KEY, JSON.stringify(normalized)],
  )
  return normalized
}
