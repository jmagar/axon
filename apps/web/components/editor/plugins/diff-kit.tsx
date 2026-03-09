'use client'

import { createPlatePlugin } from 'platejs/react'

import { DiffLeaf } from '@/components/ui/diff-node'

// Thin plugin to render diff marks produced by computeDiff().
// Handles nodes with { diff: true, diffOperation: { type: 'insert' | 'delete' | 'update' } }.
// Usage: call computeDiff(fromDoc, toDoc) from @platejs/diff, then render the result
// in a read-only Plate editor that includes DiffKit in its plugins.
export { computeDiff } from '@platejs/diff'

const DiffTextPlugin = createPlatePlugin({
  key: 'diff',
  node: { isLeaf: true },
}).withComponent(DiffLeaf)

export const DiffKit = [DiffTextPlugin]
