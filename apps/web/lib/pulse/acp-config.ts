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
  return options.find((o) => toLower(o.category) === 'model') ?? options.find(looksLikeModelConfig)
}

export function getAcpModeConfigOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  if (options.length === 0) return undefined
  return options.find((o) => toLower(o.category) === 'mode') ?? options.find(looksLikeModeConfig)
}
