/**
 * Retrieve command implementation
 * Reconstructs full documents from Qdrant chunks
 */

import type { IContainer } from '../container/types';
import type { RetrieveOptions, RetrieveResult } from '../types/retrieve';
import { formatJson, handleCommandError } from '../utils/command';
import { writeOutput } from '../utils/output';
import { scrollByUrl } from '../utils/qdrant';

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
    const config = container.config;
    const qdrantUrl = config.qdrantUrl;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl_collection';

    if (!qdrantUrl) {
      return {
        success: false,
        error: 'QDRANT_URL must be set in .env for the retrieve command.',
      };
    }

    const points = await scrollByUrl(qdrantUrl, collection, options.url);

    if (points.length === 0) {
      return {
        success: false,
        error: `No content found for URL: ${options.url}`,
      };
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
  const result = await executeRetrieve(container, options);

  // Use shared error handler
  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) return;

  let outputContent: string;

  if (options.json) {
    outputContent = formatJson({
      success: true,
      data: {
        url: result.data.url,
        totalChunks: result.data.totalChunks,
        chunks: result.data.chunks,
      },
    });
  } else {
    // Default: raw document content
    outputContent = result.data.content;
  }

  writeOutput(outputContent, options.output, !!options.output);
}

import { Command } from 'commander';
import { normalizeUrl } from '../utils/url';

/**
 * Create and configure the retrieve command
 */
export function createRetrieveCommand(): Command {
  const retrieveCmd = new Command('retrieve')
    .description('Retrieve full document from Qdrant by URL')
    .argument('<url>', 'URL of the document to retrieve')
    .option('--collection <name>', 'Qdrant collection name')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (url: string, options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      await handleRetrieveCommand(container, {
        url: normalizeUrl(url),
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return retrieveCmd;
}
