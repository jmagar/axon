/**
 * Embed command implementation
 * Embeds content from URL, file, or stdin into Qdrant via TEI
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import type { IContainer } from '../container/types';
import type { EmbedOptions, EmbedResult } from '../types/embed';
import { chunkText } from '../utils/chunker';
import { formatJson, handleCommandError } from '../utils/command';
import { writeOutput } from '../utils/output';
import { isUrl } from '../utils/url';

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
    const config = container.config;
    const teiUrl = config.teiUrl;
    const qdrantUrl = config.qdrantUrl;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl';

    if (!teiUrl || !qdrantUrl) {
      return {
        success: false,
        error:
          'TEI_URL and QDRANT_URL must be set in .env for the embed command.',
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
  const result = await executeEmbed(container, options);

  // Use shared error handler
  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) return;

  let outputContent: string;

  if (options.json) {
    outputContent = formatJson({
      success: true,
      data: result.data,
    });
  } else {
    outputContent = `Embedded ${result.data.chunksEmbedded} chunks for ${result.data.url} into ${result.data.collection}`;
  }

  writeOutput(outputContent, options.output, !!options.output);
}

import { Command } from 'commander';
import { ensureAuthenticated } from '../utils/auth';
import { getEmbedJob, removeEmbedJob } from '../utils/embed-queue';
import { normalizeUrl } from '../utils/url';

/**
 * Handle embed cancel command
 */
async function handleCancelCommand(
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  const job = getEmbedJob(jobId);

  if (!job) {
    return {
      success: false,
      error: `Embed job ${jobId} not found`,
    };
  }

  removeEmbedJob(jobId);
  console.log(`Cancelled embed job ${jobId}`);
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
    .option('--json', 'Output as JSON format (default: false)', false)
    .action(async (input: string | undefined, options, command: Command) => {
      // If no input provided and no subcommand, show help
      if (!input) {
        command.help();
        return;
      }

      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      // Normalize URL input (but not file paths or stdin "-")
      const normalizedInput = isUrl(input) ? normalizeUrl(input) : input;

      // Conditionally require auth only for URL input
      if (
        normalizedInput.startsWith('http://') ||
        normalizedInput.startsWith('https://')
      ) {
        await ensureAuthenticated();
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
      const result = await handleCancelCommand(jobId);
      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }
    });

  return embedCmd;
}
