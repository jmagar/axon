import { faker } from '@faker-js/faker'
import type { PlateEditor } from 'platejs/react'
import { createCommentChunks, createTableCellChunks } from './use-chat-fake-stream-builders'
import { markdownChunks, mdxChunks } from './use-chat-fake-stream-samples'

// Used for testing. Remove it after implementing useChat api.
export const fakeStreamText = ({
  chunkCount = 10,
  editor,
  sample = null,
  signal,
}: {
  editor: PlateEditor
  chunkCount?: number
  sample?: 'comment' | 'markdown' | 'mdx' | 'table' | null
  signal?: AbortSignal
}) => {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const blocks = (() => {
        if (sample === 'markdown') {
          return markdownChunks
        }

        if (sample === 'mdx') {
          return mdxChunks
        }

        if (sample === 'comment') {
          const commentChunks = createCommentChunks(editor)
          return commentChunks
        }

        if (sample === 'table') {
          const tableChunks = createTableCellChunks(editor)
          return tableChunks
        }

        return [
          Array.from({ length: chunkCount }, () => ({
            delay: faker.number.int({ max: 100, min: 30 }),
            texts: `${faker.lorem.words({ max: 3, min: 1 })} `,
          })),

          Array.from({ length: chunkCount + 2 }, () => ({
            delay: faker.number.int({ max: 100, min: 30 }),
            texts: `${faker.lorem.words({ max: 3, min: 1 })} `,
          })),

          Array.from({ length: chunkCount + 4 }, () => ({
            delay: faker.number.int({ max: 100, min: 30 }),
            texts: `${faker.lorem.words({ max: 3, min: 1 })} `,
          })),
        ]
      })()
      if (signal?.aborted) {
        controller.error(new Error('Aborted before start'))
        return
      }

      const abortHandler = () => {
        controller.error(new Error('Stream aborted'))
      }

      signal?.addEventListener('abort', abortHandler)

      // Generate a unique message ID
      const messageId = `msg_${faker.string.alphanumeric(40)}`

      // Handle comment and table data differently (they use data events, not text streams)
      if (sample === 'comment' || sample === 'table') {
        controller.enqueue(encoder.encode('data: {"type":"start"}\n\n'))
        await new Promise((resolve) => setTimeout(resolve, 10))

        controller.enqueue(encoder.encode('data: {"type":"start-step"}\n\n'))
        await new Promise((resolve) => setTimeout(resolve, 10))

        // For comments and tables, send data events directly
        for (const block of blocks) {
          for (const chunk of block) {
            await new Promise((resolve) => setTimeout(resolve, chunk.delay))

            if (signal?.aborted) {
              signal?.removeEventListener('abort', abortHandler)
              return
            }

            // Send the data event directly (already formatted as JSON)
            controller.enqueue(encoder.encode(`data: ${chunk.texts}\n\n`))
          }
        }

        // Send the final DONE event
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } else {
        // Send initial stream events for text content
        controller.enqueue(encoder.encode('data: {"type":"start"}\n\n'))
        await new Promise((resolve) => setTimeout(resolve, 10))

        controller.enqueue(encoder.encode('data: {"type":"start-step"}\n\n'))
        await new Promise((resolve) => setTimeout(resolve, 10))

        controller.enqueue(
          encoder.encode(
            `data: {"type":"text-start","id":"${messageId}","providerMetadata":{"openai":{"itemId":"${messageId}"}}}\n\n`,
          ),
        )
        await new Promise((resolve) => setTimeout(resolve, 10))

        for (let i = 0; i < blocks.length; i++) {
          // i is always a valid index — loop bounds ensure it
          const block = blocks[i]!

          // Stream the block content
          for (const chunk of block) {
            await new Promise((resolve) => setTimeout(resolve, chunk.delay))

            if (signal?.aborted) {
              signal?.removeEventListener('abort', abortHandler)
              return
            }

            // Properly escape the text for JSON
            const escapedText = chunk.texts
              .replace(/\\/g, '\\\\') // Escape backslashes first
              .replace(/"/g, String.raw`\"`) // Escape quotes
              .replace(/\n/g, String.raw`\n`) // Escape newlines
              .replace(/\r/g, String.raw`\r`) // Escape carriage returns
              .replace(/\t/g, String.raw`\t`) // Escape tabs

            controller.enqueue(
              encoder.encode(
                `data: {"type":"text-delta","id":"${messageId}","delta":"${escapedText}"}\n\n`,
              ),
            )
          }

          // Add double newline after each block except the last one
          if (i < blocks.length - 1) {
            controller.enqueue(
              encoder.encode(
                `data: {"type":"text-delta","id":"${messageId}","delta":"\\n\\n"}\n\n`,
              ),
            )
          }
        }

        // Send end events
        controller.enqueue(encoder.encode(`data: {"type":"text-end","id":"${messageId}"}\n\n`))
        await new Promise((resolve) => setTimeout(resolve, 10))

        controller.enqueue(encoder.encode('data: {"type":"finish-step"}\n\n'))
        await new Promise((resolve) => setTimeout(resolve, 10))

        controller.enqueue(encoder.encode('data: {"type":"finish"}\n\n'))
        await new Promise((resolve) => setTimeout(resolve, 10))

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      }

      signal?.removeEventListener('abort', abortHandler)
      controller.close()
    },
  })
}
