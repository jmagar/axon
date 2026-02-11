import type { Command } from 'commander';
import type { IContainer } from '../container/types';
import { normalizeUrl } from '../utils/url';

interface CommandWithContainer extends Command {
  _container?: IContainer;
}

interface DomainSourceFilterOptions {
  domain?: string;
  source?: string;
}

export function requireContainer(command: Command): IContainer {
  const container = (command as CommandWithContainer)._container;
  if (!container) {
    throw new Error('Container not initialized');
  }
  return container;
}

export function requireContainerFromCommandTree(command: Command): IContainer {
  let current: Command | undefined = command;
  while (current) {
    const container = (current as CommandWithContainer)._container;
    if (container) {
      return container;
    }
    current = current.parent ?? undefined;
  }
  throw new Error('Container not initialized');
}

export function resolveCollectionName(
  container: IContainer,
  collection?: string
): string {
  return collection || container.config.qdrantCollection || 'firecrawl';
}

export function getQdrantUrlError(commandName: string): string {
  return `QDRANT_URL must be set in .env for the ${commandName} command.`;
}

export function buildDomainSourceFilter(
  options: DomainSourceFilterOptions
): Record<string, string | number | boolean> | undefined {
  const filter: Record<string, string | number | boolean> = {};
  if (options.domain) {
    filter.domain = options.domain;
  }
  if (options.source) {
    filter.source_command = options.source;
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function addDomainSourceFilterOptions(command: Command): Command {
  return command
    .option('--domain <domain>', 'Filter by domain')
    .option(
      '--source <command>',
      'Filter by source command (scrape, crawl, embed, search, extract)'
    );
}

export function addVectorOutputOptions(command: Command): Command {
  return command
    .option(
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON', false);
}

/**
 * Normalize and flatten URL arguments
 * Handles URLs that may contain newlines (e.g., from zsh variables that don't word-split)
 */
export function normalizeUrlArgs(rawUrls: string[]): string[] {
  return rawUrls
    .flatMap((u) => (u.includes('\n') ? u.split('\n') : [u]))
    .map((url) => url.trim())
    .filter(Boolean)
    .map(normalizeUrl);
}

/**
 * Aggregate points by domain
 * Used by both domains and stats commands to avoid duplication
 *
 * @param points Array of Qdrant points to aggregate
 * @param trackLastUpdated Whether to track the lastUpdated field
 * @returns Map of domain to aggregated data
 */
export function aggregatePointsByDomain(
  points: Array<{ payload: Record<string, unknown> }>,
  trackLastUpdated = false
): Map<string, { urls: Set<string>; vectors: number; lastUpdated?: string }> {
  const domainMap = new Map<
    string,
    { urls: Set<string>; vectors: number; lastUpdated?: string }
  >();

  for (const point of points) {
    const domain = String(point.payload.domain || 'unknown');
    const url = String(point.payload.url || '');

    if (!domainMap.has(domain)) {
      domainMap.set(domain, {
        urls: new Set(),
        vectors: 0,
        ...(trackLastUpdated && { lastUpdated: '' }),
      });
    }

    const entry = domainMap.get(domain);
    if (entry) {
      if (url) entry.urls.add(url);
      entry.vectors++;

      if (trackLastUpdated) {
        const scrapedAt = String(point.payload.scraped_at || '');
        if (entry.lastUpdated === undefined || scrapedAt > entry.lastUpdated) {
          entry.lastUpdated = scrapedAt;
        }
      }
    }
  }

  return domainMap;
}

/**
 * Resolve URL from positional argument or --url option
 * Exits with error if no URL provided
 *
 * @param positionalUrl URL from positional argument
 * @param optionsUrl URL from --url option
 * @returns The resolved URL
 */
export function resolveRequiredUrl(
  positionalUrl: string | undefined,
  optionsUrl: string | undefined
): string {
  const url = positionalUrl || optionsUrl;
  if (!url) {
    throw new Error(
      'URL is required. Provide it as argument or use --url option.'
    );
  }
  return url;
}

/**
 * Validate that TEI and Qdrant URLs are configured
 * Exits with error message if either is missing
 *
 * @param teiUrl TEI URL from container config
 * @param qdrantUrl Qdrant URL from container config
 * @param commandName Name of command for error message
 * @returns Validation result object
 */
export function validateEmbeddingUrls(
  teiUrl: string | undefined,
  qdrantUrl: string | undefined,
  commandName: string
): { valid: true } | { valid: false; error: string } {
  if (!teiUrl || !qdrantUrl) {
    return {
      valid: false,
      error: `TEI_URL and QDRANT_URL must be set in .env for the ${commandName} command.`,
    };
  }
  return { valid: true };
}

/**
 * Validate that Qdrant URL is configured
 * Returns validation result for use in command execution
 *
 * @param qdrantUrl Qdrant URL from container config
 * @param commandName Name of command for error message
 * @returns Validation result object
 */
export function validateQdrantUrl(
  qdrantUrl: string | undefined,
  commandName: string
): { valid: true } | { valid: false; error: string } {
  if (!qdrantUrl) {
    return {
      valid: false,
      error: getQdrantUrlError(commandName),
    };
  }
  return { valid: true };
}
