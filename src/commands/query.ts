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
import { formatJson, handleCommandError } from '../utils/command';
import { validateOutputPath, writeOutput } from '../utils/output';

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
    const config = container.config;
    const { teiUrl, qdrantUrl } = config;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl';

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

    // Search Qdrant
    const results = await qdrantService.queryPoints(
      collection,
      queryVector,
      options.limit || 5,
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
 * Format compact output (default)
 * Shows score, URL, optional header, and truncated chunk text
 * @param items Query result items to format
 * @returns Formatted string for compact display
 */
function formatCompact(items: QueryResultItem[]): string {
  if (items.length === 0) return 'No results found.';
  const results = items
    .map((item) => {
      const header = item.chunkHeader ? ` — ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      const truncated =
        item.chunkText.length > 120
          ? `${item.chunkText.slice(0, 120)}...`
          : item.chunkText;
      return `[${score}] ${item.url}${header}\n  ${truncated}`;
    })
    .join('\n\n');

  return `${results}\n\n${getRetrievalHint()}`;
}

/**
 * Format full output (--full flag)
 * Shows score, URL, optional header, and complete chunk text
 * @param items Query result items to format
 * @returns Formatted string with full chunk text
 */
function formatFull(items: QueryResultItem[]): string {
  if (items.length === 0) return 'No results found.';
  const results = items
    .map((item) => {
      const header = item.chunkHeader ? ` — ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      return `[${score}] ${item.url}${header}\n\n${item.chunkText}`;
    })
    .join('\n\n---\n\n');

  return `${results}\n\n---\n\n${getRetrievalHint()}`;
}

/**
 * Format grouped output (--group flag)
 * Groups results by URL, showing chunks under each URL heading
 * @param items Query result items to format
 * @param full Whether to show full chunk text or truncated
 * @returns Formatted string grouped by URL
 */
function formatGrouped(items: QueryResultItem[], full: boolean): string {
  if (items.length === 0) return 'No results found.';

  const groups = new Map<string, QueryResultItem[]>();
  for (const item of items) {
    const existing = groups.get(item.url) || [];
    existing.push(item);
    groups.set(item.url, existing);
  }

  const parts: string[] = [];
  for (const [url, groupItems] of groups) {
    parts.push(`== ${url} ==`);
    for (const item of groupItems) {
      const header = item.chunkHeader ? ` — ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      if (full) {
        parts.push(`  [${score}]${header}\n${item.chunkText}`);
      } else {
        const truncated =
          item.chunkText.length > 120
            ? `${item.chunkText.slice(0, 120)}...`
            : item.chunkText;
        parts.push(`  [${score}]${header}\n  ${truncated}`);
      }
    }
    parts.push('');
  }

  return `${parts.join('\n')}\n${getRetrievalHint()}`;
}

/**
 * Get hint text for retrieving full documents
 * @returns Formatted hint message for users
 */
function getRetrievalHint(): string {
  return '💡 To retrieve full documents from the vector DB, use:\n  firecrawl retrieve <url>';
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
  const result = await executeQuery(container, options);

  // Use shared error handler
  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) return;

  // Validate output path before processing to prevent path traversal attacks
  if (options.output) {
    validateOutputPath(options.output);
  }

  let outputContent: string;
  if (options.json) {
    outputContent = formatJson({ success: true, data: result.data });
  } else if (options.group) {
    outputContent = formatGrouped(result.data, !!options.full);
  } else if (options.full) {
    outputContent = formatFull(result.data);
  } else {
    outputContent = formatCompact(result.data);
  }

  writeOutput(outputContent, options.output, !!options.output);
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
      'Maximum number of results (default: 5)',
      parseInt,
      5
    )
    .option('--domain <domain>', 'Filter results by domain')
    .option(
      '--full',
      'Show full chunk text instead of truncated (default: false)',
      false
    )
    .option('--group', 'Group results by URL (default: false)', false)
    .option(
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format (default: false)', false)
    .action(async (query: string, options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

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
