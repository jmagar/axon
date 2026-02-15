/**
 * Status command registration and top-level handlers
 */

import { Command } from 'commander';
import packageJson from '../../../package.json';
import type { IContainer, ImmutableConfig } from '../../container/types';
import { getAuthSource, isAuthenticated } from '../../utils/auth';
import { formatJson, writeCommandOutput } from '../../utils/command';
import { DEFAULT_API_URL } from '../../utils/defaults';
import { cleanupOldJobs } from '../../utils/embed-queue';
import { clearJobHistory } from '../../utils/job-history';
import { validateOutputPath } from '../../utils/output';
import { colorize, colors, fmt, icons } from '../../utils/theme';
import { requireContainer } from '../shared';
import { executeJobStatus } from './execute';
import { computeChangedKeys } from './helpers';
import { renderHumanStatus } from './render-summary';
import type {
  JobStatusOptions,
  RenderStatusOptions,
  StatusResult,
} from './types';

function buildStatusFiltersEcho(options: JobStatusOptions): string | undefined {
  const filters: string[] = [];
  if (options.crawl) {
    filters.push(`crawl=${options.crawl}`);
  }
  if (options.batch) {
    filters.push(`batch=${options.batch}`);
  }
  if (options.extract) {
    filters.push(`extract=${options.extract}`);
  }
  if (typeof options.embed === 'string') {
    filters.push(`embed=${options.embed}`);
  } else if (options.embed === true) {
    filters.push('embed=true');
  }

  if (filters.length === 0) {
    return undefined;
  }
  return `Filters: ${filters.join(', ')}`;
}

/**
 * Get status information
 */
export function getStatus(config: ImmutableConfig): StatusResult {
  const authSource = getAuthSource();

  return {
    version: packageJson.version,
    authenticated: isAuthenticated(config.apiKey),
    authSource,
    apiUrl: config.apiUrl || DEFAULT_API_URL,
  };
}

/**
 * Handle status command output (basic auth/version display)
 */
export async function handleStatusCommand(
  container: IContainer,
  _options: Record<string, unknown>
): Promise<void> {
  const status = getStatus(container.config);

  console.log('');
  console.log(
    `  ${fmt.primary(`${icons.success} firecrawl`)} ${fmt.dim('cli')} ${fmt.dim(`v${status.version}`)}`
  );
  console.log('');

  if (status.authenticated) {
    const sourceLabel =
      status.authSource === 'explicit'
        ? 'via --api-key'
        : status.authSource === 'env'
          ? 'via FIRECRAWL_API_KEY'
          : 'via stored credentials';
    console.log(
      `  ${fmt.success(icons.active)} Authenticated ${fmt.dim(sourceLabel)}`
    );
  } else {
    console.log(`  ${fmt.error(icons.active)} Not authenticated`);
    console.log(fmt.dim("Run 'firecrawl login' to authenticate"));
    console.log('');
    return;
  }

  console.log(`  ${colorize(colors.primary, 'API URL:')} ${status.apiUrl}`);
  console.log('');
}

/**
 * Handle job status command (the main status dashboard)
 */
