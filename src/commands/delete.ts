/**
 * Delete command implementation
 * Removes vectors from Qdrant by URL, domain, or all
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type { DeleteOptions, DeleteResult } from '../types/delete';
import { processCommandResult } from '../utils/command';
import { parseDeleteOptions } from '../utils/options';
import {
  addVectorOutputOptions,
  getQdrantUrlError,
  requireContainer,
  resolveCollectionName,
} from './shared';

/**
 * Execute delete command
 * Validates options, counts vectors before deletion, then deletes
 *
 * @param container DI container with services
 * @param options Delete options (requires exactly one target and --yes flag)
 * @returns DeleteResult with deletion count or error
 */
export async function executeDelete(
  container: IContainer,
  options: DeleteOptions
): Promise<DeleteResult> {
  try {
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    if (!qdrantUrl) {
      return {
        success: false,
        error: getQdrantUrlError('delete'),
      };
    }

    // Validate exactly ONE target specified
    const targetCount = [options.url, options.domain, options.all].filter(
      Boolean
    ).length;

    if (targetCount !== 1) {
      return {
        success: false,
        error: 'Must specify exactly one target: --url, --domain, or --all',
      };
    }

    // REQUIRE --yes confirmation
    if (!options.yes) {
      return {
        success: false,
        error:
          'Delete operation requires explicit confirmation with --yes flag',
      };
    }

    const qdrantService = container.getQdrantService();

    // Delete by URL
    if (options.url) {
      const count = await qdrantService.countByUrl(collection, options.url);
      await qdrantService.deleteByUrl(collection, options.url);
      return {
        success: true,
        data: {
          deleted: count,
          target: options.url,
          targetType: 'url',
        },
      };
    }

    // Delete by domain
    if (options.domain) {
      const count = await qdrantService.countByDomain(
        collection,
        options.domain
      );
      await qdrantService.deleteByDomain(collection, options.domain);
      return {
        success: true,
        data: {
          deleted: count,
          target: options.domain,
          targetType: 'domain',
        },
      };
    }

    // Delete all
    if (options.all) {
      const count = await qdrantService.countPoints(collection);
      await qdrantService.deleteAll(collection);
      return {
        success: true,
        data: {
          deleted: count,
          target: 'all vectors',
          targetType: 'all',
        },
      };
    }

    // Should never reach here due to validation above
    return {
      success: false,
      error: 'No valid target specified',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format delete result for human display
 */
function formatHuman(data: NonNullable<DeleteResult['data']>): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Delete Operation Complete');
  lines.push('═'.repeat(50));
  lines.push('');

  if (data.deleted === 0) {
    lines.push(`No vectors found for ${data.targetType}: ${data.target}`);
  } else {
    lines.push(`Deleted:        ${data.deleted.toLocaleString()} vectors`);
    lines.push(`Target type:    ${data.targetType}`);
    lines.push(`Target:         ${data.target}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Handle delete command output
 */
export async function handleDeleteCommand(
  container: IContainer,
  options: DeleteOptions
): Promise<void> {
  processCommandResult(
    await executeDelete(container, options),
    options,
    formatHuman
  );
}

/**
 * Create and configure the delete command
 */
export function createDeleteCommand(): Command {
  const deleteCmd = addVectorOutputOptions(
    new Command('delete')
      .description('Delete vectors from the vector database')
      .option('--url <url>', 'Delete all vectors for a specific URL')
      .option('--domain <domain>', 'Delete all vectors for a specific domain')
      .option('--all', 'Delete all vectors in the collection')
      .option(
        '--yes',
        'Confirm deletion (required for safety) (default: false)',
        false
      )
  ).action(async (options, command: Command) => {
    const container = requireContainer(command);
    const parsedOptions = parseDeleteOptions(options);

    await handleDeleteCommand(container, parsedOptions);
  });

  return deleteCmd;
}
