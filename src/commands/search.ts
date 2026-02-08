/**
 * Search command implementation
 */

import type {
  ScrapeOptions as FirecrawlScrapeOptions,
  SearchData,
  SearchRequest,
} from '@mendable/firecrawl-js';
import pLimit from 'p-limit';
import type { IContainer } from '../container/types';
import type {
  ImageSearchResult,
  NewsSearchResult,
  SearchOptions,
  SearchResult,
  SearchResultData,
  WebSearchResult,
} from '../types/search';
import {
  formatJson,
  handleCommandError,
  writeCommandOutput,
} from '../utils/command';
import { displayCommandInfo } from '../utils/display';
import { fmt, icons } from '../utils/theme';
import { requireContainer } from './shared';

/**
 * Maximum concurrent embedding operations to prevent resource exhaustion
 */
const MAX_CONCURRENT_EMBEDS = 10;

/** Extended search request that includes additional CLI options not in the SDK type */
interface ExtendedSearchRequest extends Omit<SearchRequest, 'query'> {
  country?: string;
}

/** Extended search response that includes metadata fields from API */
interface ExtendedSearchData extends SearchData {
  warning?: string;
  id?: string;
  creditsUsed?: number;
  /** Legacy nested data format */
  data?: SearchData;
}

/**
 * Execute search command
 */
