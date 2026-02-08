/**
 * Stats command implementation
 * Shows vector database statistics
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type {
  DomainStats,
  SourceCommandStats,
  StatsData,
  StatsOptions,
  StatsResult,
} from '../types/stats';
import { processCommandResult } from '../utils/command';
import { fmt, icons } from '../utils/theme';
import {
  addVectorOutputOptions,
  getQdrantUrlError,
  requireContainer,
  resolveCollectionName,
} from './shared';

/**
 * Execute stats command
 *
 * @param container DI container with services
 * @param options Stats options
 * @returns StatsResult with statistics or error
 */
export async function executeStats(
  container: IContainer,
  options: StatsOptions
): Promise<StatsResult> {
  try {
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    if (!qdrantUrl) {
      return {
        success: false,
        error: getQdrantUrlError('stats'),
      };
    }

    const qdrantService = container.getQdrantService();

    // Get collection info
    const collectionInfo = await qdrantService.getCollectionInfo(collection);

    // Scroll all points for aggregation
    const points = await qdrantService.scrollAll(collection);

    // Aggregate by domain
    const domainMap = new Map<string, { vectors: number; urls: Set<string> }>();
    for (const point of points) {
      const domain = String(point.payload.domain || 'unknown');
      const url = String(point.payload.url || '');

      if (!domainMap.has(domain)) {
        domainMap.set(domain, { vectors: 0, urls: new Set() });
      }
      const entry = domainMap.get(domain);
      if (entry) {
        entry.vectors++;
        if (url) entry.urls.add(url);
      }
    }

    const byDomain: DomainStats[] = Array.from(domainMap.entries())
      .map(([domain, data]) => ({
        domain,
        vectorCount: data.vectors,
        sourceCount: data.urls.size,
      }))
      .sort((a, b) => b.vectorCount - a.vectorCount);

    // Aggregate by source command
    const commandMap = new Map<string, number>();
    for (const point of points) {
      const cmd = String(point.payload.source_command || 'unknown');
      commandMap.set(cmd, (commandMap.get(cmd) || 0) + 1);
    }

    const bySourceCommand: SourceCommandStats[] = Array.from(
      commandMap.entries()
    )
      .map(([command, vectorCount]) => ({ command, vectorCount }))
      .sort((a, b) => b.vectorCount - a.vectorCount);

    return {
      success: true,
      data: {
        collection,
        status: collectionInfo.status,
        vectorsCount: collectionInfo.vectorsCount,
        pointsCount: collectionInfo.pointsCount,
        segmentsCount: collectionInfo.segmentsCount,
        dimension: collectionInfo.config.dimension,
        distance: collectionInfo.config.distance,
        byDomain,
        bySourceCommand,
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
 * Format stats for human display
 */
function formatHuman(data: StatsData, verbose: boolean): string {
  const lines: string[] = [];

  lines.push(`  ${fmt.primary('Vector database statistics')}`);
  lines.push(`    ${fmt.dim('Collection:')} ${data.collection}`);
  lines.push(`    ${fmt.dim('Status:')} ${data.status}`);
  lines.push(
    `    ${fmt.dim('Vectors:')} ${data.vectorsCount.toLocaleString()}`
  );
  lines.push(`    ${fmt.dim('Dimension:')} ${data.dimension}`);
  lines.push(`    ${fmt.dim('Distance:')} ${data.distance}`);

  if (verbose) {
    lines.push(
      `    ${fmt.dim('Points:')} ${data.pointsCount.toLocaleString()}`
    );
    lines.push(`    ${fmt.dim('Segments:')} ${data.segmentsCount}`);
  }

  if (data.byDomain.length > 0) {
    lines.push('');
    lines.push(`  ${fmt.primary('By domain')}`);
    for (const d of data.byDomain.slice(0, 10)) {
      const sources = d.sourceCount > 1 ? ` (${d.sourceCount} sources)` : '';
      lines.push(
        `    ${fmt.info(icons.bullet)} ${d.domain.padEnd(30)} ${d.vectorCount.toLocaleString().padStart(8)} vectors${sources}`
      );
    }
    if (data.byDomain.length > 10) {
      lines.push(
        `    ${fmt.dim(`... and ${data.byDomain.length - 10} more domains`)}`
      );
    }
  }

  if (data.bySourceCommand.length > 0) {
    lines.push('');
    lines.push(`  ${fmt.primary('By source command')}`);
    for (const c of data.bySourceCommand) {
      lines.push(
        `    ${fmt.info(icons.bullet)} ${c.command.padEnd(15)} ${c.vectorCount.toLocaleString().padStart(8)} vectors`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Handle stats command output
 */
export async function handleStatsCommand(
  container: IContainer,
  options: StatsOptions
): Promise<void> {
  processCommandResult(
    await executeStats(container, options),
    options,
    (resultData) => formatHuman(resultData, !!options.verbose)
  );
}

/**
 * Create and configure the stats command
 */
export function createStatsCommand(): Command {
  const statsCmd = addVectorOutputOptions(
    new Command('stats')
      .description('Show vector database statistics')
      .option('--verbose', 'Include additional details', false)
  ).action(async (options, command: Command) => {
    const container = requireContainer(command);

    await handleStatsCommand(container, {
      verbose: options.verbose,
      collection: options.collection,
      output: options.output,
      json: options.json,
    });
  });

  return statsCmd;
}
