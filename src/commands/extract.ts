/**
 * Extract command implementation
 */

import pLimit from 'p-limit';
import type { IContainer } from '../container/types';
import type { ExtractOptions, ExtractResult } from '../types/extract';
import { formatJson, handleCommandError } from '../utils/command';
import { normalizeJobId } from '../utils/job';
import { recordJob } from '../utils/job-history';
import { writeOutput } from '../utils/output';
import { fmt } from '../utils/theme';

/**
 * Maximum concurrent embedding operations to prevent resource exhaustion
 */
const MAX_CONCURRENT_EMBEDS = 10;

/**
 * Convert extracted data to human-readable text for embedding
 */
function extractionToText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return '';

  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');
  }

  return String(data);
}

type ExtractResponse = {
  success?: boolean;
  data?: unknown;
  error?: string;
  sources?: string[];
  warning?: string;
};

/**
 * Execute extract command
 */
export async function executeExtract(
  container: IContainer,
  options: ExtractOptions
): Promise<ExtractResult> {
  try {
    const app = container.getFirecrawlClient();

    // Build single-arg object for new Firecrawl SDK extract()
    const extractArgs: Record<string, unknown> = {
      urls: options.urls,
      ignoreInvalidURLs: true,
    };

    if (options.prompt) {
      extractArgs.prompt = options.prompt;
    }

    if (options.schema) {
      try {
        extractArgs.schema = JSON.parse(options.schema);
      } catch {
        return {
          success: false,
          error: 'Invalid JSON schema. Provide valid JSON string.',
        };
      }
    }

    if (options.systemPrompt) {
      extractArgs.systemPrompt = options.systemPrompt;
    }
    if (options.allowExternalLinks !== undefined) {
      extractArgs.allowExternalLinks = options.allowExternalLinks;
    }
    if (options.enableWebSearch !== undefined) {
      extractArgs.enableWebSearch = options.enableWebSearch;
    }
    if (options.includeSubdomains !== undefined) {
      extractArgs.includeSubdomains = options.includeSubdomains;
    }
    if (options.showSources !== undefined) {
      extractArgs.showSources = options.showSources;
    }

    const result = (await app.extract(extractArgs)) as ExtractResponse;

    if ('error' in result && !result.success) {
      return {
        success: false,
        error: result.error || 'Extraction failed',
      };
    }

    if ((result as { id?: string }).id) {
      recordJob('extract', (result as { id?: string }).id as string);
    }

    return {
      success: true,
      data: {
        extracted: result.data,
        sources: result.sources,
        warning: result.warning,
      },
    };
  } catch (error: unknown) {
    let message =
      error instanceof Error ? error.message : 'Unknown error occurred';

    // Surface validation details from Firecrawl SDK errors
    const details = (error as { details?: unknown })?.details;
    if (Array.isArray(details)) {
      const msgs = details
        .map((d: { message?: string }) => d.message)
        .filter(Boolean);
      if (msgs.length > 0) {
        message += `: ${msgs.join('; ')}`;
      }
    }

    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Handle extract command output
 */
export async function handleExtractCommand(
  container: IContainer,
  options: ExtractOptions
): Promise<void> {
  const result = await executeExtract(container, options);

  // Use shared error handler
  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) return;

  // Determine embed targets: prefer sources, fallback to input URLs
  const embedTargets =
    Array.isArray(result.data.sources) && result.data.sources.length > 0
      ? result.data.sources
      : options.urls;

  // Auto-embed extracted data for each target URL
  // Extract command embeds the extracted data (not markdown/html)
  if (options.embed !== false) {
    const pipeline = container.getEmbedPipeline();
    const extractedText = extractionToText(result.data.extracted);

    // Use p-limit for concurrency control
    const limit = pLimit(MAX_CONCURRENT_EMBEDS);
    const embedTasks = embedTargets.map((targetUrl) =>
      limit(() =>
        pipeline.autoEmbed(extractedText, {
          url: targetUrl,
          sourceCommand: 'extract',
          contentType: 'extracted',
        })
      )
    );

    await Promise.all(embedTasks);
  }

  // Format output using shared utility
  const outputData: Record<string, unknown> = {
    success: true,
    data: result.data.extracted,
  };
  if (result.data.sources) {
    outputData.sources = result.data.sources;
  }
  if (result.data.warning) {
    outputData.warning = result.data.warning;
  }

  const outputContent = formatJson(outputData, options.pretty);
  writeOutput(outputContent, options.output, !!options.output);
}

import { Command } from 'commander';
import { normalizeUrl } from '../utils/url';

/**
 * Handle extract status command
 */
async function handleExtractStatusCommand(
  container: IContainer,
  jobId: string,
  options: { output?: string; pretty?: boolean }
): Promise<void> {
  try {
    const app = container.getFirecrawlClient();
    const status = await app.getExtractStatus(jobId);

    if (status.error) {
      console.error(fmt.error(status.error));
      process.exit(1);
    }

    recordJob('extract', jobId);

    const result = {
      success: true,
      data: {
        extracted: status.data,
        warning: status.warning,
        status: status.status,
        expiresAt: status.expiresAt,
        tokensUsed: (status as { tokensUsed?: number }).tokensUsed,
        sources: status.sources,
      },
    };

    const outputContent = formatJson(result, options.pretty);
    writeOutput(outputContent, options.output, !!options.output);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(fmt.error(message));
    process.exit(1);
  }
}

/**
 * Create and configure the extract command
 *
 * UX Pattern: Uses subcommands for actions (e.g., `extract status <job-id>`)
 * instead of option flags. This is the preferred pattern for CLI UX:
 * - Better discoverability
 * - Clear semantic intent
 * - Follows standard CLI conventions (resource action target)
 */
export function createExtractCommand(container?: IContainer): Command {
  const extractCmd = new Command('extract')
    .description('Extract structured data from URLs using Firecrawl')
    .argument('[urls...]', 'URL(s) to extract from')
    .option('--prompt <prompt>', 'Extraction prompt describing what to extract')
    .option('--schema <json>', 'JSON schema for structured extraction')
    .option('--system-prompt <prompt>', 'System prompt for extraction context')
    .option(
      '--allow-external-links',
      'Allow following external links (default: false)',
      false
    )
    .option(
      '--enable-web-search',
      'Enable web search for additional context (default: false)',
      false
    )
    .option(
      '--include-subdomains',
      'Include subdomains when extracting (default: false)',
      false
    )
    .option(
      '--show-sources',
      'Include source URLs in result (default: false)',
      false
    )
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('--no-embed', 'Disable auto-embedding of extracted content')
    .action(async (rawUrls: string[], options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      // Flatten URLs that may contain newlines (e.g. zsh doesn't word-split variables)
      const urls = rawUrls
        .flatMap((u) =>
          u.includes('\n') ? u.split('\n').filter(Boolean) : [u]
        )
        .map(normalizeUrl);

      // Validate at least one URL provided
      if (urls.length === 0) {
        console.error(fmt.error('At least one URL is required.'));
        process.exit(1);
      }

      await handleExtractCommand(container, {
        urls,
        prompt: options.prompt,
        schema: options.schema,
        systemPrompt: options.systemPrompt,
        allowExternalLinks: options.allowExternalLinks,
        enableWebSearch: options.enableWebSearch,
        includeSubdomains: options.includeSubdomains,
        showSources: options.showSources,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
        embed: options.embed,
      });
    });

  // Add status subcommand
  extractCmd
    .command('status')
    .description('Get extract job status by ID')
    .argument('<job-id>', 'Extract job ID')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options, command: Command) => {
      const container = command.parent?._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      // Normalize job ID to support both raw IDs and URLs
      const normalizedJobId = normalizeJobId(jobId);

      await handleExtractStatusCommand(container, normalizedJobId, {
        output: options.output,
        pretty: options.pretty,
      });
    });

  // Store container if provided (mainly for testing)
  if (container) {
    extractCmd._container = container;
  }

  return extractCmd;
}
