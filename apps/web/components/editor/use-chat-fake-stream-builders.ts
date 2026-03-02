import { faker } from '@faker-js/faker'
import { BlockSelectionPlugin } from '@platejs/selection/react'
import { KEYS, NodeApi, nanoid } from 'platejs'
import type { PlateEditor } from 'platejs/react'

const createCommentChunks = (editor: PlateEditor) => {
  const selectedBlocksApi = editor.getApi(BlockSelectionPlugin).blockSelection

  const selectedBlocks = selectedBlocksApi
    .getNodes({
      selectionFallback: true,
      sort: true,
    })
    .map(([block]) => block)

  const isSelectingSome = editor.getOption(BlockSelectionPlugin, 'isSelectingSome')

  const blocks =
    selectedBlocks.length > 0 && (editor.api.isExpanded() || isSelectingSome)
      ? selectedBlocks
      : editor.children

  const max = blocks.length

  const commentCount = Math.ceil(max / 2)

  const result = new Set<number>()

  while (result.size < commentCount) {
    const num = Math.floor(Math.random() * max) // 0 to max-1 (fixed: was 1 to max)
    result.add(num)
  }

  const indexes = Array.from(result).sort((a, b) => a - b)

  const chunks = indexes
    .map((index, i) => {
      const block = blocks[index]
      if (!block) {
        return []
      }

      const blockString = NodeApi.string(block)
      const endIndex = blockString.indexOf('.')
      const content = endIndex === -1 ? blockString : blockString.slice(0, endIndex)

      return [
        {
          delay: faker.number.int({ max: 500, min: 200 }),
          texts: JSON.stringify({
            id: nanoid(),
            data: {
              comment: {
                blockId: block.id,
                comment: faker.lorem.sentence(),
                content,
              },
              status: i === indexes.length - 1 ? 'finished' : 'streaming',
            },
            type: 'data-comment',
          }),
        },
      ]
    })
    .filter((chunk) => chunk.length > 0)

  const result_chunks = [
    [{ delay: 50, texts: '{"data":"comment","type":"data-toolName"}' }],
    ...chunks,
  ]

  return result_chunks
}

const createTableCellChunks = (editor: PlateEditor) => {
  // Get selected table cells from the TablePlugin
  const selectedCells = editor.getOption({ key: KEYS.table }, 'selectedCells') || []

  // If no cells selected, try to get cells from current selection
  let cellIds: string[] = []

  if (selectedCells.length > 0) {
    cellIds = selectedCells.map((cell: { id?: string }) => cell.id).filter(Boolean)
  } else {
    // Try to find table cells in current selection
    const cells = Array.from(
      editor.api.nodes({
        at: editor.selection ?? undefined,
        match: (n) =>
          (n as { type?: string }).type === KEYS.td || (n as { type?: string }).type === KEYS.th,
      }),
    )
    cellIds = cells.map(([node]) => (node as { id?: string }).id).filter(Boolean) as string[]
  }

  // If still no cells, return empty chunks
  if (cellIds.length === 0) {
    return [
      [{ delay: 50, texts: '{"data":"edit","type":"data-toolName"}' }],
      [
        {
          delay: 100,
          texts: `{"id":"${nanoid()}","data":{"cellUpdate":null,"status":"finished"},"type":"data-table"}`,
        },
      ],
    ]
  }

  // Generate mock content for each cell
  const chunks = cellIds.map((cellId, i) => [
    {
      delay: faker.number.int({ max: 300, min: 100 }),
      texts: `{"id":"${nanoid()}","data":{"cellUpdate":{"id":"${cellId}","content":"${faker.lorem.sentence()}"},"status":"${i === cellIds.length - 1 ? 'finished' : 'streaming'}"},"type":"data-table"}`,
    },
  ])

  const result_chunks = [
    [{ delay: 50, texts: '{"data":"edit","type":"data-toolName"}' }],
    ...chunks,
  ]

  return result_chunks
}

export { createCommentChunks, createTableCellChunks }
