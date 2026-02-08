/**
 * List command implementation
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type { CrawlActiveResult } from '../types/crawl';
import { processCommandResult } from '../utils/command';
import { fmt, icons } from '../utils/theme';
import { requireContainer } from './shared';

export interface ListOptions {
  apiKey?: string;
  output?: string;
  json?: boolean;
  pretty?: boolean;
}

/**
 * Execute list command (active crawls)
 */
export async function executeList(
  container: IContainer,
  _options: ListOptions
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
  processCommandResult(
    await executeList(container, options),
    { ...options, json: options.json || !!options.output },
    (data) => {
      const crawls = data?.crawls ?? [];
      if (crawls.length === 0) {
        return fmt.dim('No active crawls.');
      }
      const lines: string[] = [];
      lines.push(`  ${fmt.primary('Active crawls:')}`);
      for (const crawl of crawls) {
        lines.push(
          `    ${fmt.warning(icons.processing)} ${fmt.dim(crawl.id)} ${crawl.url}`
        );
      }
      return lines.join('\n');
    }
  );
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
    .option('--json', 'Output as JSON', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (options, command: Command) => {
      const container = requireContainer(command);

      await handleListCommand(container, {
        apiKey: options.apiKey,
        json: options.json,
        output: options.output,
        pretty: options.pretty,
      });
    });

  return listCmd;
}
