import type { AcpConfigOption } from '@/lib/pulse/types'

function toLower(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function looksLikeModelConfig(option: AcpConfigOption): boolean {
  const category = toLower(option.category)
  if (category === 'model') {
    return true
  }
  const id = toLower(option.id)
  if (id.includes('model')) {
    return true
  }
  const name = toLower(option.name)
  return name.includes('model')
}

const KNOWN_AGENTS = new Set(['claude', 'codex', 'gemini'])

function looksLikeAgentPicker(option: AcpConfigOption): boolean {
  const id = toLower(option.id)
  const name = toLower(option.name)
  if (id.includes('agent') || name.includes('agent')) return true
  if (option.options.length === 0) return false
  const values = option.options.map((opt) => toLower(opt.value))
  return values.every((value) => KNOWN_AGENTS.has(value))
}

function looksLikeModeConfig(option: AcpConfigOption): boolean {
  const category = toLower(option.category)
  if (category === 'mode') {
    return true
  }
  const id = toLower(option.id)
  if (id.includes('mode') || id.includes('permission')) {
    return true
  }
  const name = toLower(option.name)
  return name.includes('mode') || name.includes('permission')
}

export function getAcpModelConfigOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  if (options.length === 0) return undefined
  const categoryMatches = options.filter((o) => toLower(o.category) === 'model')
  const nonAgentCategory = categoryMatches.find((option) => !looksLikeAgentPicker(option))
  if (nonAgentCategory) return nonAgentCategory
  const fallbackMatches = options.filter(looksLikeModelConfig)
  return fallbackMatches.find((option) => !looksLikeAgentPicker(option))
}

export function getAcpModeConfigOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  if (options.length === 0) return undefined
  return options.find((o) => toLower(o.category) === 'mode') ?? options.find(looksLikeModeConfig)
}
