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
import { processCommandResult } from '../utils/command';
import { fmt, icons } from '../utils/theme';
import {
  addDomainSourceFilterOptions,
  addVectorOutputOptions,
  buildDomainSourceFilter,
  getQdrantUrlError,
  requireContainer,
  resolveCollectionName,
} from './shared';

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
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    if (!qdrantUrl) {
      return {
        success: false,
        error: getQdrantUrlError('sources'),
      };
    }

    const qdrantService = container.getQdrantService();

    const points = await qdrantService.scrollAll(
      collection,
      buildDomainSourceFilter(options)
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
    const allSources = Array.from(sourcesMap.values()).sort((a, b) =>
      b.scrapedAt.localeCompare(a.scrapedAt)
    );

    // Calculate aggregates before applying limit
    const totalSources = allSources.length;
    const uniqueDomains = new Set(allSources.map((s) => s.domain)).size;

    // Apply limit if specified
    const sources =
      options.limit && options.limit > 0
        ? allSources.slice(0, options.limit)
        : allSources;

    return {
      success: true,
      data: {
        sources,
        totalSources,
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
    return fmt.dim('No sources found in vector database.');
  }

  const lines: string[] = [];
  lines.push(`  ${fmt.primary('Sources')}`);
  lines.push('');

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
  return `\n  ${fmt.info(icons.info)} ${data.totalSources} sources, ${data.totalChunks} chunks across ${data.uniqueDomains} domains`;
}

/**
 * Handle sources command output
 */
export async function handleSourcesCommand(
  container: IContainer,
  options: SourcesOptions
): Promise<void> {
  processCommandResult(
    await executeSources(container, options),
    options,
    (resultData) => formatTable(resultData.sources) + formatSummary(resultData)
  );
}

/**
 * Create and configure the sources command
 */
export function createSourcesCommand(): Command {
  const sourcesCmd = addVectorOutputOptions(
    addDomainSourceFilterOptions(
      new Command('sources')
        .description('List all source URLs indexed in the vector database')
        .option('--limit <number>', 'Maximum sources to show', parseInt)
    )
  ).action(async (options, command: Command) => {
    const container = requireContainer(command);

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
