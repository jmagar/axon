/**
 * List command implementation
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type { CrawlActiveResult } from '../types/crawl';
import { formatJson } from '../utils/command';
import { writeOutput } from '../utils/output';

export interface ListOptions {
  apiKey?: string;
  output?: string;
  pretty?: boolean;
}

/**
 * Execute list command (active crawls)
 */
export async function executeList(
  container: IContainer,
  options: ListOptions
): Promise<CrawlActiveResult> {
  try {
    const app = container.getFirecrawlClient();
    const active = await app.getActiveCrawls();
    return { success: true, data: active };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Handle list command output
 */
export async function handleListCommand(
  container: IContainer,
  options: ListOptions
): Promise<void> {
  const result = await executeList(container, options);
  if (!result.success) {
    console.error('Error:', result.error || 'Unknown error occurred');
    process.exit(1);
  }

  const pretty = options.pretty ?? true;

  if (
    !options.output &&
    !pretty &&
    result.data &&
    Array.isArray(result.data.crawls) &&
    result.data.crawls.length === 0
  ) {
    console.log('No active crawls.');
    return;
  }

  const outputContent = formatJson(
    { success: true, data: result.data },
    pretty
  );
  writeOutput(outputContent, options.output, !!options.output);
}

/**
 * Create and configure the list command
 */
export function createListCommand(): Command {
  const listCmd = new Command('list')
    .description('List active crawl jobs')
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--no-pretty', 'Disable pretty JSON output')
    .action(async (options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      await handleListCommand(container, {
        apiKey: options.apiKey,
        output: options.output,
        pretty: options.pretty,
      });
    });

  return listCmd;
}
