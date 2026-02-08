/**
 * Domains command implementation
 * Lists unique domains with aggregate statistics
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type {
  DomainInfo,
  DomainsOptions,
  DomainsResult,
} from '../types/domains';
import { processCommandResult } from '../utils/command';
import { fmt, icons } from '../utils/theme';
import {
  addVectorOutputOptions,
  getQdrantUrlError,
  requireContainer,
  resolveCollectionName,
} from './shared';

/**
 * Execute domains command
 *
 * @param container DI container with services
 * @param options Domains options
 * @returns DomainsResult with domain list or error
 */
export async function executeDomains(
  container: IContainer,
  options: DomainsOptions
): Promise<DomainsResult> {
  try {
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    if (!qdrantUrl) {
      return {
        success: false,
        error: getQdrantUrlError('domains'),
      };
    }

    const qdrantService = container.getQdrantService();

    // Scroll all points
    const points = await qdrantService.scrollAll(collection);

    // Aggregate by domain
    const domainMap = new Map<
      string,
      { urls: Set<string>; vectors: number; lastUpdated: string }
    >();

    for (const point of points) {
      const domain = String(point.payload.domain || 'unknown');
      const url = String(point.payload.url || '');
      const scrapedAt = String(point.payload.scraped_at || '');

      if (!domainMap.has(domain)) {
        domainMap.set(domain, { urls: new Set(), vectors: 0, lastUpdated: '' });
      }

      const entry = domainMap.get(domain);
      if (entry) {
        if (url) entry.urls.add(url);
        entry.vectors++;
        if (scrapedAt > entry.lastUpdated) {
          entry.lastUpdated = scrapedAt;
        }
      }
    }

    // Convert to array and sort by vector count descending
    let domains: DomainInfo[] = Array.from(domainMap.entries())
      .map(([domain, data]) => ({
        domain,
        urlCount: data.urls.size,
        vectorCount: data.vectors,
        lastUpdated: data.lastUpdated,
      }))
      .sort((a, b) => b.vectorCount - a.vectorCount);

    // Calculate totals before limiting
    const totalUrls = domains.reduce((sum, d) => sum + d.urlCount, 0);
    const totalVectors = domains.reduce((sum, d) => sum + d.vectorCount, 0);

    // Apply limit
    if (options.limit && options.limit > 0) {
      domains = domains.slice(0, options.limit);
    }

    return {
      success: true,
      data: {
        domains,
        totalDomains: domainMap.size,
        totalUrls,
        totalVectors,
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
 * Format domains as table
 */
function formatTable(domains: DomainInfo[]): string {
  if (domains.length === 0) {
    return fmt.dim('No domains found in vector database.');
  }

  const lines: string[] = [];
  lines.push(`  ${fmt.primary('Domains')}`);
  lines.push('');

  const header = [
    'Domain'.padEnd(35),
    'URLs'.padStart(6),
    'Vectors'.padStart(8),
    'Last Updated',
  ].join('  ');
  lines.push(header);
  lines.push('─'.repeat(header.length));

  for (const domain of domains) {
    const name =
      domain.domain.length > 34
        ? `${domain.domain.slice(0, 32)}..`
        : domain.domain.padEnd(35);
    const urls = String(domain.urlCount).padStart(6);
    const vectors = String(domain.vectorCount).padStart(8);
    const lastUpdated = domain.lastUpdated
      ? domain.lastUpdated.split('T')[0]
      : 'unknown';

    lines.push([name, urls, vectors, lastUpdated].join('  '));
  }

  return lines.join('\n');
}

/**
 * Format domains summary
 */
function formatSummary(data: NonNullable<DomainsResult['data']>): string {
  return `\n  ${fmt.info(icons.info)} ${data.totalDomains} domains, ${data.totalUrls} URLs, ${data.totalVectors} vectors`;
}

/**
 * Handle domains command output
 */
export async function handleDomainsCommand(
  container: IContainer,
  options: DomainsOptions
): Promise<void> {
  processCommandResult(
    await executeDomains(container, options),
    options,
    (resultData) => formatTable(resultData.domains) + formatSummary(resultData)
  );
}

/**
 * Create and configure the domains command
 */
export function createDomainsCommand(): Command {
  const domainsCmd = addVectorOutputOptions(
    new Command('domains')
      .description('List unique domains in the vector database')
      .option('--limit <number>', 'Maximum domains to show', parseInt)
  ).action(async (options, command: Command) => {
    const container = requireContainer(command);

    await handleDomainsCommand(container, {
      limit: options.limit,
      collection: options.collection,
      output: options.output,
      json: options.json,
    });
  });

  return domainsCmd;
}
