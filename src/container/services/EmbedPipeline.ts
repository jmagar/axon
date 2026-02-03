/**
 * Embedding Pipeline Service
 * Orchestrates chunking, embedding, and vector storage
 *
 * Coordinates the flow:
 * 1. Chunk content (via chunker utility)
 * 2. Generate embeddings (via TeiService)
 * 3. Store in vector database (via QdrantService)
 */

import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import { chunkText } from '../../utils/chunker';
import type { IEmbedPipeline, IQdrantService, ITeiService } from '../types';

/**
 * Maximum concurrent embedding operations to prevent resource exhaustion
 */
const MAX_CONCURRENT_EMBEDS = 10;

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
 * EmbedPipeline implementation
 * Composes TEI and Qdrant services for end-to-end embedding workflow
 */
export class EmbedPipeline implements IEmbedPipeline {
  constructor(
    private readonly teiService: ITeiService,
    private readonly qdrantService: IQdrantService,
    private readonly collectionName: string = 'firecrawl_collection'
  ) {}

  /**
   * Internal embedding implementation that can throw errors
   * Used by batchEmbed to track failures
   */
  private async autoEmbedInternal(
    content: string,
    metadata: {
      url: string;
      title?: string;
      sourceCommand?: string;
      contentType?: string;
      [key: string]: unknown;
    }
  ): Promise<void> {
    // No-op for empty content
    const trimmed = content.trim();
    if (!trimmed) return;

    // Get TEI info (dimension) - cached after first call
    const teiInfo = await this.teiService.getTeiInfo();

    // Ensure collection exists
    await this.qdrantService.ensureCollection(
      this.collectionName,
      teiInfo.dimension
    );

    // Chunk content
    const chunks = chunkText(trimmed);
    if (chunks.length === 0) return;

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const vectors = await this.teiService.embedChunks(texts);

    // Delete existing vectors for this URL (overwrite dedup)
    await this.qdrantService.deleteByUrl(this.collectionName, metadata.url);

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
        source_command: metadata.sourceCommand || 'unknown',
        content_type: metadata.contentType || 'text',
        scraped_at: now,
        // Include any additional metadata fields
        ...Object.fromEntries(
          Object.entries(metadata).filter(
            ([key]) =>
              !['url', 'title', 'sourceCommand', 'contentType'].includes(key)
          )
        ),
      },
    }));

    // Upsert to Qdrant
    await this.qdrantService.upsertPoints(this.collectionName, points);

    console.error(`Embedded ${chunks.length} chunks for ${metadata.url}`);
  }

  /**
   * Auto-embed content into Qdrant via TEI
   *
   * Features:
   * - Chunks content using markdown-aware chunker
   * - Generates embeddings via TEI
   * - Deletes existing vectors for URL (dedup)
   * - Stores in Qdrant with rich metadata
   * - Never throws - errors are logged but don't break caller
   *
   * @param content Text content to embed
   * @param metadata Metadata for the content
   */
  async autoEmbed(
    content: string,
    metadata: {
      url: string;
      title?: string;
      sourceCommand?: string;
      contentType?: string;
      [key: string]: unknown;
    }
  ): Promise<void> {
    try {
      await this.autoEmbedInternal(content, metadata);
    } catch (error) {
      console.error(
        `Embed failed for ${metadata.url}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Batch embed multiple items with concurrency control
   *
   * Features:
   * - Prevents resource exhaustion via p-limit
   * - Default concurrency: 10
   * - Tracks success/failure counts
   * - Collects error messages (limit 10)
   * - Never throws - designed for fire-and-forget usage
   *
   * @param items Array of items to embed
   * @param options Batch options (concurrency limit)
   * @returns Promise with embedding result statistics
   */
  async batchEmbed(
    items: Array<{
      content: string;
      metadata: {
        url: string;
        title?: string;
        sourceCommand?: string;
        contentType?: string;
        [key: string]: unknown;
      };
    }>,
    options: { concurrency?: number } = {}
  ): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    const result = {
      succeeded: 0,
      failed: 0,
      errors: [] as string[],
    };

    if (items.length === 0) return result;

    const concurrency = options.concurrency ?? MAX_CONCURRENT_EMBEDS;
    const limit = pLimit(concurrency);
    const MAX_ERRORS = 10; // Limit stored errors to avoid memory issues

    const promises = items.map((item) =>
      limit(async () => {
        try {
          await this.autoEmbedInternal(item.content, item.metadata);
          result.succeeded++;
        } catch (error) {
          result.failed++;
          // Collect error messages (limit to first 10 to avoid memory issues)
          if (result.errors.length < MAX_ERRORS) {
            const errorMsg =
              error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`${item.metadata.url}: ${errorMsg}`);
          }
        }
      })
    );

    await Promise.all(promises);

    // Log summary if there were any failures
    if (result.failed > 0) {
      const total = result.succeeded + result.failed;
      console.error(
        `Embedded ${result.succeeded}/${total} items (${result.failed} failed)`
      );
    }

    return result;
  }
}
