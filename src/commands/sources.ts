/**
 * Sources command implementation
 * Lists all unique source URLs indexed in Qdrant
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type {
  SourceInfo,
  SourcesOptions,
  SourcesResult,
} from '../types/sources';
import { formatJson, handleCommandError } from '../utils/command';
import { validateOutputPath, writeOutput } from '../utils/output';

/**
 * Execute sources command
 * Scrolls all points and aggregates unique URLs
 *
 * @param container DI container with services
 * @param options Sources options including filters
 * @returns SourcesResult with source list or error
 */
export async function executeSources(
  container: IContainer,
  options: SourcesOptions
): Promise<SourcesResult> {
  try {
    const config = container.config;
    const qdrantUrl = config.qdrantUrl;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl';

    if (!qdrantUrl) {
      return {
        success: false,
        error: 'QDRANT_URL must be set in .env for the sources command.',
      };
    }

    const qdrantService = container.getQdrantService();

    // Build filter
    const filter: Record<string, string | number | boolean> = {};
    if (options.domain) {
      filter.domain = options.domain;
    }
    if (options.source) {
      filter.source_command = options.source;
    }

    // Scroll all points (with optional filter)
    const points = await qdrantService.scrollAll(
      collection,
      Object.keys(filter).length > 0 ? filter : undefined
    );

    // Aggregate by URL
    const sourcesMap = new Map<string, SourceInfo>();

    for (const point of points) {
      const url = String(point.payload.url || '');
      if (!url) continue;

      if (!sourcesMap.has(url)) {
        sourcesMap.set(url, {
          url,
          domain: String(point.payload.domain || ''),
          title: String(point.payload.title || ''),
          totalChunks: Number(point.payload.total_chunks || 1),
          sourceCommand: String(point.payload.source_command || ''),
          scrapedAt: String(point.payload.scraped_at || ''),
        });
      }
    }

    // Convert to array and sort by scrapedAt descending
    let sources = Array.from(sourcesMap.values()).sort((a, b) =>
      b.scrapedAt.localeCompare(a.scrapedAt)
    );

    // Apply limit if specified
    if (options.limit && options.limit > 0) {
      sources = sources.slice(0, options.limit);
    }

    // Calculate aggregates
    const uniqueDomains = new Set(sources.map((s) => s.domain)).size;

    return {
      success: true,
      data: {
        sources,
        totalSources: sources.length,
        totalChunks: points.length,
        uniqueDomains,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format sources as table
 */
function formatTable(sources: SourceInfo[]): string {
  if (sources.length === 0) {
    return 'No sources found in vector database.';
  }

  const lines: string[] = [];

  // Header
  const header = [
    'Domain'.padEnd(25),
    'URL'.padEnd(50),
    'Chunks'.padStart(6),
    'Source'.padEnd(8),
    'Added',
  ].join('  ');
  lines.push(header);
  lines.push('─'.repeat(header.length));

  // Rows
  for (const source of sources) {
    const domain =
      source.domain.length > 24
        ? `${source.domain.slice(0, 22)}..`
        : source.domain.padEnd(25);
    const url =
      source.url.length > 49
        ? `${source.url.slice(0, 47)}..`
        : source.url.padEnd(50);
    const chunks = String(source.totalChunks).padStart(6);
    const cmd = source.sourceCommand.padEnd(8);
    const added = source.scrapedAt ? source.scrapedAt.split('T')[0] : 'unknown';

    lines.push([domain, url, chunks, cmd, added].join('  '));
  }

  return lines.join('\n');
}

/**
 * Format sources summary
 */
function formatSummary(data: NonNullable<SourcesResult['data']>): string {
  return `\nTotal: ${data.totalSources} sources, ${data.totalChunks} chunks across ${data.uniqueDomains} domains`;
}

/**
 * Handle sources command output
 */
export async function handleSourcesCommand(
  container: IContainer,
  options: SourcesOptions
): Promise<void> {
  const result = await executeSources(container, options);

  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) return;

  if (options.output) {
    validateOutputPath(options.output);
  }

  let outputContent: string;

  if (options.json) {
    outputContent = formatJson({ success: true, data: result.data });
  } else {
    outputContent =
      formatTable(result.data.sources) + formatSummary(result.data);
  }

  writeOutput(outputContent, options.output, !!options.output);
}

/**
 * Create and configure the sources command
 */
export function createSourcesCommand(): Command {
  const sourcesCmd = new Command('sources')
    .description('List all source URLs indexed in the vector database')
    .option('--domain <domain>', 'Filter by domain')
    .option(
      '--source <command>',
      'Filter by source command (scrape, crawl, embed, search, extract)'
    )
    .option('--limit <number>', 'Maximum sources to show', parseInt)
    .option(
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON (default: false)', false)
    .action(async (options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      await handleSourcesCommand(container, {
        domain: options.domain,
        source: options.source,
        limit: options.limit,
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return sourcesCmd;
}
