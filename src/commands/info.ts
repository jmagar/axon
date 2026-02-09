/**
 * Info command implementation
 * Shows detailed information for a specific URL including metadata and chunk listings
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type { InfoOptions, InfoResult, UrlInfo } from '../types/info';
import { processCommandResult } from '../utils/command';
import { parseInfoOptions } from '../utils/options';
import { fmt, icons } from '../utils/theme';
import { normalizeUrl } from '../utils/url';
import {
  getQdrantUrlError,
  requireContainer,
  resolveCollectionName,
} from './shared';

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
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    if (!qdrantUrl) {
      return {
        success: false,
        error: getQdrantUrlError('info'),
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

  lines.push(`  ${fmt.primary('URL information')}`);
  lines.push(`    ${fmt.dim('URL:')} ${data.url}`);
  lines.push(`    ${fmt.dim('Domain:')} ${data.domain}`);
  lines.push(`    ${fmt.dim('Title:')} ${data.title}`);
  lines.push(`    ${fmt.dim('Source:')} ${data.sourceCommand}`);
  lines.push(`    ${fmt.dim('Content type:')} ${data.contentType}`);
  lines.push(`    ${fmt.dim('Scraped at:')} ${data.scrapedAt}`);
  lines.push(`    ${fmt.dim('Total chunks:')} ${data.totalChunks}`);

  lines.push('');
  lines.push(`  ${fmt.primary('Chunks')}`);

  for (const chunk of data.chunks) {
    lines.push(
      `    ${fmt.info(icons.bullet)} [${chunk.index}] ${chunk.header || '(no header)'}`
    );
    lines.push(`      ${chunk.textPreview.replace(/\n/g, '\n      ')}`);
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
  processCommandResult(
    await executeInfo(container, options),
    options,
    (resultData) => formatHuman(resultData, !!options.full)
  );
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
    .option('--json', 'Output as JSON', false)
    .action(async (url: string, options, command: Command) => {
      const container = requireContainer(command);
      const parsedOptions = parseInfoOptions(normalizeUrl(url), options);

      await handleInfoCommand(container, parsedOptions);
    });

  return infoCmd;
}
