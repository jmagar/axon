import { describe, expect, it } from 'vitest'
import { getAcpModeConfigOption, getAcpModelConfigOption } from '@/lib/pulse/acp-config'
import type { AcpConfigOption } from '@/lib/pulse/types'

function makeOption(partial: Partial<AcpConfigOption>): AcpConfigOption {
  return {
    id: 'opt',
    name: 'Option',
    currentValue: 'default',
    options: [],
    ...partial,
  }
}

describe('getAcpModelConfigOption', () => {
  it('prefers explicit model category', () => {
    const options: AcpConfigOption[] = [
      makeOption({ id: 'mode', name: 'Mode', category: 'mode' }),
      makeOption({ id: 'foo', name: 'Anything', category: 'model' }),
    ]
    const picked = getAcpModelConfigOption(options)
    expect(picked?.id).toBe('foo')
  })

  it('matches model option by id fallback when category is missing', () => {
    const options: AcpConfigOption[] = [
      makeOption({ id: 'default_model', name: 'Config', category: undefined }),
    ]
    const picked = getAcpModelConfigOption(options)
    expect(picked?.id).toBe('default_model')
  })

  it('matches model option by name fallback when category and id are generic', () => {
    const options: AcpConfigOption[] = [
      makeOption({ id: 'choice', name: 'Model Selector', category: undefined }),
    ]
    const picked = getAcpModelConfigOption(options)
    expect(picked?.id).toBe('choice')
  })

  it('ignores agent picker options when selecting model config', () => {
    const options: AcpConfigOption[] = [
      makeOption({
        id: 'agent',
        name: 'Agent',
        category: 'model',
        currentValue: 'claude',
        options: [
          { value: 'claude', name: 'Claude' },
          { value: 'codex', name: 'Codex' },
          { value: 'gemini', name: 'Gemini' },
        ],
      }),
      makeOption({
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'sonnet',
        options: [
          { value: 'sonnet', name: 'Sonnet' },
          { value: 'opus', name: 'Opus' },
        ],
      }),
    ]
    const picked = getAcpModelConfigOption(options)
    expect(picked?.id).toBe('model')
  })

  it('returns undefined when only agent-like model options are present', () => {
    const options: AcpConfigOption[] = [
      makeOption({
        id: 'agent',
        name: 'Agent',
        category: 'model',
        currentValue: 'claude',
        options: [
          { value: 'claude', name: 'Claude' },
          { value: 'codex', name: 'Codex' },
          { value: 'gemini', name: 'Gemini' },
        ],
      }),
    ]
    const picked = getAcpModelConfigOption(options)
    expect(picked).toBeUndefined()
  })
})

describe('getAcpModeConfigOption', () => {
  it('prefers explicit mode category', () => {
    const options: AcpConfigOption[] = [
      makeOption({ id: 'model', name: 'Model', category: 'model' }),
      makeOption({ id: 'mode', name: 'Mode', category: 'mode' }),
    ]
    const picked = getAcpModeConfigOption(options)
    expect(picked?.id).toBe('mode')
  })

  it('matches mode option by id fallback when category is missing', () => {
    const options: AcpConfigOption[] = [
      makeOption({ id: 'approval_mode', name: 'Config', category: undefined }),
    ]
    const picked = getAcpModeConfigOption(options)
    expect(picked?.id).toBe('approval_mode')
  })

  it('matches mode option by name fallback', () => {
    const options: AcpConfigOption[] = [
      makeOption({ id: 'choice', name: 'Permission mode', category: undefined }),
    ]
    const picked = getAcpModeConfigOption(options)
    expect(picked?.id).toBe('choice')
  })
})
