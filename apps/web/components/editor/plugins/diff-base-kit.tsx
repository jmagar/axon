import { createSlatePlugin } from 'platejs'

import { DiffLeafStatic } from '@/components/ui/diff-node-static'

// Static version of DiffKit for server-side rendering of diff documents.
const BaseDiffTextPlugin = createSlatePlugin({
  key: 'diff',
  node: { isLeaf: true },
}).withComponent(DiffLeafStatic)

export const BaseDiffKit = [BaseDiffTextPlugin]
