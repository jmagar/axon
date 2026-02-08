/**
 * History command implementation
 * Shows time-based view of indexed content
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type {
  HistoryEntry,
  HistoryOptions,
  HistoryResult,
} from '../types/history';
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
 * Execute history command
 * Shows time-based view of indexed content, sorted by date descending
 *
 * @param container DI container with services
 * @param options History options including filters
 * @returns HistoryResult with history entries or error
 */
export async function executeHistory(
  container: IContainer,
  options: HistoryOptions
): Promise<HistoryResult> {
  try {
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    if (!qdrantUrl) {
      return {
        success: false,
        error: getQdrantUrlError('history'),
      };
    }

    const qdrantService = container.getQdrantService();

    const points = await qdrantService.scrollAll(
      collection,
      buildDomainSourceFilter(options)
    );

    // Aggregate by URL - process ONLY chunk_index === 0 to avoid duplicates
    const entriesMap = new Map<string, HistoryEntry>();

    for (const point of points) {
      const chunkIndex = Number(point.payload.chunk_index ?? 0);
      if (chunkIndex !== 0) continue; // Skip non-first chunks

      const url = String(point.payload.url || '');
      if (!url) continue;

      const scrapedAt = String(point.payload.scraped_at || '');
      if (!scrapedAt) continue; // Skip entries without date

      if (!entriesMap.has(url)) {
        entriesMap.set(url, {
          date: scrapedAt,
          url,
          domain: String(point.payload.domain || ''),
          sourceCommand: String(point.payload.source_command || ''),
          chunks: Number(point.payload.total_chunks || 1),
        });
      }
    }

    // Convert to array
    let entries = Array.from(entriesMap.values());

    // Filter by days if specified
    if (options.days && options.days > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.days);
      const cutoffTime = cutoffDate.getTime();

      entries = entries.filter((entry) => {
        const entryDate = new Date(entry.date);
        return entryDate.getTime() >= cutoffTime;
      });
    }

    // Sort by date descending (newest first)
    entries.sort((a, b) => b.date.localeCompare(a.date));

    // Store total count before limit
    const totalEntries = entries.length;

    // Apply limit if specified
    if (options.limit && options.limit > 0) {
      entries = entries.slice(0, options.limit);
    }

    // Calculate date range (from = earliest, to = latest)
    const dateRange = { from: '', to: '' };
    if (entries.length > 0) {
      // Since entries are sorted descending, first is latest, last is earliest
      dateRange.to = entries[0].date;
      dateRange.from = entries[entries.length - 1].date;
    }

    return {
      success: true,
      data: {
        entries,
        totalEntries,
        dateRange,
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
 * Format history as table
 */
function formatTable(entries: HistoryEntry[]): string {
  if (entries.length === 0) {
    return fmt.dim('No history entries found in vector database.');
  }

  const lines: string[] = [];
  lines.push(`  ${fmt.primary('History')}`);
  lines.push('');

  // Header
  const header = [
    'Date'.padEnd(10),
    'Domain'.padEnd(25),
    'URL'.padEnd(45),
    'Source'.padEnd(8),
    'Chunks'.padStart(6),
  ].join('  ');
  lines.push(header);
  lines.push('─'.repeat(header.length));

  // Rows
  for (const entry of entries) {
    const date = entry.date ? entry.date.split('T')[0] : 'unknown';
    const domain =
      entry.domain.length > 24
        ? `${entry.domain.slice(0, 22)}..`
        : entry.domain.padEnd(25);
    const url =
      entry.url.length > 44
        ? `${entry.url.slice(0, 42)}..`
        : entry.url.padEnd(45);
    const source = entry.sourceCommand.padEnd(8);
    const chunks = String(entry.chunks).padStart(6);

    lines.push([date, domain, url, source, chunks].join('  '));
  }

  return lines.join('\n');
}

/**
 * Format history summary
 */
function formatSummary(data: NonNullable<HistoryResult['data']>): string {
  const parts: string[] = [];

  parts.push(`\n  ${fmt.info(icons.info)} ${data.totalEntries} entries`);

  if (data.dateRange.from && data.dateRange.to) {
    const fromDate = data.dateRange.from.split('T')[0];
    const toDate = data.dateRange.to.split('T')[0];
    parts.push(`  ${fmt.dim('Date range:')} ${fromDate} to ${toDate}`);
  }

  return parts.join('\n');
}

/**
 * Handle history command output
 */
export async function handleHistoryCommand(
  container: IContainer,
  options: HistoryOptions
): Promise<void> {
  processCommandResult(
    await executeHistory(container, options),
    options,
    (resultData) => formatTable(resultData.entries) + formatSummary(resultData)
  );
}

/**
 * Create and configure the history command
 */
export function createHistoryCommand(): Command {
  const historyCmd = addVectorOutputOptions(
    addDomainSourceFilterOptions(
      new Command('history')
        .description('Show time-based view of indexed content')
        .option(
          '--days <number>',
          'Filter by entries from last N days',
          parseInt
        )
        .option('--limit <number>', 'Maximum entries to show', parseInt)
    )
  ).action(async (options, command: Command) => {
    const container = requireContainer(command);

    await handleHistoryCommand(container, {
      days: options.days,
      domain: options.domain,
      source: options.source,
      limit: options.limit,
      collection: options.collection,
      output: options.output,
      json: options.json,
    });
  });

  return historyCmd;
}