export async function handleJobStatusCommand(
  container: IContainer,
  options: JobStatusOptions
): Promise<void> {
  try {
    if (options.output) {
      validateOutputPath(options.output);
    }
    const wantsJson = options.json || options.pretty || options.output;
    const filtersEcho = buildStatusFiltersEcho(options);
    const renderOptionsBase: Omit<RenderStatusOptions, 'changedKeys'> = {
      compact: options.compact ?? false,
      wide: options.wide ?? false,
      filtersEcho,
    };

    if (options.watch && wantsJson) {
      console.warn(
        fmt.warning(
          'Warning: --watch is ignored when --json, --pretty, or --output is set. Producing a single snapshot.'
        )
      );
    }

    // Clean up old completed/failed embed jobs once per session (not per poll cycle)
    await cleanupOldJobs(1);

    if (options.watch && !wantsJson) {
      const intervalSeconds =
        typeof options.intervalSeconds === 'number' &&
        Number.isFinite(options.intervalSeconds)
          ? options.intervalSeconds
          : 3;
      const intervalMs = Math.max(1000, intervalSeconds * 1000);
      let previousSnapshot: Map<string, string> | null = null;
      let running = true;

      const onSigint = () => {
        running = false;
      };
      process.on('SIGINT', onSigint);

      try {
        while (running) {
          const data = await executeJobStatus(container, options);
          const nextSnapshot = new Map<string, string>();
          for (const crawl of data.activeCrawls.crawls) {
            nextSnapshot.set(`active:${crawl.id}`, 'active');
          }
          for (const crawl of data.crawls) {
            if (crawl.id && crawl.status)
              nextSnapshot.set(`crawl:${crawl.id}`, crawl.status);
          }
          for (const batch of data.batches) {
            if (batch.id && batch.status)
              nextSnapshot.set(`batch:${batch.id}`, batch.status);
          }
          for (const extract of data.extracts) {
            if (extract.id && extract.status) {
              nextSnapshot.set(`extract:${extract.id}`, extract.status);
            }
          }
          for (const job of data.embeddings.pending) {
            nextSnapshot.set(`embed:${job.jobId}`, 'pending');
          }
          for (const job of data.embeddings.failed) {
            nextSnapshot.set(`embed:${job.jobId}`, 'failed');
          }
          for (const job of data.embeddings.completed) {
            nextSnapshot.set(`embed:${job.jobId}`, 'completed');
          }
          const changedKeys = computeChangedKeys(
            previousSnapshot,
            nextSnapshot
          );
          if (process.stdout.isTTY) {
            process.stdout.write('\x1bc');
          }
          renderHumanStatus(data, { ...renderOptionsBase, changedKeys });
          previousSnapshot = nextSnapshot;

          if (!running) break;
          await new Promise<void>((resolve) => {
            const earlyExit = () => {
              running = false;
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(() => {
              process.removeListener('SIGINT', earlyExit);
              resolve();
            }, intervalMs);
            process.once('SIGINT', earlyExit);
          });
        }
      } finally {
        process.removeListener('SIGINT', onSigint);
      }
      return;
    }

    const data = await executeJobStatus(container, options);
    if (!wantsJson) {
      renderHumanStatus(data, { ...renderOptionsBase, changedKeys: new Set() });
      return;
    }

    const { embeddings, ...rest } = data;
    const { completed: _completed, ...embeddingsWithoutCompleted } = embeddings;
    const outputContent = formatJson(
      {
        success: true,
        data: {
          ...rest,
          embeddings: embeddingsWithoutCompleted,
        },
      },
      options.pretty ?? false
    );
    await writeCommandOutput(outputContent, options);
  } catch (error) {
    console.error(
      fmt.error(error instanceof Error ? error.message : String(error))
    );
    process.exitCode = 1;
  }
}

/**
 * Creates the status CLI command
 */
export function createStatusCommand(): Command {
  const statusCmd = new Command('status')
    .description('Show active jobs and embedding queue status')
    .option('-k, --api-key <key>', 'Firecrawl API key override')
    .option('--clear', 'Clear job history cache', false)
    .option('--compact', 'Compact one-line rows', false)
    .option('--wide', 'Show extra columns (domain/queue lag)', false)
    .option('--watch', 'Refresh continuously and highlight changes', false)
    .option(
      '--interval <seconds>',
      'Refresh interval in seconds for --watch mode',
      (value) => Number.parseInt(value, 10),
      3
    )
    .option('--crawl <ids>', 'Filter by crawl job IDs (comma-separated)')
    .option('--batch <ids>', 'Filter by batch job IDs (comma-separated)')
    .option('--extract <ids>', 'Filter by extract job IDs (comma-separated)')
    .option(
      '--embed [id]',
      'Show embed queue status, optionally filter by job ID'
    )
    .option('--json', 'Output JSON (compact)', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .action(async (options, command: Command) => {
      const container = requireContainer(command);

      if (options.clear) {
        await clearJobHistory();
        console.log('');
        console.log(`  ${fmt.success(icons.success)} Job history cleared`);
        console.log('');
        return;
      }

      await handleJobStatusCommand(container, {
        apiKey: options.apiKey,
        crawl: options.crawl,
        batch: options.batch,
        extract: options.extract,
        embed: options.embed,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
        compact: options.compact,
        wide: options.wide,
        watch: options.watch,
        intervalSeconds: options.interval,
      });
    });

  return statusCmd;
}
