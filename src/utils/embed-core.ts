import { randomUUID } from 'node:crypto';
import { fmt } from './theme';
import { extractDomain } from './url';

interface Chunk {
  index: number;
  text: string;
  header: string | null;
}

interface BaseEmbedMetadata {
  url: string;
  title?: string;
  sourceCommand?: string;
  contentType?: string;
}

interface BuildPointOptions {
  sourceCommandFallback: string;
  includeExtraMetadata: boolean;
}

/**
 * Build Qdrant points from chunked content and embeddings.
 */
export function buildEmbeddingPoints<T extends BaseEmbedMetadata>(
  chunks: Chunk[],
  vectors: number[][],
  metadata: T,
  options: BuildPointOptions
): Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> {
  const now = new Date().toISOString();
  const domain = extractDomain(metadata.url);
  const totalChunks = chunks.length;

  const additionalPayload = options.includeExtraMetadata
    ? Object.fromEntries(
        Object.entries(metadata).filter(
          ([key]) =>
            !['url', 'title', 'sourceCommand', 'contentType'].includes(key)
        )
      )
    : {};

  return chunks.map((chunk, i) => ({
    id: randomUUID(),
    vector: vectors[i],
    payload: {
      url: metadata.url,
      title: metadata.title || '',
      domain,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      chunk_header: chunk.header,
      total_chunks: totalChunks,
      source_command: metadata.sourceCommand || options.sourceCommandFallback,
      content_type: metadata.contentType || 'text',
      scraped_at: now,
      ...(additionalPayload as Record<string, unknown>),
    },
  }));
}

/**
 * Run embed work and log failures consistently without throwing.
 */
export async function runEmbedSafely(
  url: string,
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(
      fmt.error(
        `Embed failed for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
}
