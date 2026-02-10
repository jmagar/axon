/**
 * Query command implementation
 * Semantic search over Qdrant vectors
 */

import type { IContainer } from '../container/types';
import type {
  QueryOptions,
  QueryResult,
  QueryResultItem,
} from '../types/query';
import { processCommandResult } from '../utils/command';
import { fmt, icons } from '../utils/theme';
import { requireContainer, resolveCollectionName } from './shared';

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

    if (!teiUrl || !qdrantUrl) {
      return {
        success: false,
        error:
          'TEI_URL and QDRANT_URL must be set in .env for the query command.',
      };
    }

    // Get services from container
    const teiService = container.getTeiService();
    const qdrantService = container.getQdrantService();

    // Embed the query text
    const [queryVector] = await teiService.embedBatch([options.query]);

    // Build filter for Qdrant query
    const filter = options.domain ? { domain: options.domain } : undefined;

    // Fetch MORE results than requested to account for deduplication
    // After grouping by URL, we'll have fewer unique URLs than chunks
    const requestedLimit = options.limit || 10;
    const fetchLimit = requestedLimit * 10; // Fetch 10x to ensure enough unique URLs

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
    }));

    return { success: true, data: items };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Strip fragment identifier from URL
 * @param url URL with possible fragment
 * @returns URL without fragment
 */
function stripFragment(url: string): string {
  const hashIndex = url.indexOf('#');
  return hashIndex === -1 ? url : url.substring(0, hashIndex);
}

/**
 * Get meaningful snippet from chunk text
 * Skips formatting characters and finds substantive content
 * @param text Chunk text to extract snippet from
 * @returns Meaningful snippet or truncated text
 */
function getMeaningfulSnippet(text: string): string {
  // Clean up markdown and formatting
  const cleaned = text
    .replace(/\[​\]\([^)]+\)/g, '') // Remove empty markdown links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert markdown links to just text
    .replace(/^[\s\n\r\t*\-•]+/, '') // Remove leading whitespace and list markers
    .replace(/^\s*#{1,6}\s+/, '') // Remove leading markdown headers
    .replace(/^[-=_*]{3,}.*$/gm, '') // Remove horizontal rules
    .trim();

  // Split into lines and find the first substantial line
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      // Skip empty lines, horizontal rules, very short lines
      if (l.length < 10) return false;
      if (/^[-=_*]{3,}$/.test(l)) return false;
      if (/^[*\-•]\s*$/.test(l)) return false;
      // Skip lines that are just single words or very basic
      if (l.split(/\s+/).length < 2) return false;
      return true;
    });

  if (lines.length === 0) {
    // Fallback: clean markdown from original and truncate
    const fallback = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    return fallback.slice(0, 120);
  }

  // Use the first substantial line
  const snippet = lines[0];
  return snippet.length > 120 ? `${snippet.slice(0, 120)}...` : snippet;
}

/**
 * Format compact output (default)
 * Groups by base URL and shows highest-scoring chunk with numbered results
 * @param items Query result items to format
 * @param limit Maximum number of unique URLs to display
 * @returns Formatted string for compact display
 */
function formatCompact(items: QueryResultItem[], limit: number = 10): string {
  if (items.length === 0) return fmt.dim('No results found.');

  // Group by base URL (without fragment)
  const grouped = new Map<string, QueryResultItem[]>();
  for (const item of items) {
    const baseUrl = stripFragment(item.url);
    const existing = grouped.get(baseUrl) || [];
    existing.push(item);
    grouped.set(baseUrl, existing);
  }

  // Sort groups by highest score in each group, then limit to requested number
  const sortedGroups = Array.from(grouped.entries())
    .map(([baseUrl, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => b.score - a.score);
      return { baseUrl, items: sorted, topScore: sorted[0].score };
    })
    .sort((a, b) => b.topScore - a.topScore)
    .slice(0, limit);

  // Format each group (show highest-scoring chunk)
  const lines: string[] = [];
  lines.push(`  ${fmt.primary('Query results')}`);
  lines.push('');

  const results: string[] = [];
  let index = 1;
  for (const { baseUrl, items: groupItems } of sortedGroups) {
    const topItem = groupItems[0];
    const chunkCount = groupItems.length;

    const score = topItem.score.toFixed(2);
    const countPart = chunkCount > 1 ? ` (${chunkCount} chunks)` : ' (1 chunk)';
    const snippet = getMeaningfulSnippet(topItem.chunkText);

    results.push(
      `  ${fmt.dim(`${index}.`)} [${score}] ${baseUrl}${countPart}\n     ${snippet}`
    );
    index++;
  }

  lines.push(results.join('\n\n'));
  lines.push('');
  lines.push(getRetrievalHint());
  return lines.join('\n');
}

/**
 * Format full output (--full flag)
 * Shows score, URL, optional header, and complete chunk text
 * @param items Query result items to format
 * @returns Formatted string with full chunk text
 */
function formatFull(items: QueryResultItem[]): string {
  if (items.length === 0) return fmt.dim('No results found.');
  const lines: string[] = [];
  lines.push(`  ${fmt.primary('Query results')}`);
  lines.push('');
  const results = items
    .map((item) => {
      const header = item.chunkHeader ? ` - ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      return `    ${fmt.info(icons.bullet)} [${score}] ${item.url}${header}\n\n${item.chunkText}`;
    })
    .join('\n\n---\n\n');
  lines.push(results);
  lines.push('');
  lines.push(getRetrievalHint());
  return lines.join('\n');
}

/**
 * Format grouped output (--group flag)
 * Groups results by URL, showing chunks under each URL heading
 * @param items Query result items to format
 * @param full Whether to show full chunk text or truncated
 * @returns Formatted string grouped by URL
 */
function formatGrouped(items: QueryResultItem[], full: boolean): string {
  if (items.length === 0) return fmt.dim('No results found.');

  const groups = new Map<string, QueryResultItem[]>();
  for (const item of items) {
    const existing = groups.get(item.url) || [];
    existing.push(item);
    groups.set(item.url, existing);
  }

  const parts: string[] = [];
  parts.push(`  ${fmt.primary('Query results')}`);
  parts.push('');
  for (const [url, groupItems] of groups) {
    parts.push(`  ${fmt.primary(url)}`);
    for (const item of groupItems) {
      const header = item.chunkHeader ? ` - ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      if (full) {
        parts.push(
          `    ${fmt.info(icons.bullet)} [${score}]${header}\n${item.chunkText}`
        );
      } else {
        const truncated =
          item.chunkText.length > 120
            ? `${item.chunkText.slice(0, 120)}...`
            : item.chunkText;
        parts.push(
          `    ${fmt.info(icons.bullet)} [${score}]${header}\n      ${truncated}`
        );
      }
    }
    parts.push('');
  }

  parts.push(getRetrievalHint());
  return parts.join('\n');
}

/**
 * Get hint text for retrieving full documents
 * @returns Formatted hint message for users
 */
function getRetrievalHint(): string {
  return `${fmt.dim(`${icons.arrow} To retrieve full documents from the vector DB, use: firecrawl retrieve <url>`)}`;
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
  processCommandResult(
    await executeQuery(container, options),
    options,
    (data) => {
      if (options.group) {
        return formatGrouped(data, !!options.full);
      }
      if (options.full) {
        return formatFull(data);
      }
      return formatCompact(data, options.limit || 10);
    }
  );
}

import { Command } from 'commander';

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
      (val) => parseInt(val, 10),
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
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
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
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return queryCmd;
}
