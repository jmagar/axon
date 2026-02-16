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
  sourcePathRel?: string;
  source_path_rel?: string;
  fileModifiedAt?: string;
  file_modified_at?: string;
  scrapedAt?: string;
  scraped_at?: string;
}

interface BuildPointOptions {
  sourceCommandFallback: string;
  includeExtraMetadata: boolean;
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
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
  const sourcePathRel =
    metadata.sourcePathRel || metadata.source_path_rel || '';
  const fallbackTitle =
    sourcePathRel ||
    metadata.url.replace(/^https?:\/\//, '').replace(/^\/+/, '') ||
    'Untitled';
  const normalizedScrapedAt =
    normalizeTimestamp(metadata.scrapedAt || metadata.scraped_at) || now;
  const normalizedFileModifiedAt = normalizeTimestamp(
    metadata.fileModifiedAt || metadata.file_modified_at
  );

  const additionalPayload = options.includeExtraMetadata
    ? Object.fromEntries(
        Object.entries(metadata).filter(
          ([key]) =>
            ![
              'url',
              'title',
              'sourceCommand',
              'contentType',
              'scrapedAt',
              'scraped_at',
              'fileModifiedAt',
              'file_modified_at',
            ].includes(key)
        )
      )
    : {};

  return chunks.map((chunk, i) => ({
    id: randomUUID(),
    vector: vectors[i],
    payload: {
      url: metadata.url,
      title: metadata.title || fallbackTitle,
      domain,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      chunk_header: chunk.header,
      total_chunks: totalChunks,
      source_command: metadata.sourceCommand || options.sourceCommandFallback,
      content_type: metadata.contentType || 'text',
      scraped_at: normalizedScrapedAt,
      ...(normalizedFileModifiedAt
        ? { file_modified_at: normalizedFileModifiedAt }
        : {}),
      ...(additionalPayload as Record<string, unknown>),
    },
  }));
}

/**
 * Run embed work and log failures consistently without throwing.
 *
 * Design rationale: Embedding is an async background operation that should not block or
 * cascade failures to the main scrape/crawl operation. If embedding fails for a specific URL,
 * we want to:
 * 1. Log the error so admins can diagnose issues
 * 2. Continue processing other URLs rather than abandoning the entire batch
 * 3. Return normally so the scrape result is still valid
 *
 * This prevents transient TEI/Qdrant issues from breaking the CLI for users.
 *
 * @param url - The source URL being embedded (for context in error logs)
 * @param operation - The embedding operation to run (chunking, TEI call, Qdrant upsert, etc.)
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
    // Note: We intentionally do NOT rethrow. Embedding failure is non-fatal.
  }
}
