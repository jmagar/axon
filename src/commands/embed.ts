/**
 * Embed command implementation
 * Embeds content from URL, file, or stdin into Qdrant via TEI
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import type { IContainer } from '../container/types';
import type { EmbedOptions, EmbedResult } from '../types/embed';
import { chunkText } from '../utils/chunker';
import {
  formatJson,
  handleCommandError,
  processCommandResult,
  shouldOutputJson,
  writeCommandOutput,
} from '../utils/command';
import {
  buildFiltersEcho,
  CANONICAL_EMPTY_STATE,
  formatHeaderBlock,
} from '../utils/style-output';
import { fmt, icons } from '../utils/theme';
import { isUrl } from '../utils/url';
import {
  requireContainer,
  resolveCollectionName,
  validateEmbeddingUrls,
} from './shared';

/**
 * Read stdin as a string
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Execute embed command
 */
export async function executeEmbed(
  container: IContainer,
  options: EmbedOptions
): Promise<EmbedResult> {
  try {
    const teiUrl = container.config.teiUrl;
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    const validation = validateEmbeddingUrls(teiUrl, qdrantUrl, 'embed');
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    let content: string;
    let url: string;
    let title: string | undefined;

    if (options.input === '-') {
      // Stdin mode
      if (!options.url) {
        return {
          success: false,
          error: '--url is required when reading from stdin.',
        };
      }
      content = await readStdin();
      url = options.url;
    } else if (isUrl(options.input)) {
      // URL mode -- scrape first
      const app = container.getFirecrawlClient();
      const result = await app.scrape(options.input, {
        formats: ['markdown'],
      });
      content = result.markdown || '';
      url = options.input;
      title = result.metadata?.title;
    } else if (fs.existsSync(options.input)) {
      // File mode
      if (!options.url) {
        return {
          success: false,
          error: '--url is required when embedding a file.',
        };
      }
      content = fs.readFileSync(options.input, 'utf-8');
      url = options.url;
    } else {
      return {
        success: false,
        error: `Input "${options.input}" is not a valid URL, file, or "-" for stdin.`,
      };
    }

    const trimmed = content.trim();
    if (!trimmed) {
      return {
        success: false,
        error: 'No content to embed.',
      };
    }

    // Get services from container
    const teiService = container.getTeiService();
    const qdrantService = container.getQdrantService();

    // Get TEI dimension
    const teiInfo = await teiService.getTeiInfo();

    // Ensure collection exists
    await qdrantService.ensureCollection(collection, teiInfo.dimension);

    // Chunk content
    const chunks = options.noChunk
      ? [{ text: trimmed, index: 0, header: null }]
      : chunkText(trimmed);

    if (chunks.length === 0) {
      return {
        success: false,
        error: 'Content produced no chunks after processing.',
      };
    }

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const vectors = await teiService.embedChunks(texts);

    // Delete old vectors then upsert new ones
    await qdrantService.deleteByUrl(collection, url);

    const now = new Date().toISOString();
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = 'unknown';
    }

    const points = chunks.map((chunk, i) => ({
      id: randomUUID(),
      vector: vectors[i],
      payload: {
        url,
        title: title || '',
        domain,
        chunk_index: chunk.index,
        chunk_text: chunk.text,
        chunk_header: chunk.header,
        total_chunks: chunks.length,
        source_command: 'embed',
        content_type: 'text',
        scraped_at: now,
      },
    }));

    await qdrantService.upsertPoints(collection, points);

    return {
      success: true,
      data: {
        url,
        chunksEmbedded: chunks.length,
        collection,
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
 * Handle embed command output
 */
export async function handleEmbedCommand(
  container: IContainer,
  options: EmbedOptions
): Promise<void> {
  await processCommandResult(
    await executeEmbed(container, options),
    options,
    (data) =>
      [
        ...formatHeaderBlock({
          title: 'Embed Result',
          summary: `Chunks embedded: ${data.chunksEmbedded} | Collection: ${data.collection}`,
          filters: buildFiltersEcho([
            ['collection', options.collection],
            ['noChunk', options.noChunk],
          ]),
        }),
        `${icons.success} Embedded ${data.chunksEmbedded} chunks`,
        `URL: ${data.url}`,
        `Collection: ${data.collection}`,
      ].join('\n')
  );
}

import { Command } from 'commander';
import { createContainerWithOverride } from '../container/ContainerFactory';
import { ensureAuthenticated } from '../utils/auth';
import { loadCredentials } from '../utils/credentials';
import {
  cleanupEmbedQueue,
  clearEmbedQueue,
  getEmbedJob,
  removeEmbedJob,
} from '../utils/embed-queue';
import { normalizeUrl } from '../utils/url';

/**
 * Handle embed cancel command
 */
async function handleCancelCommand(
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  const job = await getEmbedJob(jobId);

  if (!job) {
    return {
      success: false,
      error: `Embed job ${jobId} not found`,
    };
  }

  await removeEmbedJob(jobId);
  console.log(`${icons.success} Cancelled embed job ${fmt.dim(jobId)}`);
  return { success: true };
}

async function handleClearCommand(): Promise<{
  success: boolean;
  removed?: number;
  error?: string;
}> {
  try {
    const removed = await clearEmbedQueue();
    console.log(
      `${icons.success} Cleared ${removed} embedding job${removed === 1 ? '' : 's'}`
    );
    return { success: true, removed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleCleanupCommand(): Promise<{
  success: boolean;
  removed?: number;
  error?: string;
}> {
  try {
    const result = await cleanupEmbedQueue();
    console.log(
      `${icons.success} Cleanup removed ${result.removedTotal} embedding job${result.removedTotal === 1 ? '' : 's'} ${fmt.dim(`(failed: ${result.removedFailed}, stale pending: ${result.removedStalePending}, stale processing: ${result.removedStaleProcessing})`)}`
    );
    return { success: true, removed: result.removedTotal };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleStatusCommand(
  jobId: string,
  options: { output?: string; json?: boolean; pretty?: boolean }
): Promise<{ success: boolean; error?: string }> {
  const job = await getEmbedJob(jobId);
  if (!job) {
    return {
      success: false,
      error: `Embed job ${jobId} not found`,
    };
  }

  const useJson = shouldOutputJson(options) || Boolean(options.output);
  if (useJson) {
    await writeCommandOutput(
      formatJson({ success: true, data: job }, options.pretty),
      options
    );
    return { success: true };
  }

  const progress =
    job.totalDocuments !== undefined && job.processedDocuments !== undefined
      ? `${job.processedDocuments}/${job.totalDocuments}`
      : 'n/a';

  const lines = formatHeaderBlock({
    title: `Embed Status for ${job.jobId}`,
    summary: `Status: ${job.status} | Progress: ${progress}`,
    filters: buildFiltersEcho([['jobId', job.jobId]]),
    includeFreshness: true,
  });

  if (
    job.totalDocuments !== undefined &&
    job.totalDocuments === 0 &&
    job.processedDocuments === 0
  ) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
    lines.push('');
    console.log(lines.join('\n'));
    return { success: true };
  }

  lines.push(`Job ID: ${job.jobId}`);
  lines.push(`Status: ${job.status}`);
  lines.push(`URL: ${job.url}`);
  lines.push(`Retries: ${job.retries}/${job.maxRetries}`);
  lines.push(`Progress: ${progress}`);
  if (job.lastError) {
    lines.push(`Last Error: ${job.lastError}`);
  }
  console.log(lines.join('\n'));
  return { success: true };
}

/**
 * Create and configure the embed command
 *
 * UX Pattern: Uses subcommands for actions (e.g., `embed cancel <id>`)
 * instead of option flags. This is the preferred pattern for CLI UX:
 * - Better discoverability
 * - Clear semantic intent
 * - Follows standard CLI conventions (resource action target)
 */
export function createEmbedCommand(): Command {
  const embedCmd = new Command('embed').description(
    'Embed content into Qdrant vector database'
  );

  // Default embed action (when no subcommand is used)
  embedCmd
    .argument('[input]', 'URL to scrape and embed, file path, or "-" for stdin')
    .option(
      '--url <url>',
      'Explicit URL for metadata (required for file/stdin)'
    )
    .option(
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
    .option(
      '--no-chunk',
      'Disable chunking, embed as single vector (default: false)',
      false
    )
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (input: string | undefined, options, command: Command) => {
      // If no input provided and no subcommand, show help
      if (!input) {
        command.help();
        return;
      }

      let container = requireContainer(command);

      // Normalize URL input (but not file paths or stdin "-")
      const normalizedInput = isUrl(input) ? normalizeUrl(input) : input;

      // Conditionally require auth only for URL input
      if (
        normalizedInput.startsWith('http://') ||
        normalizedInput.startsWith('https://')
      ) {
        const apiKey = await ensureAuthenticated(container.config.apiKey);
        if (apiKey !== container.config.apiKey) {
          const storedCredentials = loadCredentials();
          container = createContainerWithOverride(container, {
            apiKey,
            apiUrl: storedCredentials?.apiUrl ?? container.config.apiUrl,
          });
        }
      }

      await handleEmbedCommand(container, {
        input: normalizedInput,
        url: options.url,
        collection: options.collection,
        noChunk: !options.chunk,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
      });
    });

  // Add cancel subcommand
  embedCmd
    .command('cancel')
    .description('Cancel a pending embedding job')
    .argument('<job-id>', 'Job ID to cancel')
    .action(async (jobId: string) => {
      handleCommandError(await handleCancelCommand(jobId));
    });

  embedCmd
    .command('clear')
    .description('Clear the entire embedding queue')
    .action(async () => {
      handleCommandError(await handleClearCommand());
    });

  embedCmd
    .command('cleanup')
    .description('Cleanup failed and stale/stalled embedding jobs')
    .action(async () => {
      handleCommandError(await handleCleanupCommand());
    });

  embedCmd
    .command('status')
    .description('Get embedding job status by ID')
    .argument('<job-id>', 'Embedding job ID')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options) => {
      handleCommandError(
        await handleStatusCommand(jobId, {
          output: options.output,
          json: options.json,
          pretty: options.pretty,
        })
      );
    });

  return embedCmd;
}
