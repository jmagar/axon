/**
 * Embed pipeline orchestrator
 * Coordinates chunking, embedding, and vector storage
 *
 * Provides both single-document embedding (autoEmbed) and
 * batch embedding with concurrency control (batchEmbed).
 *
 * @deprecated Use container.getEmbedPipeline() instead
 * This module is kept for backward compatibility with background-embedder daemon
 */

import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import type { ImmutableConfig } from '../container/types';
import { chunkText } from './chunker';
import { getConfig } from './config';
import { embedChunks, getTeiInfo } from './embeddings';
import { deleteByUrl, ensureCollection, upsertPoints } from './qdrant';

/**
 * Maximum concurrent embedding operations to prevent resource exhaustion
 */
const MAX_CONCURRENT_EMBEDS = 10;

/**
 * Metadata for embedding a single document
 */
export interface EmbedMetadata {
  url: string;
  title?: string;
  sourceCommand: string;
  contentType?: string;
}

/**
 * Item to be embedded in batch operations
 */
export interface EmbedItem {
  content: string;
  metadata: EmbedMetadata;
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Auto-embed content into Qdrant via TEI
 * No-op if TEI_URL or QDRANT_URL not configured
 * Never throws -- errors are logged but don't break the calling command
 */
export async function autoEmbed(
  content: string,
  metadata: EmbedMetadata,
  config?: ImmutableConfig
): Promise<void> {
  try {
    const cfg = config || getConfig();
    const { teiUrl, qdrantUrl, qdrantCollection } = cfg;

    // No-op if not configured
    if (!teiUrl || !qdrantUrl) return;

    const collection = qdrantCollection || 'firecrawl_collection';

    // No-op for empty content
    const trimmed = content.trim();
    if (!trimmed) return;

    // Get TEI info (dimension) -- cached after first call
    const teiInfo = await getTeiInfo(teiUrl);

    // Ensure collection exists
    await ensureCollection(qdrantUrl, collection, teiInfo.dimension);

    // Chunk content
    const chunks = chunkText(trimmed);
    if (chunks.length === 0) return;

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const vectors = await embedChunks(teiUrl, texts);

    // Delete existing vectors for this URL (overwrite dedup)
    await deleteByUrl(qdrantUrl, collection, metadata.url);

    // Build points with metadata
    const now = new Date().toISOString();
    const domain = extractDomain(metadata.url);
    const totalChunks = chunks.length;

    const points = chunks.map((chunk, i) => ({
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
        source_command: metadata.sourceCommand,
        content_type: metadata.contentType || 'text',
        scraped_at: now,
      },
    }));

    // Upsert to Qdrant
    await upsertPoints(qdrantUrl, collection, points);

    console.error(`Embedded ${chunks.length} chunks for ${metadata.url}`);
  } catch (error) {
    console.error(
      `Embed failed for ${metadata.url}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Batch embed multiple items with concurrency control.
 *
 * This consolidates the repeated pattern across crawl, search, and extract:
 * ```
 * const limit = pLimit(MAX_CONCURRENT_EMBEDS);
 * const embedPromises: Promise<void>[] = [];
 * for (const item of items) {
 *   embedPromises.push(limit(async () => { await autoEmbed(...); }));
 * }
 * await Promise.all(embedPromises);
 * ```
 *
 * @param items - Array of items to embed
 * @param options - Optional configuration
 * @returns Promise that resolves when all items are embedded
 */
export async function batchEmbed(
  items: EmbedItem[],
  options: { concurrency?: number } = {}
): Promise<void> {
  if (items.length === 0) return;

  const concurrency = options.concurrency ?? MAX_CONCURRENT_EMBEDS;
  const limit = pLimit(concurrency);

  const promises = items.map((item) =>
    limit(async () => {
      try {
        await autoEmbed(item.content, item.metadata);
      } catch {
        // Silently ignore individual embedding errors - don't fail the batch
      }
    })
  );

  await Promise.all(promises);
}

/**
 * Create embed items from an array of pages/documents.
 *
 * This is a helper for the common pattern of converting crawl/search results
 * to embed items.
 *
 * @param pages - Array of pages with content and metadata
 * @param sourceCommand - The command that generated these pages
 * @returns Array of EmbedItem objects
 */
export function createEmbedItems<
  T extends {
    markdown?: string;
    html?: string;
    url?: string;
    title?: string;
    metadata?: { sourceURL?: string; url?: string; title?: string };
  },
>(pages: T[], sourceCommand: string): EmbedItem[] {
  return pages
    .filter((page) => page.markdown || page.html)
    .map((page) => ({
      content: page.markdown || page.html || '',
      metadata: {
        url: page.url || page.metadata?.sourceURL || page.metadata?.url || '',
        title: page.title || page.metadata?.title,
        sourceCommand,
        contentType: page.markdown ? 'markdown' : 'html',
      },
    }));
}
