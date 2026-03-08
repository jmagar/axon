import { describe, expect, it } from 'vitest'
import { decodeProjectPath, parseRemoteUrl } from '../../lib/sessions/git-metadata'

describe('decodeProjectPath', () => {
  it('decodes hyphen-encoded path to filesystem path', () => {
    // Simple replacement: each '-' becomes '/', including leading '-'
    // Note: hyphens in dir names are indistinguishable from path separators.
    // "-home-jmagar-workspace-axon-rust" → "/home/jmagar/workspace/axon/rust"
    expect(decodeProjectPath('-home-jmagar-workspace-axon-rust')).toBe(
      '/home/jmagar/workspace/axon/rust',
    )
  })

  it('handles paths with underscores', () => {
    expect(decodeProjectPath('-home-jmagar-workspace-axon_rust')).toBe(
      '/home/jmagar/workspace/axon_rust',
    )
  })
})

describe('parseRemoteUrl', () => {
  it('parses HTTPS remote URL', () => {
    expect(parseRemoteUrl('https://github.com/jmagar/axon_rust.git')).toBe('jmagar/axon_rust')
  })

  it('parses SSH remote URL', () => {
    expect(parseRemoteUrl('git@github.com:jmagar/axon_rust.git')).toBe('jmagar/axon_rust')
  })

  it('returns null for invalid URL', () => {
    expect(parseRemoteUrl('not-a-url')).toBeNull()
  })
})
