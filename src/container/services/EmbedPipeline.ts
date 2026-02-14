/**
 * Embedding Pipeline Service
 * Orchestrates chunking, embedding, and vector storage
 *
 * Coordinates the flow:
 * 1. Chunk content (via chunker utility)
 * 2. Generate embeddings (via TeiService)
 * 3. Store in vector database (via QdrantService)
 */

import pLimit from 'p-limit';
import type { EffectiveUserSettings } from '../../schemas/storage';
import { chunkText } from '../../utils/chunker';
import { DEFAULT_QDRANT_COLLECTION } from '../../utils/defaults';
import { buildEmbeddingPoints, runEmbedSafely } from '../../utils/embed-core';
import { getSettings } from '../../utils/settings';
import { fmt, icons } from '../../utils/theme';
import type { IEmbedPipeline, IQdrantService, ITeiService } from '../types';

/**
 * EmbedPipeline implementation
 * Composes TEI and Qdrant services for end-to-end embedding workflow
 */
export class EmbedPipeline implements IEmbedPipeline {
  private collectionPromise: Promise<void> | null = null;
  private readonly embeddingSettings: EffectiveUserSettings['embedding'];
  private readonly chunkingSettings: EffectiveUserSettings['chunking'];

  constructor(
    private readonly teiService: ITeiService,
    private readonly qdrantService: IQdrantService,
    private readonly collectionName: string = DEFAULT_QDRANT_COLLECTION,
    settings?: EffectiveUserSettings
  ) {
    // Capture settings once at construction time to avoid per-call getSettings() I/O (PERF-02/ARCH-07)
    const resolved = settings ?? getSettings();
    this.embeddingSettings = resolved.embedding;
    this.chunkingSettings = resolved.chunking;
  }

  /**
   * Ensure the target collection exists (only calls Qdrant once per pipeline instance)
   *
   * Concurrency note:
   * - Multiple `autoEmbed`/`batchEmbed` calls can race into this method.
   * - We cache the in-flight Promise immediately, before awaiting any I/O.
   * - Every concurrent caller awaits the same Promise instead of starting its own
   *   `getTeiInfo -> ensureCollection` sequence.
   * This prevents TOCTOU-style races where two callers both observe "not created yet"
   * and then issue duplicate collection-creation attempts.
   */
  private async ensureCollectionReady(): Promise<void> {
    if (this.collectionPromise) {
      return this.collectionPromise;
    }

    this.collectionPromise = (async () => {
      const teiInfo = await this.teiService.getTeiInfo();
      await this.qdrantService.ensureCollection(
        this.collectionName,
        teiInfo.dimension
      );
    })();

    this.collectionPromise.catch(() => {
      // Clear failed initialization so subsequent calls can retry.
      this.collectionPromise = null;
    });

    return this.collectionPromise;
  }

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

    // Ensure collection exists (cached after first call)
    await this.ensureCollectionReady();

    // Chunk content
    const chunks = chunkText(trimmed, this.chunkingSettings);
    if (chunks.length === 0) return;

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const vectors = await this.teiService.embedChunks(texts);

    // Delete existing vectors for this URL (overwrite dedup)
    await this.qdrantService.deleteByUrl(this.collectionName, metadata.url);

    const points = buildEmbeddingPoints(chunks, vectors, metadata, {
      sourceCommandFallback: 'unknown',
      includeExtraMetadata: true,
    });

    // Upsert to Qdrant
    await this.qdrantService.upsertPoints(this.collectionName, points);

    console.error(
      fmt.dim(`Embedded ${chunks.length} chunks for ${metadata.url}`)
    );
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
    await runEmbedSafely(metadata.url, () =>
      this.autoEmbedInternal(content, metadata)
    );
  }

  /**
   * Batch embed multiple items with concurrency control
   *
   * Features:
   * - Prevents resource exhaustion via p-limit
   * - Default concurrency: 10
   * - Tracks success/failure counts
   * - Collects error messages (limit 10)
   * - Optional progress callback after each item completes
   * - Never throws - designed for fire-and-forget usage
   *
   * @param items Array of items to embed
   * @param options Batch options
   * @param options.concurrency Maximum concurrent operations
   * @param options.onProgress Callback invoked after each item (current, total)
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
    options: {
      concurrency?: number;
      onProgress?: (current: number, total: number) => void | Promise<void>;
    } = {}
  ): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    const result = {
      succeeded: 0,
      failed: 0,
      errors: [] as string[],
    };

    if (items.length === 0) return result;

    const concurrency =
      options.concurrency ?? this.embeddingSettings.maxConcurrent;
    const limit = pLimit(concurrency);
    const { onProgress } = options;
    const total = items.length;
    const MAX_ERRORS = 10; // Limit stored errors to avoid memory issues
    const failedUrls: string[] = [];

    console.error(
      fmt.dim(
        `[Pipeline] Starting batch embed of ${items.length} items (concurrency: ${concurrency})`
      )
    );

    const promises = items.map((item, index) =>
      limit(async () => {
        try {
          console.error(
            fmt.dim(
              `[Pipeline] Embedding ${index + 1}/${items.length}: ${item.metadata.url}`
            )
          );

          await this.autoEmbedInternal(item.content, item.metadata);

          result.succeeded++;

          console.error(
            fmt.success(
              `[Pipeline] ${icons.success} Embedded: ${item.metadata.url}`
            )
          );
        } catch (error) {
          result.failed++;
          failedUrls.push(item.metadata.url);

          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error';

          // Log detailed failure
          console.error(
            fmt.error(`[Pipeline] ${icons.error} FAILED: ${item.metadata.url}`)
          );
          console.error(fmt.dim(`[Pipeline]   Error: ${errorMsg}`));

          // Collect error messages (limit to first 10 to avoid memory issues)
          if (result.errors.length < MAX_ERRORS) {
            result.errors.push(`${item.metadata.url}: ${errorMsg}`);
          }
        } finally {
          // Invoke progress callback after each completion
          if (onProgress) {
            try {
              const current = result.succeeded + result.failed;
              await onProgress(current, total);
            } catch (error) {
              // Log but don't throw - progress callback errors shouldn't break embedding
              console.error(
                fmt.warning(
                  `Progress callback error: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
              );
            }
          }
        }
      })
    );

    await Promise.all(promises);

    // Log summary
    if (result.failed > 0) {
      console.error(
        fmt.warning(
          `\n[Pipeline] Embedded ${result.succeeded}/${total} items (${result.failed} failed)`
        )
      );

      // Log failed URLs for easy retry
      if (failedUrls.length > 0) {
        console.error(fmt.error('[Pipeline] Failed URLs:'));
        for (const url of failedUrls) {
          console.error(fmt.dim(`  - ${url}`));
        }
      }
    } else {
      console.error(
        fmt.success(
          `\n[Pipeline] ${icons.success} Successfully embedded all ${result.succeeded} items`
        )
      );
    }

    return result;
  }
}