export async function executeSearch(
  container: IContainer,
  options: SearchOptions
): Promise<SearchResult> {
  try {
    const app = container.getFirecrawlClient();

    // Build search options for the SDK using extended type for additional CLI options
    const searchParams: ExtendedSearchRequest = {};

    if (options.limit !== undefined) {
      searchParams.limit = options.limit;
    }

    // Add sources if specified
    if (options.sources && options.sources.length > 0) {
      searchParams.sources = options.sources.map((source) => ({
        type: source as 'web' | 'news' | 'images',
      }));
    }

    // Add categories if specified
    if (options.categories && options.categories.length > 0) {
      searchParams.categories = options.categories.map((category) => ({
        type: category as 'github' | 'research' | 'pdf',
      }));
    }

    // Add time-based search parameter
    if (options.tbs) {
      searchParams.tbs = options.tbs;
    }

    // Add location parameter
    if (options.location) {
      searchParams.location = options.location;
    }

    // Add country parameter
    if (options.country) {
      searchParams.country = options.country;
    }

    // Add timeout parameter
    if (options.timeout !== undefined) {
      searchParams.timeout = options.timeout;
    }

    // Add ignoreInvalidURLs parameter
    if (options.ignoreInvalidUrls !== undefined) {
      searchParams.ignoreInvalidURLs = options.ignoreInvalidUrls;
    }

    // Add scrape options if scraping is enabled
    if (options.scrape) {
      const scrapeOptions: FirecrawlScrapeOptions = {};

      // Add formats
      if (options.scrapeFormats && options.scrapeFormats.length > 0) {
        scrapeOptions.formats = options.scrapeFormats.map((format) => ({
          type: format,
        }));
      } else {
        // Default to markdown if scraping is enabled but no formats specified
        scrapeOptions.formats = [{ type: 'markdown' }];
      }

      // Add onlyMainContent if specified
      if (options.onlyMainContent !== undefined) {
        scrapeOptions.onlyMainContent = options.onlyMainContent;
      }

      searchParams.scrapeOptions = scrapeOptions;
    }

    // Execute search - cast result to include extended fields from API
    const result = (await app.search(
      options.query,
      searchParams
    )) as ExtendedSearchData;

    // Handle the response - the SDK returns SearchData or legacy formats
    const data: SearchResultData = {};

    // Check if result has the expected structure
    if (result) {
      // Handle web results - check both direct and nested data formats
      if (result.web) {
        data.web = result.web as WebSearchResult[];
      } else if (result.data?.web) {
        data.web = result.data.web as WebSearchResult[];
      }

      // Handle image results - check both direct and nested data formats
      if (result.images) {
        data.images = result.images as ImageSearchResult[];
      } else if (result.data?.images) {
        data.images = result.data.images as ImageSearchResult[];
      }

      // Handle news results - check both direct and nested data formats
      if (result.news) {
        data.news = result.news as NewsSearchResult[];
      } else if (result.data?.news) {
        data.news = result.data.news as NewsSearchResult[];
      }

      // Handle legacy array response format (treat as web results)
      if (Array.isArray(result)) {
        data.web = result as unknown as WebSearchResult[];
      }
    }

    return {
      success: true,
      data,
      warning: result?.warning,
      id: result?.id,
      creditsUsed: result?.creditsUsed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format search data in human-readable way
 */
function formatSearchReadable(
  data: SearchResultData,
  _options: SearchOptions
): string {
  const lines: string[] = [];

  // Format web results
  if (data.web && data.web.length > 0) {
    lines.push(`  ${fmt.primary('Web results')}`);
    lines.push('');

    for (const result of data.web) {
      lines.push(`    ${fmt.info(icons.bullet)} ${result.title || 'Untitled'}`);
      lines.push(`      ${fmt.dim('URL:')} ${result.url}`);
      if (result.description) {
        lines.push(`      ${result.description}`);
      }
      if (result.category) {
        lines.push(`      ${fmt.dim('Category:')} ${result.category}`);
      }
      if (result.markdown) {
        // Indent markdown content
        const indentedMarkdown = result.markdown
          .split('\n')
          .map((line) => `      ${line}`)
          .join('\n');
        lines.push(`      ${fmt.dim('Content:')}`);
        lines.push(indentedMarkdown);
      }
      lines.push('');
    }
  }

  // Format image results
  if (data.images && data.images.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`  ${fmt.primary('Image results')}`);
    lines.push('');

    for (const result of data.images) {
      lines.push(`    ${fmt.info(icons.bullet)} ${result.title || 'Untitled'}`);
      lines.push(`      ${fmt.dim('Image URL:')} ${result.imageUrl}`);
      lines.push(`      ${fmt.dim('Source:')} ${result.url}`);
      if (result.imageWidth && result.imageHeight) {
        lines.push(
          `      ${fmt.dim('Size:')} ${result.imageWidth}x${result.imageHeight}`
        );
      }
      lines.push('');
    }
  }

  // Format news results
  if (data.news && data.news.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`  ${fmt.primary('News results')}`);
    lines.push('');

    for (const result of data.news) {
      lines.push(`    ${fmt.info(icons.bullet)} ${result.title || 'Untitled'}`);
      lines.push(`      ${fmt.dim('URL:')} ${result.url}`);
      if (result.date) {
        lines.push(`      ${fmt.dim('Date:')} ${result.date}`);
      }
      if (result.snippet) {
        lines.push(`      ${result.snippet}`);
      }
      if (result.markdown) {
        const indentedMarkdown = result.markdown
          .split('\n')
          .map((line) => `      ${line}`)
          .join('\n');
        lines.push(`      ${fmt.dim('Content:')}`);
        lines.push(indentedMarkdown);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Handle search command output
 */
export async function handleSearchCommand(
  container: IContainer,
  options: SearchOptions
): Promise<void> {
  // Display command info
  displayCommandInfo('Searching', options.query, {
    scrape: options.scrape,
    onlyMainContent: options.onlyMainContent,
    ignoreInvalidUrls: options.ignoreInvalidUrls,
    limit: options.limit,
    sources: options.sources,
    timeout: options.timeout,
  });

  const result = await executeSearch(container, options);

  // Use shared error handler
  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) {
    return;
  }

  // Check if there are any results
  const hasResults =
    (result.data.web && result.data.web.length > 0) ||
    (result.data.images && result.data.images.length > 0) ||
    (result.data.news && result.data.news.length > 0);

  if (!hasResults) {
    console.log(fmt.dim('No results found.'));
    return;
  }

  let outputContent: string;

  // Use JSON format if --json or --pretty flag is set
  // --pretty implies JSON output
  if (options.json || options.pretty) {
    const jsonOutput: Record<string, unknown> = {
      success: true,
      data: result.data,
    };

    // Access extra properties from the raw result (not in narrowed type)
    const rawResult = result as SearchResult;
    if (rawResult.warning) {
      jsonOutput.warning = rawResult.warning;
    }
    if (rawResult.id) {
      jsonOutput.id = rawResult.id;
    }
    if (rawResult.creditsUsed !== undefined) {
      jsonOutput.creditsUsed = rawResult.creditsUsed;
    }

    outputContent = formatJson(jsonOutput, options.pretty);
  } else {
    // Default to human-readable format
    outputContent = formatSearchReadable(result.data, options);
  }

  try {
    writeCommandOutput(outputContent, options);
  } catch (error) {
    console.error(
      fmt.error(error instanceof Error ? error.message : 'Invalid output path')
    );
    process.exit(1);
    return;
  }

  // Auto-embed only when --scrape was used (snippets are too noisy)
  if (options.embed !== false && options.scrape && result.data?.web) {
    const pipeline = container.getEmbedPipeline();

    // Use p-limit for concurrency control
    const limit = pLimit(MAX_CONCURRENT_EMBEDS);
    const embedTasks = result.data.web
      .filter((item) => item.markdown || item.html)
      .map((item) =>
        limit(() =>
          pipeline.autoEmbed(item.markdown || item.html || '', {
            url: item.url,
            title: item.title,
            sourceCommand: 'search',
            contentType: item.markdown ? 'markdown' : 'html',
          })
        )
      );

    await Promise.all(embedTasks);
  }
}

import { Command } from 'commander';
import type { ScrapeFormat } from '../types/scrape';
import type { SearchCategory, SearchSource } from '../types/search';

/**
 * Create and configure the search command
 */
export function createSearchCommand(): Command {
  const searchCmd = new Command('search')
    .description('Search the web using Firecrawl')
    .argument('<query>', 'Search query')
    .option(
      '--limit <number>',
      'Maximum number of results (default: 5, max: 100)',
      parseInt,
      5
    )
    .option(
      '--sources <sources>',
      'Comma-separated sources to search: web, images, news (default: web)'
    )
    .option(
      '--categories <categories>',
      'Comma-separated categories to filter: github, research, pdf'
    )
    .option(
      '--tbs <value>',
      'Time-based search: qdr:h (hour), qdr:d (day), qdr:w (week), qdr:m (month), qdr:y (year)'
    )
    .option(
      '--location <location>',
      'Location for geo-targeting (e.g., "Germany", "San Francisco,California,United States")'
    )
    .option(
      '--country <code>',
      'ISO country code for geo-targeting (default: US)'
    )
    .option(
      '--timeout <ms>',
      'Timeout in milliseconds (default: 60000)',
      parseInt,
      60000
    )
    .option(
      '--ignore-invalid-urls',
      'Exclude URLs invalid for other Firecrawl endpoints (default: true)',
      true
    )
    .option(
      '--no-ignore-invalid-urls',
      'Include all URLs including invalid ones'
    )
    .option(
      '--scrape',
      'Enable scraping of search results (default: true)',
      true
    )
    .option('--no-scrape', 'Disable scraping of search results')
    .option(
      '--scrape-formats <formats>',
      'Comma-separated scrape formats when --scrape is enabled: markdown, html, rawHtml, links, etc. (default: markdown)'
    )
    .option(
      '--only-main-content',
      'Include only main content when scraping (default: true)',
      true
    )
    .option('--no-embed', 'Skip auto-embedding of search results')
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as compact JSON', false)
    .option(
      '--pretty',
      'Output as formatted JSON (implies --json) (default: false)',
      false
    )
    .action(async (query, options, command: Command) => {
      const container = requireContainer(command);

      // Parse sources
      let sources: SearchSource[] | undefined;
      if (options.sources) {
        sources = options.sources
          .split(',')
          .map((s: string) => s.trim().toLowerCase()) as SearchSource[];

        // Validate sources
        const validSources = ['web', 'images', 'news'];
        for (const source of sources) {
          if (!validSources.includes(source)) {
            console.error(
              fmt.error(
                `Invalid source "${source}". Valid sources: ${validSources.join(', ')}`
              )
            );
            process.exit(1);
          }
        }
      }

      // Parse categories
      let categories: SearchCategory[] | undefined;
      if (options.categories) {
        categories = options.categories
          .split(',')
          .map((c: string) => c.trim().toLowerCase()) as SearchCategory[];

        // Validate categories
        const validCategories = ['github', 'research', 'pdf'];
        for (const category of categories) {
          if (!validCategories.includes(category)) {
            console.error(
              fmt.error(
                `Invalid category "${category}". Valid categories: ${validCategories.join(', ')}`
              )
            );
            process.exit(1);
          }
        }
      }

      // Parse scrape formats
      let scrapeFormats: ScrapeFormat[] | undefined;
      if (options.scrapeFormats) {
        scrapeFormats = options.scrapeFormats
          .split(',')
          .map((f: string) => f.trim()) as ScrapeFormat[];
      }

      const searchOptions = {
        query,
        limit: options.limit,
        sources,
        categories,
        tbs: options.tbs,
        location: options.location,
        country: options.country,
        timeout: options.timeout,
        ignoreInvalidUrls: options.ignoreInvalidUrls,
        embed: options.embed,
        scrape: options.scrape,
        scrapeFormats,
        onlyMainContent: options.onlyMainContent,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      };

      await handleSearchCommand(container, searchOptions);
    });

  return searchCmd;
}
