/**
 * Scrape command implementation
 */

import type { FormatOption } from '@mendable/firecrawl-js';
import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type {
  ScrapeFormat,
  ScrapeOptions,
  ScrapeResult,
} from '../types/scrape';
import { displayCommandInfo } from '../utils/display';
import { parseScrapeOptions } from '../utils/options';
import { handleScrapeOutput } from '../utils/output';
import { fmt, icons } from '../utils/theme';
import { normalizeUrl } from '../utils/url';
import { requireContainer } from './shared';

/**
 * Output timing information if requested
 */
function outputTiming(
  options: ScrapeOptions,
  requestStartTime: number,
  requestEndTime: number,
  error?: Error | unknown
): void {
  if (!options.timing) return;

  const requestDuration = requestEndTime - requestStartTime;
  const timingInfo: {
    url: string;
    requestTime: string;
    duration: string;
    status: 'success' | 'error';
    error?: string;
  } = {
    url: options.url,
    requestTime: new Date(requestStartTime).toISOString(),
    duration: `${requestDuration}ms`,
    status: error ? 'error' : 'success',
  };

  if (error) {
    timingInfo.error = error instanceof Error ? error.message : 'Unknown error';
  }

  console.error(`${fmt.dim('Timing:')} ${JSON.stringify(timingInfo, null, 2)}`);
}

/**
 * Execute the scrape command
 */
