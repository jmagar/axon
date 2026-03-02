import { mdxAdvancedChunks } from './use-chat-fake-stream-samples-mdx-advanced'
import { mdxBasicChunks } from './use-chat-fake-stream-samples-mdx-basic'
import { mdxMediaChunks } from './use-chat-fake-stream-samples-mdx-media'

const mdxChunks = [[...mdxBasicChunks, ...mdxAdvancedChunks, ...mdxMediaChunks]]

export { mdxChunks }
