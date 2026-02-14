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
import {
  buildFiltersEcho,
  CANONICAL_EMPTY_STATE,
  displayValue,
  formatAlignedTable,
  formatHeaderBlock,
  truncateWithEllipsis,
} from '../utils/style-output';
import {
  addVectorOutputOptions,
  aggregatePointsByDomain,
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

    // Aggregate by domain using shared function
    const domainMap = aggregatePointsByDomain(points, false);

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
function formatHuman(
  data: StatsData,
  options: StatsOptions & { verbose: boolean }
): string {
  const lines = formatHeaderBlock({
    title: 'Vector Database Statistics',
    summary: `Collection: ${data.collection} | Status: ${displayValue(data.status)} | Vectors: ${data.vectorsCount.toLocaleString()}`,
    filters: buildFiltersEcho([
      ['collection', options.collection],
      ['verbose', options.verbose || undefined],
    ]),
    includeFreshness: true,
  });

  const overviewRows: string[][] = [
    ['Distance', displayValue(data.distance)],
    ['Dimension', String(data.dimension)],
    ['Points', data.pointsCount.toLocaleString()],
  ];
  if (options.verbose) {
    overviewRows.push(['Segments', String(data.segmentsCount)]);
  }
  lines.push(
    formatAlignedTable(
      [
        { header: 'Metric', width: 12 },
        { header: 'Value', width: 24 },
      ],
      overviewRows,
      false
    )
  );
  lines.push('');

  lines.push('By domain');
  lines.push(
    formatAlignedTable(
      [
        { header: 'Domain', width: 30 },
        { header: 'Vectors', width: 8, align: 'right' },
        { header: 'Sources', width: 7, align: 'right' },
      ],
      data.byDomain
        .slice(0, 10)
        .map((domain: DomainStats) => [
          truncateWithEllipsis(displayValue(domain.domain), 30),
          domain.vectorCount.toLocaleString(),
          String(domain.sourceCount),
        ]),
      false
    )
  );
  if (data.byDomain.length === 0) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
  } else if (data.byDomain.length > 10) {
    lines.push(`  ${data.byDomain.length - 10} additional domains not shown`);
  }

  lines.push('');
  lines.push('By source command');
  lines.push(
    formatAlignedTable(
      [
        { header: 'Source', width: 15 },
        { header: 'Vectors', width: 8, align: 'right' },
      ],
      data.bySourceCommand.map((command: SourceCommandStats) => [
        truncateWithEllipsis(displayValue(command.command), 15),
        command.vectorCount.toLocaleString(),
      ]),
      false
    )
  );
  if (data.bySourceCommand.length === 0) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
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
    (resultData) =>
      formatHuman(resultData, { ...options, verbose: !!options.verbose })
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
