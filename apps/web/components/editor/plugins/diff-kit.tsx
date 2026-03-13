'use client'

import { createPlatePlugin } from 'platejs/react'

import { DiffLeaf } from '@/components/ui/diff-node'

// Thin plugin to render diff marks produced by computeDiff().
// Handles nodes with { diff: true, diffOperation: { type: 'insert' | 'delete' | 'update' } }.
// Usage: call computeDiff(fromDoc, toDoc) from @platejs/diff (or from diff-kit-utils.ts for
// server components), then render the result in a read-only Plate editor that includes DiffKit.
//
// computeDiff is a pure function with no browser dependencies.  It is also exported from
// diff-kit-utils.ts so server components can import it without crossing this client boundary.
export { computeDiff } from './diff-kit-utils'

const DiffTextPlugin = createPlatePlugin({
  key: 'diff',
  node: { isLeaf: true },
}).withComponent(DiffLeaf)

export const DiffKit = [DiffTextPlugin]