export async function executeScrape(
  container: IContainer,
  options: ScrapeOptions
): Promise<ScrapeResult> {
  // Handle --remove flag (delete from Qdrant, skip scraping)
  if (options.remove) {
    const { qdrantUrl, qdrantCollection } = container.config;

    if (!qdrantUrl) {
      return {
        success: false,
        error: 'QDRANT_URL not configured. Set QDRANT_URL to use --remove.',
      };
    }

    // Parse domain from URL with error handling
    let domain: string;
    try {
      domain = new URL(options.url).hostname;
    } catch {
      return {
        success: false,
        error: `Invalid URL: ${options.url}`,
      };
    }

    const collection = qdrantCollection || 'firecrawl';

    try {
      const qdrantService = container.getQdrantService();
      const count = await qdrantService.countByDomain(collection, domain);
      await qdrantService.deleteByDomain(collection, domain);

      return { success: true, removed: count };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove domain from Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Get client instance from container
  const app = container.getFirecrawlClient();

  // Build scrape options
  const formats: FormatOption[] = [];

  // Add requested formats
  if (options.formats && options.formats.length > 0) {
    formats.push(...options.formats);
  }

  // Add screenshot format if requested and not already included
  if (options.screenshot && !formats.includes('screenshot')) {
    formats.push('screenshot');
  }

  // If no formats specified, default to markdown
  if (formats.length === 0) {
    formats.push('markdown');
  }

  const scrapeParams: {
    formats?: FormatOption[];
    onlyMainContent?: boolean;
    waitFor?: number;
    timeout?: number;
    includeTags?: string[];
    excludeTags?: string[];
  } = {
    formats,
  };

  if (options.onlyMainContent !== undefined) {
    scrapeParams.onlyMainContent = options.onlyMainContent;
  }

  if (options.waitFor !== undefined) {
    scrapeParams.waitFor = options.waitFor;
  }

  if (options.timeout !== undefined) {
    // Convert seconds to milliseconds for the API
    scrapeParams.timeout = options.timeout * 1000;
  }

  if (options.includeTags && options.includeTags.length > 0) {
    scrapeParams.includeTags = options.includeTags;
  }

  if (options.excludeTags && options.excludeTags.length > 0) {
    scrapeParams.excludeTags = options.excludeTags;
  }

  // Execute scrape with timing - only wrap the scrape call in try-catch
  const requestStartTime = Date.now();

  try {
    const result = await app.scrape(options.url, scrapeParams);
    const requestEndTime = Date.now();
    outputTiming(options, requestStartTime, requestEndTime);

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    const requestEndTime = Date.now();
    outputTiming(options, requestStartTime, requestEndTime, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Handle scrape command output
 */
export async function handleScrapeCommand(
  container: IContainer,
  options: ScrapeOptions
): Promise<void> {
  // Handle --remove flag with early return
  if (options.remove) {
    const result = await executeScrape(container, options);

    if (!result.success) {
      console.error(fmt.error(result.error || 'Unknown error'));
      process.exit(1);
    }

    // Parse domain - executeScrape already validated URL, but handle edge case
    let domain: string;
    try {
      domain = new URL(options.url).hostname;
    } catch {
      domain = options.url; // Fallback to raw URL for display
    }
    console.log(
      `${icons.success} Removed ${result.removed} documents for domain ${fmt.dim(domain)}`
    );
    return;
  }

  // Display command info
  displayCommandInfo('Scraping', options.url, {
    formats: options.formats,
    onlyMainContent: options.onlyMainContent,
    excludeTags: options.excludeTags,
    includeTags: options.includeTags,
    timeout: options.timeout,
    waitFor: options.waitFor,
  });

  const result = await executeScrape(container, options);

  // Start embedding concurrently with output
  const embedPromise =
    options.embed !== false && result.success && result.data
      ? (async () => {
          const pipeline = container.getEmbedPipeline();
          const data = result.data;
          if (data) {
            const content = data.markdown || data.html || data.rawHtml || '';
            await pipeline.autoEmbed(content, {
              url: options.url,
              title: data.metadata?.title,
              sourceCommand: 'scrape',
              contentType: options.formats?.[0] || 'markdown',
            });
          }
        })()
      : Promise.resolve();

  // Determine effective formats for output handling
  const effectiveFormats: ScrapeFormat[] =
    options.formats && options.formats.length > 0
      ? [...options.formats]
      : ['markdown'];

  // Add screenshot to effective formats if it was requested separately
  if (options.screenshot && !effectiveFormats.includes('screenshot')) {
    effectiveFormats.push('screenshot');
  }

  handleScrapeOutput(
    result,
    effectiveFormats,
    options.output,
    options.pretty,
    options.json
  );

  // Wait for embedding to complete
  await embedPromise;
}

/**
 * Create and configure the scrape command
 */
export function createScrapeCommand(): Command {
  const scrapeCmd = new Command('scrape')
    .description('Scrape a URL using Firecrawl')
    .argument('[url]', 'URL to scrape')
    .argument(
      '[formats...]',
      'Output format(s) as positional args (e.g., markdown screenshot links)'
    )
    .option(
      '-u, --url <url>',
      'URL to scrape (alternative to positional argument)'
    )
    .option('-H, --html', 'Output raw HTML (shortcut for --format html)')
    .option(
      '-f, --format <formats>',
      'Output format(s). Multiple formats can be specified with commas (e.g., "markdown,links,images"). Available: markdown, html, rawHtml, links, images, screenshot, summary, changeTracking, json, attributes, branding. Single format outputs raw content; multiple formats output JSON.'
    )
    .option('--only-main-content', 'Include only main content', true)
    .option('--no-only-main-content', 'Include full page content')
    .option(
      '--wait-for <ms>',
      'Wait time before scraping in milliseconds',
      parseInt
    )
    .option('--timeout <seconds>', 'Request timeout in seconds', parseFloat, 15)
    .option('--screenshot', 'Take a screenshot', false)
    .option('--include-tags <tags>', 'Comma-separated list of tags to include')
    .option(
      '--exclude-tags <tags>',
      'Comma-separated list of tags to exclude',
      'nav,footer'
    )
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option(
      '--timing',
      'Show request timing and other useful information',
      false
    )
    .option('--no-embed', 'Skip auto-embedding of scraped content')
    .option(
      '--remove',
      'Remove all documents for this domain from Qdrant',
      false
    )
    .action(
      async (positionalUrl, positionalFormats, options, command: Command) => {
        const container = requireContainer(command);

        // Use positional URL if provided, otherwise use --url option
        const url = positionalUrl || options.url;
        if (!url) {
          console.error(
            fmt.error(
              'URL is required. Provide it as argument or use --url option.'
            )
          );
          process.exit(1);
        }

        // Merge formats: positional formats take precedence, then --format flag, then default to markdown
        let format: string;
        if (positionalFormats && positionalFormats.length > 0) {
          // Positional formats: join them with commas for parseFormats
          format = positionalFormats.join(',');
        } else if (options.html) {
          // Handle --html shortcut flag
          format = 'html';
        } else if (options.format) {
          // Use --format option
          format = options.format;
        } else {
          // Default to markdown
          format = 'markdown';
        }

        const scrapeOptions = parseScrapeOptions({
          ...options,
          url: normalizeUrl(url),
          format,
        });
        await handleScrapeCommand(container, scrapeOptions);
      }
    );

  return scrapeCmd;
}
