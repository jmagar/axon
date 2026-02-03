/**
 * Info command implementation
 * Shows detailed information for a specific URL including metadata and chunk listings
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type { InfoOptions, InfoResult, UrlInfo } from '../types/info';
import { formatJson, handleCommandError } from '../utils/command';
import { validateOutputPath, writeOutput } from '../utils/output';
import { normalizeUrl } from '../utils/url';

/**
 * Execute info command
 * Retrieves all chunks for a URL and returns detailed metadata
 *
 * @param container DI container with services
 * @param options Info options with URL and filters
 * @returns InfoResult with URL details or error
 */
export async function executeInfo(
  container: IContainer,
  options: InfoOptions
): Promise<InfoResult> {
  try {
    const config = container.config;
    const qdrantUrl = config.qdrantUrl;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl';

    if (!qdrantUrl) {
      return {
        success: false,
        error: 'QDRANT_URL must be set in .env for the info command.',
      };
    }

    const qdrantService = container.getQdrantService();

    // Get all chunks for this URL
    const points = await qdrantService.scrollByUrl(collection, options.url);

    if (points.length === 0) {
      return {
        success: false,
        error: `URL not found in vector database: ${options.url}`,
      };
    }

    // Extract metadata from first point (should be consistent across chunks)
    const firstPoint = points[0];
    const payload = firstPoint.payload;

    // Map chunks with preview/full text
    const chunks = points.map((point) => {
      const text = String(point.payload.chunk_text || '');
      const textPreview =
        options.full || text.length <= 100 ? text : `${text.slice(0, 100)}...`;

      return {
        index: Number(point.payload.chunk_index || 0),
        header: point.payload.chunk_header
          ? String(point.payload.chunk_header)
          : null,
        textPreview,
      };
    });

    // Sort chunks by index
    chunks.sort((a, b) => a.index - b.index);

    const urlInfo: UrlInfo = {
      url: String(payload.url || ''),
      domain: String(payload.domain || ''),
      title: String(payload.title || ''),
      totalChunks: Number(payload.total_chunks || points.length),
      sourceCommand: String(payload.source_command || ''),
      contentType: String(payload.content_type || ''),
      scrapedAt: String(payload.scraped_at || ''),
      chunks,
    };

    return {
      success: true,
      data: urlInfo,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Format info result for human-readable output
 *
 * @param info URL info data to format
 * @param full Whether to show full chunk text
 * @returns Formatted string output
 */
function formatHuman(info: UrlInfo, _full: boolean): string {
  const data = info;
  const lines: string[] = [];

  lines.push('\n=== URL Information ===\n');
  lines.push(`URL:          ${data.url}`);
  lines.push(`Domain:       ${data.domain}`);
  lines.push(`Title:        ${data.title}`);
  lines.push(`Source:       ${data.sourceCommand}`);
  lines.push(`Content Type: ${data.contentType}`);
  lines.push(`Scraped At:   ${data.scrapedAt}`);
  lines.push(`Total Chunks: ${data.totalChunks}`);

  lines.push('\n=== Chunks ===\n');

  for (const chunk of data.chunks) {
    lines.push(`[${chunk.index}] ${chunk.header || '(no header)'}`);
    lines.push(`    ${chunk.textPreview.replace(/\n/g, '\n    ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Handle info command execution
 * Wrapper for Commander.js integration
 *
 * @param container DI container with services
 * @param options Info options from CLI
 */
async function handleInfoCommand(
  container: IContainer,
  options: InfoOptions
): Promise<void> {
  const result = await executeInfo(container, options);

  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) return;

  if (options.output) {
    validateOutputPath(options.output);
  }

  let outputContent: string;

  if (options.json) {
    outputContent = formatJson({ success: true, data: result.data });
  } else {
    outputContent = formatHuman(result.data, !!options.full);
  }

  writeOutput(outputContent, options.output, !!options.output);
}

/**
 * Create info command for Commander.js
 *
 * @returns Commander Command instance
 */
export function createInfoCommand(): Command {
  const infoCmd = new Command('info')
    .description('Show detailed information for a specific URL')
    .argument('<url>', 'URL to get information for')
    .option(
      '-f, --full',
      'Show full chunk text (default: false, 100 char preview)',
      false
    )
    .option(
      '-c, --collection <name>',
      'Qdrant collection name (default: firecrawl)',
      'firecrawl'
    )
    .option('-o, --output <file>', 'Write output to file (default: stdout)')
    .option('--json', 'Output as JSON (default: false)', false)
    .action(async (url: string, options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      await handleInfoCommand(container, {
        url: normalizeUrl(url),
        full: options.full,
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return infoCmd;
}
