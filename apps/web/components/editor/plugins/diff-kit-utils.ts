// Pure utility re-export — no browser dependencies, safe for server components.
// `computeDiff` is imported here so server components and non-client modules can
// access it without crossing the 'use client' boundary in diff-kit.tsx.
export { computeDiff } from '@platejs/diff'
