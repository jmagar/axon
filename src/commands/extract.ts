/**
 * Extract command implementation
 */

import type { ExtractOptions, ExtractResult } from '../types/extract';
import { getClient } from '../utils/client';
import { formatJson, handleCommandError } from '../utils/command';
import { batchEmbed, type EmbedItem } from '../utils/embedpipeline';
import { recordJob } from '../utils/job-history';
import { writeOutput } from '../utils/output';

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
  options: ExtractOptions
): Promise<ExtractResult> {
  try {
    const app = getClient({ apiKey: options.apiKey });

    if (options.status && options.jobId) {
      const status = await app.getExtractStatus(options.jobId);

      if (status.error) {
        return { success: false, error: status.error };
      }

      recordJob('extract', options.jobId);

      return {
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
    }

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
  options: ExtractOptions
): Promise<void> {
  const result = await executeExtract(options);

  // Use shared error handler
  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) return;

  if (options.status) {
    const outputContent = formatJson(
      { success: true, data: result.data },
      options.pretty
    );
    writeOutput(outputContent, options.output, !!options.output);
    return;
  }

  // Determine embed targets: prefer sources, fallback to input URLs
  const embedTargets =
    Array.isArray(result.data.sources) && result.data.sources.length > 0
      ? result.data.sources
      : options.urls;

  // Build embed items for batch embedding
  // Extract command embeds the extracted data (not markdown/html)
  if (options.embed !== false) {
    const extractedText = extractionToText(result.data.extracted);
    const embedItems: EmbedItem[] = embedTargets.map((targetUrl) => ({
      content: extractedText,
      metadata: {
        url: targetUrl,
        sourceCommand: 'extract',
        contentType: 'extracted',
      },
    }));
    await batchEmbed(embedItems);
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
 * Create and configure the extract command
 */
export function createExtractCommand(): Command {
  const extractCmd = new Command('extract')
    .description('Extract structured data from URLs using Firecrawl')
    .argument(
      '[urls-or-job-id...]',
      'URL(s) to extract from or a job ID for status'
    )
    .option('--status', 'Get extract job status by ID', false)
    .option('--prompt <prompt>', 'Extraction prompt describing what to extract')
    .option('--schema <json>', 'JSON schema for structured extraction')
    .option('--system-prompt <prompt>', 'System prompt for extraction context')
    .option('--allow-external-links', 'Allow following external links', false)
    .option(
      '--enable-web-search',
      'Enable web search for additional context',
      false
    )
    .option('--include-subdomains', 'Include subdomains when extracting', false)
    .option('--show-sources', 'Include source URLs in result', false)
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('--no-embed', 'Disable auto-embedding of extracted content')
    .action(async (rawUrls: string[], options) => {
      if (options.status) {
        const jobId = rawUrls?.[0];
        if (!jobId) {
          console.error('Error: job ID is required for --status');
          process.exit(1);
        }

        await handleExtractCommand({
          status: true,
          jobId,
          urls: [],
          apiKey: options.apiKey,
          output: options.output,
          json: true,
          pretty: options.pretty,
          embed: false,
        });
        return;
      }

      // Flatten URLs that may contain newlines (e.g. zsh doesn't word-split variables)
      const urls = rawUrls
        .flatMap((u) =>
          u.includes('\n') ? u.split('\n').filter(Boolean) : [u]
        )
        .map(normalizeUrl);
      await handleExtractCommand({
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

  return extractCmd;
}
