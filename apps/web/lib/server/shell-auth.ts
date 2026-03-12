/**
 * TypeScript re-export of shell-auth.mjs with full type annotations.
 *
 * The runtime logic lives in shell-auth.mjs (plain JS — imported by
 * shell-server.mjs which cannot import TypeScript at runtime).
 * This file adds type annotations for all TypeScript consumers and tests.
 */
import type { IncomingMessage } from 'node:http'
import {
  buildShellEnv as _buildShellEnv,
  getAuthToken as _getAuthToken,
  isAllowedOrigin as _isAllowedOrigin,
  isAuthorized as _isAuthorized,
  isLoopbackHost as _isLoopbackHost,
  parseOrigin as _parseOrigin,
  SAFE_ENV_KEYS as _SAFE_ENV_KEYS,
  tokenMatches as _tokenMatches,
} from './shell-auth.mjs'

export const SAFE_ENV_KEYS: readonly string[] = _SAFE_ENV_KEYS as readonly string[]

export function isLoopbackHost(host: string): boolean {
  return _isLoopbackHost(host) as boolean
}

export function parseOrigin(originHeader: string | undefined): URL | null {
  return _parseOrigin(originHeader) as URL | null
}

export function isAllowedOrigin(
  req: Pick<IncomingMessage, 'headers'>,
  allowedOrigins: string[],
  allowInsecureLocalDev: boolean,
): boolean {
  return _isAllowedOrigin(req, allowedOrigins, allowInsecureLocalDev) as boolean
}

export function getAuthToken(req: Pick<IncomingMessage, 'headers' | 'url'>): string {
  return _getAuthToken(req) as string
}

export function tokenMatches(provided: string, expected: string): boolean {
  return _tokenMatches(provided, expected) as boolean
}

export function isAuthorized(
  req: Pick<IncomingMessage, 'headers' | 'url'>,
  token: string,
  allowInsecureLocalDev: boolean,
): boolean {
  return _isAuthorized(req, token, allowInsecureLocalDev) as boolean
}

export function buildShellEnv(
  sourceEnv: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  return _buildShellEnv(sourceEnv) as unknown as NodeJS.ProcessEnv
}
