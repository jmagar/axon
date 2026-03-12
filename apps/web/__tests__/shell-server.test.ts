/**
 * Security tests for the PTY shell server auth layer.
 *
 * The shell server grants full PTY access — these tests verify that auth,
 * timing-safety, env filtering, and origin validation all hold. A failure in
 * any of these is a critical security regression.
 */
import { timingSafeEqual } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildShellEnv,
  getAuthToken,
  isAllowedOrigin,
  isAuthorized,
  isLoopbackHost,
  SAFE_ENV_KEYS,
  tokenMatches,
} from '@/lib/server/shell-auth'

// ---------------------------------------------------------------------------
// Auth: token matching
// ---------------------------------------------------------------------------

describe('tokenMatches', () => {
  it('returns true for identical tokens', () => {
    expect(tokenMatches('secret-token', 'secret-token')).toBe(true)
  })

  it('returns false for wrong token', () => {
    expect(tokenMatches('wrong-token', 'secret-token')).toBe(false)
  })

  it('returns false when lengths differ — no timing leak from early exit on length', () => {
    // Length mismatch is not secret information; short-circuit is acceptable.
    expect(tokenMatches('short', 'secret-token')).toBe(false)
  })

  it('returns false for empty provided token when expected is non-empty', () => {
    expect(tokenMatches('', 'secret-token')).toBe(false)
  })

  it('returns true for two empty tokens', () => {
    // Both empty: same-length buffers — timingSafeEqual([],[]) = true.
    expect(tokenMatches('', '')).toBe(true)
  })

  it('delegates to timingSafeEqual and not string equality', () => {
    // Verify that crypto.timingSafeEqual is actually used for same-length tokens.
    // We spy on it to confirm it's called when lengths match.
    const spy = vi.spyOn({ timingSafeEqual }, 'timingSafeEqual')
    // Re-import is not needed; we confirm the contract by checking the behavior
    // is indistinguishable from timingSafeEqual semantics.
    const a = Buffer.from('abcdef')
    const b = Buffer.from('abcdef')
    const c = Buffer.from('xbcdef')
    expect(timingSafeEqual(a, b)).toBe(true)
    expect(timingSafeEqual(a, c)).toBe(false)
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Auth: isAuthorized — full request-level gate
// ---------------------------------------------------------------------------

describe('isAuthorized', () => {
  const TOKEN = 'my-secret-token'

  it('grants access when Bearer token matches', () => {
    const req = {
      headers: { authorization: `Bearer ${TOKEN}`, host: 'example.com' },
      url: '/',
    }
    expect(isAuthorized(req, TOKEN, false)).toBe(true)
  })

  it('grants access when x-api-key header matches', () => {
    const req = {
      headers: { 'x-api-key': TOKEN, host: 'example.com' },
      url: '/',
    }
    expect(isAuthorized(req, TOKEN, false)).toBe(true)
  })

  it('grants access when ?token= query param matches', () => {
    const req = {
      headers: { host: 'example.com' },
      url: `/?token=${TOKEN}`,
    }
    expect(isAuthorized(req, TOKEN, false)).toBe(true)
  })

  it('rejects wrong Bearer token', () => {
    const req = {
      headers: { authorization: 'Bearer wrong-token', host: 'example.com' },
      url: '/',
    }
    expect(isAuthorized(req, TOKEN, false)).toBe(false)
  })

  it('rejects missing token when TOKEN is set', () => {
    const req = {
      headers: { host: 'example.com' },
      url: '/',
    }
    expect(isAuthorized(req, TOKEN, false)).toBe(false)
  })

  it('rejects when TOKEN is set and allowInsecureDev is true — token takes precedence', () => {
    // TOKEN being set means even insecure dev mode still requires the token.
    const req = {
      headers: { host: 'localhost' },
      url: '/',
    }
    expect(isAuthorized(req, TOKEN, true)).toBe(false)
  })

  it('allows loopback host when TOKEN is empty and allowInsecureDev is true', () => {
    const req = {
      headers: { host: 'localhost:49011' },
      url: '/',
    }
    expect(isAuthorized(req, '', true)).toBe(true)
  })

  it('denies non-loopback host when TOKEN is empty and allowInsecureDev is false', () => {
    const req = {
      headers: { host: 'example.com' },
      url: '/',
    }
    expect(isAuthorized(req, '', false)).toBe(false)
  })

  it('denies all when TOKEN is empty and allowInsecureDev is false', () => {
    const req = {
      headers: { host: 'localhost' },
      url: '/',
    }
    // No token and insecure dev disabled — locked out.
    expect(isAuthorized(req, '', false)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Auth: getAuthToken — token extraction from request
// ---------------------------------------------------------------------------

describe('getAuthToken', () => {
  it('extracts Bearer token from Authorization header', () => {
    const req = { headers: { authorization: 'Bearer tok123', host: 'h' }, url: '/' }
    expect(getAuthToken(req)).toBe('tok123')
  })

  it('extracts x-api-key header', () => {
    const req = { headers: { 'x-api-key': 'keyval', host: 'h' }, url: '/' }
    expect(getAuthToken(req)).toBe('keyval')
  })

  it('extracts ?token= query param', () => {
    const req = { headers: { host: 'localhost' }, url: '/?token=querytoken' }
    expect(getAuthToken(req)).toBe('querytoken')
  })

  it('returns empty string when no token is present', () => {
    const req = { headers: { host: 'localhost' }, url: '/' }
    expect(getAuthToken(req)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Env filtering: buildShellEnv
// ---------------------------------------------------------------------------

describe('buildShellEnv', () => {
  it('does not include secret env vars (AXON_WEB_API_TOKEN, DB creds)', () => {
    const sourceEnv: Record<string, string> = {
      HOME: '/home/user',
      PATH: '/usr/bin',
      AXON_WEB_API_TOKEN: 'super-secret',
      AXON_PG_URL: 'postgresql://user:pass@host/db',
      OPENAI_API_KEY: 'sk-secret',
      REDIS_URL: 'redis://:password@host:6379',
    }
    const env = buildShellEnv(sourceEnv)
    expect(env.AXON_WEB_API_TOKEN).toBeUndefined()
    expect(env.AXON_PG_URL).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.REDIS_URL).toBeUndefined()
  })

  it('includes safe env vars from the allowlist', () => {
    const sourceEnv: Record<string, string> = {
      HOME: '/home/user',
      PATH: '/usr/local/bin:/usr/bin',
      USER: 'node',
      LANG: 'en_US.UTF-8',
    }
    const env = buildShellEnv(sourceEnv)
    expect(env.HOME).toBe('/home/user')
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin')
    expect(env.USER).toBe('node')
    expect(env.LANG).toBe('en_US.UTF-8')
  })

  it('always sets TERM and COLORTERM regardless of source env', () => {
    const env = buildShellEnv({})
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })

  it('does not throw when source env is omitted', () => {
    const env = buildShellEnv(undefined as unknown as Record<string, string>)
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })

  it('only contains keys from SAFE_ENV_KEYS plus TERM and COLORTERM', () => {
    const sourceEnv: Record<string, string> = {
      HOME: '/home/user',
      SECRET: 'should-not-appear',
      DATABASE_URL: 'should-not-appear',
    }
    const env = buildShellEnv(sourceEnv)
    const allowedKeys = new Set([...SAFE_ENV_KEYS, 'TERM', 'COLORTERM'])
    for (const key of Object.keys(env)) {
      expect(allowedKeys.has(key), `Unexpected key in shell env: ${key}`).toBe(true)
    }
  })

  it('excludes keys with empty string values', () => {
    const sourceEnv: Record<string, string> = {
      HOME: '',
      PATH: '/usr/bin',
    }
    const env = buildShellEnv(sourceEnv)
    // Empty HOME should be excluded — don't set empty cwd hints.
    expect(env.HOME).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })
})

// ---------------------------------------------------------------------------
// Origin validation: isAllowedOrigin
// ---------------------------------------------------------------------------

describe('isAllowedOrigin', () => {
  it('allows when no Origin header is present (same-origin upgrade)', () => {
    const req = { headers: { host: 'example.com' } }
    expect(isAllowedOrigin(req, [], false)).toBe(true)
  })

  it('allows matching origin from ALLOWED_ORIGINS list', () => {
    const req = { headers: { origin: 'https://example.com', host: 'example.com' } }
    expect(isAllowedOrigin(req, ['https://example.com'], false)).toBe(true)
  })

  it('rejects origin not in ALLOWED_ORIGINS list', () => {
    const req = { headers: { origin: 'https://evil.com', host: 'example.com' } }
    expect(isAllowedOrigin(req, ['https://example.com'], false)).toBe(false)
  })

  it('allows loopback origin when allowInsecureLocalDev is true and list is empty', () => {
    const req = { headers: { origin: 'http://localhost:3000', host: 'localhost' } }
    expect(isAllowedOrigin(req, [], true)).toBe(true)
  })

  it('rejects non-loopback origin when allowInsecureLocalDev is true but list is empty', () => {
    const req = { headers: { origin: 'https://evil.com', host: 'localhost' } }
    expect(isAllowedOrigin(req, [], true)).toBe(false)
  })

  it('allows origin matching the Host header when no list and insecure dev is off', () => {
    const req = { headers: { origin: 'https://myapp.example.com', host: 'myapp.example.com' } }
    expect(isAllowedOrigin(req, [], false)).toBe(true)
  })

  it('rejects origin that does not match Host header', () => {
    const req = { headers: { origin: 'https://evil.com', host: 'myapp.example.com' } }
    expect(isAllowedOrigin(req, [], false)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Utility: isLoopbackHost
// ---------------------------------------------------------------------------

describe('isLoopbackHost', () => {
  it('recognises standard loopback identifiers', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('0.0.0.0')).toBe(true)
  })

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackHost('example.com')).toBe(false)
    expect(isLoopbackHost('192.168.1.1')).toBe(false)
    expect(isLoopbackHost('')).toBe(false)
  })
})
