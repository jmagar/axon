/**
 * Query command implementation
 * Semantic search over Qdrant vectors
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type {
  QueryOptions,
  QueryResult,
  QueryResultItem,
} from '../types/query';
import { processCommandResult } from '../utils/command';
import { deduplicateQueryItems, groupByBaseUrl } from '../utils/deduplication';
import {
  canonicalSymbols,
  formatHeaderBlock,
  formatOverflowCount,
} from '../utils/display';
import {
  compareBySeverityThenScore,
  getMeaningfulSnippet,
  scoreBand,
  selectBestPreviewItem,
} from '../utils/snippet';
import { fmt, icons } from '../utils/theme';
import {
  requireContainer,
  resolveCollectionName,
  validateEmbeddingUrls,
} from './shared';

export type { PreviewSelection } from '../utils/snippet';
// Re-export snippet types/functions for backward compatibility with tests
export { getMeaningfulSnippet, selectBestPreviewItem } from '../utils/snippet';

/**
 * Execute query command
 * Embeds query text via TEI then searches Qdrant for similar vectors
 * @param container DI container with services
 * @param options Query options including query text, limit, domain filter
 * @returns QueryResult with matched items or error
 */
export async function executeQuery(
  container: IContainer,
  options: QueryOptions
): Promise<QueryResult> {
  try {
    const teiUrl = container.config.teiUrl;
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    const validation = validateEmbeddingUrls(teiUrl, qdrantUrl, 'query');
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Get services from container
    const teiService = container.getTeiService();
    const qdrantService = container.getQdrantService();

    // Embed the query text
    const [queryVector] = await teiService.embedBatch([options.query]);

    // Build filter for Qdrant query
    const filter = options.domain ? { domain: options.domain } : undefined;

    // Validate limit parameter - must be a positive integer
    if (
      options.limit !== undefined &&
      (!Number.isInteger(options.limit) || options.limit < 1)
    ) {
      return {
        success: false,
        error: `Limit must be a positive integer (received: ${options.limit})`,
      };
    }

    // Determine fetch strategy based on output mode
    // Compact/grouped modes deduplicate by URL, so fetch extra chunks to ensure enough unique URLs
    // Full mode shows all chunks, so no need to overfetch
    const requestedLimit = options.limit || 10;
    const needsDeduplication = !options.full; // Compact and grouped modes deduplicate
    const MAX_FETCH_LIMIT = 1000; // Cap to prevent excessive Qdrant queries
    const rawFetchLimit = needsDeduplication
      ? requestedLimit * 10
      : requestedLimit;
    const fetchLimit = Math.min(rawFetchLimit, MAX_FETCH_LIMIT);

    // Search Qdrant
    const results = await qdrantService.queryPoints(
      collection,
      queryVector,
      fetchLimit,
      filter
    );

    const getString = (value: unknown): string =>
      typeof value === 'string' ? value : '';
    const getNumber = (value: unknown, fallback: number): number =>
      typeof value === 'number' ? value : fallback;

    // Map to result items
    const items: QueryResultItem[] = results.map((r) => ({
      score: r.score ?? 0,
      url: getString(r.payload.url),
      title: getString(r.payload.title),
      chunkHeader:
        typeof r.payload.chunk_header === 'string'
          ? r.payload.chunk_header
          : null,
      chunkText: getString(r.payload.chunk_text),
      chunkIndex: getNumber(r.payload.chunk_index, 0),
      totalChunks: getNumber(r.payload.total_chunks, 1),
      domain: getString(r.payload.domain),
      sourceCommand: getString(r.payload.source_command),
      sourcePathRel: getString(r.payload.source_path_rel) || undefined,
      scrapedAt: getString(r.payload.scraped_at) || undefined,
      fileModifiedAt: getString(r.payload.file_modified_at) || undefined,
    }));

    // Apply mode-specific deduplication first, then enforce a hard output cap
    // so overfetch (for dedupe quality) never leaks to command output modes.
    const processedItems = needsDeduplication
      ? deduplicateQueryItems(items, options.query, requestedLimit)
      : items;
    const limitedItems = processedItems.slice(0, requestedLimit);

    return { success: true, data: limitedItems };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

function formatScore(score: number): string {
  const indicator =
    scoreBand(score) === 'high'
      ? canonicalSymbols.running
      : scoreBand(score) === 'medium'
        ? canonicalSymbols.partial
        : canonicalSymbols.stopped;
  const scoreText = `${indicator} [${score.toFixed(2)}]`;
  if (score >= 0.75) return fmt.success(scoreText);
  if (score >= 0.55) return fmt.warning(scoreText);
  return fmt.dim(scoreText);
}

/**
 * Format compact output (default)
 * Groups by base URL and shows highest-scoring chunk with numbered results
 * @param items Query result items to format
 * @param limit Maximum number of unique URLs to display
 * @returns Formatted string for compact display
 */
function formatCompact(
  items: QueryResultItem[],
  query: string,
  verboseSnippets: boolean,
  limit: number = 10,
  filters?: Record<string, unknown>
): string {
  if (items.length === 0) return fmt.dim('No results found.');

  // Items are already deduplicated and limited by executeQuery;
  // just re-group by URL for display (no re-ranking needed).
  const grouped = groupByBaseUrl(items);
  const sortedGroups = Array.from(grouped.entries())
    .map(([baseUrl, groupItems]) => {
      const sorted = [...groupItems].sort(compareBySeverityThenScore);
      return { baseUrl, items: sorted };
    })
    .sort((left, right) => {
      const leftItem = left.items[0];
      const rightItem = right.items[0];
      if (!leftItem || !rightItem) return 0;
      return compareBySeverityThenScore(leftItem, rightItem);
    });

  // Format each group (show highest-scoring chunk)
  const lines: string[] = [];
  lines.push(
    ...formatHeaderBlock({
      title: `Query Results for "${query}"`,
      summary: [
        `Showing ${sortedGroups.length} of ${items.length} results`,
        `mode: compact`,
        `limit: ${limit}`,
      ],
      legend:
        new Set(items.map((item) => scoreBand(item.score))).size > 1
          ? [
              { symbol: canonicalSymbols.running, label: 'high relevance' },
              { symbol: canonicalSymbols.partial, label: 'medium relevance' },
              { symbol: canonicalSymbols.stopped, label: 'low relevance' },
            ]
          : [],
      filters,
      freshness: true,
    })
  );

  const results: string[] = [];
  let index = 1;
  for (const { baseUrl, items: groupItems } of sortedGroups) {
    const selection = selectBestPreviewItem(groupItems, query);
    const topItem = selection.selected;
    const chunkCount = groupItems.length;

    const score = topItem.score;
    const countPart = chunkCount > 1 ? ` (${chunkCount} chunks)` : ' (1 chunk)';
    const snippet = getMeaningfulSnippet(topItem.chunkText, query);

    results.push(
      `    ${fmt.info(icons.bullet)} ${fmt.dim(`${index}.`)} ${formatScore(score)} ${fmt.primary(baseUrl)}${fmt.dim(countPart)}`
    );
    results.push(`      ${snippet}`);
    if (verboseSnippets) {
      const topCandidateItems = selection.candidates
        .slice()
        .sort(
          (a, b) =>
            b.previewScore - a.previewScore || b.item.score - a.item.score
        )
        .slice(0, 3);
      const hiddenCandidates = Math.max(selection.candidates.length - 3, 0);
      const topCandidates = topCandidateItems
        .map(
          (c) =>
            `#${c.item.chunkIndex}(v=${c.item.score.toFixed(2)},p=${c.previewScore.toFixed(2)},s=${c.sentenceCount})`
        )
        .join(', ');
      results.push(
        `      ${fmt.dim(`snippet debug: selected=#${topItem.chunkIndex} vector=${topItem.score.toFixed(2)} preview=${selection.selectedPreviewScore.toFixed(2)} candidates=${selection.candidates.length}`)}`
      );
      const overflowPart = formatOverflowCount(hiddenCandidates);
      const topCandidatesWithOverflow = overflowPart
        ? `${topCandidates}, ${overflowPart}`
        : topCandidates;
      results.push(
        `      ${fmt.dim(`top candidates: ${topCandidatesWithOverflow}`)}`
      );
    }
    results.push('');
    index++;
  }

  lines.push(results.join('\n'));
  lines.push(`  ${fmt.primary('Next:')}`);
  lines.push(`    ${getRetrievalHint()}`);
  return lines.join('\n');
}

/**
 * Format full output (--full flag)
 * Shows score, URL, optional header, and complete chunk text
 * @param items Query result items to format
 * @returns Formatted string with full chunk text
 */
function formatFull(
  items: QueryResultItem[],
  query: string,
  limit: number = 10,
  filters?: Record<string, unknown>
): string {
  if (items.length === 0) return fmt.dim('No results found.');

  // Items are already deduplicated and limited by executeQuery;
  // just re-group by URL for display.
  const limitedItems = [...items].sort(compareBySeverityThenScore);

  const lines: string[] = [];
  lines.push(
    ...formatHeaderBlock({
      title: `Query Results for "${query}"`,
      summary: [
        `Showing ${limitedItems.length} of ${items.length} results`,
        `mode: full`,
        `limit: ${limit}`,
      ],
      legend:
        new Set(items.map((item) => scoreBand(item.score))).size > 1
          ? [
              { symbol: canonicalSymbols.running, label: 'high relevance' },
              { symbol: canonicalSymbols.partial, label: 'medium relevance' },
              { symbol: canonicalSymbols.stopped, label: 'low relevance' },
            ]
          : [],
      filters,
      freshness: true,
    })
  );
  const results = limitedItems
    .map((item) => {
      const header = item.chunkHeader ? ` - ${item.chunkHeader}` : '';
      return `    ${fmt.info(icons.bullet)} ${formatScore(item.score)} ${fmt.primary(item.url)}${fmt.dim(header)}\n\n${item.chunkText}`;
    })
    .join('\n\n---\n\n');
  lines.push(results);
  lines.push('');
  lines.push(`  ${fmt.primary('Next:')}`);
  lines.push(`    ${getRetrievalHint()}`);
  return lines.join('\n');
}

/**
 * Format grouped output (--group flag)
 * Groups results by URL, showing chunks under each URL heading
 * @param items Query result items to format
 * @param full Whether to show full chunk text or truncated
 * @returns Formatted string grouped by URL
 */
function formatGrouped(
  items: QueryResultItem[],
  full: boolean,
  query: string,
  verboseSnippets: boolean,
  limit: number = 10,
  filters?: Record<string, unknown>
): string {
  if (items.length === 0) return fmt.dim('No results found.');

  // Items are already deduplicated and limited by executeQuery;
  // just re-group by URL for display (no re-ranking needed).
  const grouped = groupByBaseUrl(items);
  const groups = Array.from(grouped.entries())
    .map(([baseUrl, groupItems]) => {
      const sorted = [...groupItems].sort(compareBySeverityThenScore);
      return { baseUrl, items: sorted };
    })
    .sort((left, right) => {
      const leftItem = left.items[0];
      const rightItem = right.items[0];
      if (!leftItem || !rightItem) return 0;
      return compareBySeverityThenScore(leftItem, rightItem);
    });

  const parts: string[] = [];
  parts.push(
    ...formatHeaderBlock({
      title: `Query Results for "${query}"`,
      summary: [
        `Showing ${groups.length} of ${items.length} results`,
        `mode: grouped${full ? '+full' : ''}`,
        `limit: ${limit}`,
      ],
      legend:
        new Set(items.map((item) => scoreBand(item.score))).size > 1
          ? [
              { symbol: canonicalSymbols.running, label: 'high relevance' },
              { symbol: canonicalSymbols.partial, label: 'medium relevance' },
              { symbol: canonicalSymbols.stopped, label: 'low relevance' },
            ]
          : [],
      filters,
      freshness: true,
    })
  );
  for (const group of groups) {
    const baseUrl = group.baseUrl;
    const groupItems = group.items;
    parts.push(`  ${fmt.primary(baseUrl)}`);
    const selection = !full
      ? selectBestPreviewItem(groupItems, query)
      : undefined;
    for (const item of groupItems) {
      const header = item.chunkHeader ? ` - ${item.chunkHeader}` : '';
      const score = item.score;
      if (full) {
        parts.push(
          `    ${fmt.info(icons.bullet)} ${formatScore(score)}${fmt.dim(header)}\n${item.chunkText}`
        );
      } else {
        const truncated = getMeaningfulSnippet(item.chunkText, query);
        parts.push(
          `    ${fmt.info(icons.bullet)} ${formatScore(score)}${fmt.dim(header)}\n      ${truncated}`
        );
        if (
          verboseSnippets &&
          selection &&
          item.chunkIndex === selection.selected.chunkIndex
        ) {
          const topCandidateItems = selection.candidates
            .slice()
            .sort(
              (a, b) =>
                b.previewScore - a.previewScore || b.item.score - a.item.score
            )
            .slice(0, 3);
          const hiddenCandidates = Math.max(selection.candidates.length - 3, 0);
          const topCandidates = topCandidateItems
            .map(
              (c) =>
                `#${c.item.chunkIndex}(v=${c.item.score.toFixed(2)},p=${c.previewScore.toFixed(2)},s=${c.sentenceCount})`
            )
            .join(', ');
          parts.push(
            `      ${fmt.dim(`snippet debug: selected=#${selection.selected.chunkIndex} vector=${selection.selected.score.toFixed(2)} preview=${selection.selectedPreviewScore.toFixed(2)} candidates=${selection.candidates.length}`)}`
          );
          const overflowPart = formatOverflowCount(hiddenCandidates);
          const topCandidatesWithOverflow = overflowPart
            ? `${topCandidates}, ${overflowPart}`
            : topCandidates;
          parts.push(
            `      ${fmt.dim(`top candidates: ${topCandidatesWithOverflow}`)}`
          );
        }
      }
    }
    parts.push('');
  }

  parts.push(`  ${fmt.primary('Next:')}`);
  parts.push(`    ${getRetrievalHint()}`);
  return parts.join('\n');
}

/**
 * Get hint text for retrieving full documents
 * @returns Formatted hint message for users
 */
function getRetrievalHint(): string {
  return `${fmt.dim(`${icons.arrow} To retrieve full documents from the vector DB, use: axon retrieve <url>`)}`;
}

/**
 * Handle query command output
 * Routes to appropriate formatter based on options flags
 * @param container DI container with services
 * @param options Query options including output format flags
 */
export async function handleQueryCommand(
  container: IContainer,
  options: QueryOptions
): Promise<void> {
  const requestStartTime = Date.now();
  const result = await executeQuery(container, options);
  const requestEndTime = Date.now();
  const durationMs = requestEndTime - requestStartTime;
  const mode = options.group ? 'grouped' : options.full ? 'full' : 'compact';
  const filters: Record<string, unknown> = {
    mode,
    limit: options.limit,
    domain: options.domain,
    collection: options.collection,
  };

  await processCommandResult(result, options, (data) => {
    if (options.group) {
      return formatGrouped(
        data,
        !!options.full,
        options.query,
        !!options.verboseSnippets,
        options.limit || 10,
        filters
      );
    }
    if (options.full) {
      return formatFull(data, options.query, options.limit || 10, filters);
    }
    return formatCompact(
      data,
      options.query,
      !!options.verboseSnippets,
      options.limit || 10,
      filters
    );
  });

  if (!options.timing) return;

  // Keep JSON output machine-friendly (no extra stdout text).
  if (options.json) {
    const status = result.success ? 'success' : 'error';
    const errorPart = result.success
      ? ''
      : ` (${result.error ?? 'Unknown error'})`;
    console.error(`Timing: ${durationMs}ms [${status}]${errorPart}`);
    return;
  }

  if (result.success) {
    const totalChunks = result.data?.length ?? 0;
    const uniqueUrls = groupByBaseUrl(result.data ?? []).size;
    console.error('');
    console.error(
      fmt.dim(
        `${icons.info} Query completed in ${durationMs}ms (${uniqueUrls} URLs, ${totalChunks} chunks scanned)`
      )
    );
    return;
  }

  console.error('');
  console.error(
    fmt.dim(
      `${icons.warning} Query failed after ${durationMs}ms (${result.error ?? 'Unknown error'})`
    )
  );
}

/**
 * Create and configure the query command
 */
export function createQueryCommand(): Command {
  const queryCmd = new Command('query')
    .description('Semantic search over embedded content in Qdrant')
    .argument('<query>', 'Search query text')
    .option(
      '--limit <number>',
      'Maximum number of results (default: 10)',
      (val) => Number.parseInt(val, 10),
      10
    )
    .option('--domain <domain>', 'Filter results by domain')
    .option(
      '--full',
      'Show full chunk text instead of truncated (default: false)',
      false
    )
    .option('--group', 'Group results by URL', false)
    .option(
      '--verbose-snippets',
      'Show snippet selection diagnostics (chunk choice and candidate scores)',
      false
    )
    .option(
      '--timing',
      'Show request timing and other useful information',
      false
    )
    .option('--collection <name>', 'Qdrant collection name (default: axon)')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (query: string, options, command: Command) => {
      const container = requireContainer(command);

      await handleQueryCommand(container, {
        query,
        limit: options.limit,
        domain: options.domain,
        full: options.full,
        group: options.group,
        verboseSnippets: options.verboseSnippets,
        timing: options.timing,
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return queryCmd;
}
