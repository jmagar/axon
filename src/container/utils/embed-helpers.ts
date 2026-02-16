/**
 * Embedding helper utilities
 *
 * Pure transformation functions for preparing data for embedding.
 * These are stateless utilities that don't require container services.
 */

import { fmt } from '../../utils/theme';

/**
 * Metadata for embedding a single document
 */
export interface EmbedMetadata {
  url: string;
  title?: string;
  sourceCommand: string;
  contentType?: string;
  scraped_at?: string;
  file_modified_at?: string;
  source_path_rel?: string;
}

/**
 * Item to be embedded in batch operations
 */
export interface EmbedItem {
  content: string;
  metadata: EmbedMetadata;
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
    metadata?: {
      sourceURL?: string;
      url?: string;
      title?: string;
      scrapedAt?: string;
      scraped_at?: string;
      fileModifiedAt?: string;
      file_modified_at?: string;
      sourcePathRel?: string;
      source_path_rel?: string;
    };
  },
>(pages: T[], sourceCommand: string): EmbedItem[] {
  const validPages = pages.filter((page) => page.markdown || page.html);
  const skippedCount = pages.length - validPages.length;

  if (skippedCount > 0) {
    console.warn(
      fmt.warning(`Skipped ${skippedCount} pages without content for embedding`)
    );
  }

  return validPages.map((page) => ({
    content: page.markdown || page.html || '',
    metadata: {
      url: page.url || page.metadata?.sourceURL || page.metadata?.url || '',
      title: page.title || page.metadata?.title,
      sourceCommand,
      contentType: page.markdown ? 'markdown' : 'html',
      scraped_at: page.metadata?.scraped_at || page.metadata?.scrapedAt,
      file_modified_at:
        page.metadata?.file_modified_at || page.metadata?.fileModifiedAt,
      source_path_rel:
        page.metadata?.source_path_rel || page.metadata?.sourcePathRel,
    },
  }));
}
