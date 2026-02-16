/**
 * Retrieve command implementation
 * Reconstructs full documents from Qdrant chunks
 */

import type { IContainer } from '../container/types';
import type { RetrieveOptions, RetrieveResult } from '../types/retrieve';
import { processCommandResult } from '../utils/command';
import { formatHeaderBlock } from '../utils/display';
import {
  CANONICAL_EMPTY_STATE,
  formatAlignedTable,
  truncateWithEllipsis,
} from '../utils/style-output';
import { fmt } from '../utils/theme';
import {
  addVectorOutputOptions,
  getQdrantUrlError,
  requireContainer,
  resolveCollectionName,
} from './shared';

/**
 * Execute retrieve command
 * Fetches all chunks for a URL from Qdrant and reassembles them into
 * a complete document with headers restored
 * @param container DI container with services
 * @param options Retrieve options including URL and optional collection
 * @returns RetrieveResult with reassembled content or error
 */
export async function executeRetrieve(
  container: IContainer,
  options: RetrieveOptions
): Promise<RetrieveResult> {
  try {
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    if (!qdrantUrl) {
      return {
        success: false,
        error: getQdrantUrlError('retrieve'),
      };
    }

    // Get Qdrant service from container
    const qdrantService = container.getQdrantService();
    let points = await qdrantService.scrollByUrl(collection, options.url);

    // If no results, try with opposite trailing slash state
    if (points.length === 0) {
      const alternateUrl = options.url.endsWith('/')
        ? options.url.slice(0, -1) // Remove trailing slash
        : `${options.url}/`; // Add trailing slash

      points = await qdrantService.scrollByUrl(collection, alternateUrl);

      // If still no results, return error
      if (points.length === 0) {
        return {
          success: false,
          error: `No content found for URL: ${options.url} (also tried ${alternateUrl})`,
        };
      }
    }

    // Reassemble document from ordered chunks (restore headers)
    let lastHeader: string | null = null;
    const content = points
      .map((p) => {
        const header =
          typeof p.payload.chunk_header === 'string'
            ? p.payload.chunk_header
            : null;
        const text =
          typeof p.payload.chunk_text === 'string' ? p.payload.chunk_text : '';
        const headerLine =
          header && header !== lastHeader ? `# ${header}\n\n` : '';
        lastHeader = header;
        return `${headerLine}${text}`;
      })
      .join('\n\n');

    const chunks = points.map((p) => ({
      index:
        typeof p.payload.chunk_index === 'number' ? p.payload.chunk_index : 0,
      header:
        typeof p.payload.chunk_header === 'string'
          ? p.payload.chunk_header
          : null,
      text:
        typeof p.payload.chunk_text === 'string' ? p.payload.chunk_text : '',
    }));

    return {
      success: true,
      data: {
        url: options.url,
        totalChunks: points.length,
        content,
        chunks,
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
 * Handle retrieve command output
 * Routes result to appropriate output format based on options
 * @param container DI container with services
 * @param options Retrieve options including output path and JSON flag
 */
export async function handleRetrieveCommand(
  container: IContainer,
  options: RetrieveOptions
): Promise<void> {
  await processCommandResult(
    await executeRetrieve(container, options),
    options,
    (data: { url: string; totalChunks: number; content: string }) => {
      if (options.output) {
        return data.content;
      }

      const lines = formatHeaderBlock({
        title: `Retrieve Result for ${data.url}`,
        summary: [
          `Chunks: ${data.totalChunks}`,
          `characters: ${data.content.length}`,
        ],
        filters: {
          collection: options.collection,
        },
      });

      lines.push(
        formatAlignedTable(
          [
            { header: 'Field', width: 14 },
            { header: 'Value', width: 90 },
          ],
          [
            ['URL', truncateWithEllipsis(data.url, 90)],
            ['Chunks', String(data.totalChunks)],
          ],
          false
        )
      );
      lines.push('');
      lines.push(`  ${fmt.primary('Content')}`);
      lines.push('');
      lines.push(
        data.content.trim().length > 0 ? data.content : CANONICAL_EMPTY_STATE
      );

      return lines.join('\n');
    }
  );
}

import { Command } from 'commander';
import { isUrl, normalizeUrl } from '../utils/url';

/**
 * Normalize retrieve input only when it is URL-like.
 * Preserves synthetic/local source IDs like "axon/docs/design/auth.md".
 */
export function normalizeRetrieveInput(input: string): string {
  return isUrl(input) ? normalizeUrl(input) : input;
}

/**
 * Create and configure the retrieve command
 */
export function createRetrieveCommand(): Command {
  const retrieveCmd = addVectorOutputOptions(
    new Command('retrieve')
      .description('Retrieve full document from Qdrant by URL')
      .argument('<url>', 'URL of the document to retrieve')
  ).action(async (url: string, options, command: Command) => {
    const container = requireContainer(command);

    await handleRetrieveCommand(container, {
      url: normalizeRetrieveInput(url),
      collection: options.collection,
      output: options.output,
      json: options.json,
    });
  });

  return retrieveCmd;
}
