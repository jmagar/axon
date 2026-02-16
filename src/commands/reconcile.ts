/**
 * Reconcile command implementation
 *
 * Provides operational controls for crawl reconciliation state and manual runs.
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type {
  ReconcileResetData,
  ReconcileResetOptions,
  ReconcileResetResult,
  ReconcileRunData,
  ReconcileRunOptions,
  ReconcileRunResult,
  ReconcileStatusData,
  ReconcileStatusOptions,
  ReconcileStatusResult,
} from '../types/reconcile';
import { processCommandResult } from '../utils/command';
import {
  getDomainFromUrl,
  listReconciliationStatus,
  type ReconciliationDomainStatus,
  reconcileCrawlDomainState,
  resetReconciliationState,
} from '../utils/crawl-reconciliation';
import {
  buildFiltersEcho,
  CANONICAL_EMPTY_STATE,
  formatAlignedTable,
  formatHeaderBlock,
  truncateWithEllipsis,
} from '../utils/style-output';
import { fmt, icons } from '../utils/theme';
import {
  addVectorOutputOptions,
  requireContainer,
  resolveCollectionName,
} from './shared';

function normalizeDomainInput(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error('Domain is required.');
  }

  if (value.includes('://')) {
    const parsed = getDomainFromUrl(value);
    if (!parsed) {
      throw new Error(`Invalid domain/URL: ${input}`);
    }
    return parsed;
  }

  const withScheme = `https://${value}`;
  const parsed = getDomainFromUrl(withScheme);
  if (!parsed) {
    throw new Error(`Invalid domain: ${input}`);
  }
  return parsed;
}

function mapLinksToUrls(
  links: unknown[],
  domain: string
): { urls: string[]; sourceUrl: string } {
  const sourceUrl = `https://${domain}`;
  const urls = new Set<string>();
  urls.add(sourceUrl);

  for (const link of links) {
    const rawUrl =
      typeof link === 'string'
        ? link
        : typeof link === 'object' && link !== null
          ? String((link as { url?: unknown }).url ?? '')
          : '';
    if (!rawUrl) continue;
    const normalizedDomain = getDomainFromUrl(rawUrl);
    if (normalizedDomain !== domain) continue;
    try {
      const normalized = new URL(rawUrl).toString();
      urls.add(normalized);
    } catch {
      // Ignore malformed map links and continue.
    }
  }

  return { urls: [...urls], sourceUrl };
}

function summarizeStatus(
  domains: ReconciliationDomainStatus[]
): ReconcileStatusData {
  return {
    domains,
    totalDomains: domains.length,
    totalTrackedUrls: domains.reduce((sum, d) => sum + d.trackedUrls, 0),
    totalMissingUrls: domains.reduce((sum, d) => sum + d.missingUrls, 0),
    totalEligibleForDeleteNow: domains.reduce(
      (sum, d) => sum + d.eligibleForDeleteNow,
      0
    ),
  };
}

export async function executeReconcileStatus(
  _container: IContainer,
  options: ReconcileStatusOptions
): Promise<ReconcileStatusResult> {
  try {
    const domain = options.domain
      ? normalizeDomainInput(options.domain)
      : undefined;
    const domains = await listReconciliationStatus({ domain });
    return {
      success: true,
      data: summarizeStatus(domains),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function executeReconcileRun(
  container: IContainer,
  options: ReconcileRunOptions
): Promise<ReconcileRunResult> {
  try {
    const domain = normalizeDomainInput(options.domain);
    const mapTarget = `https://${domain}`;
    const client = container.getAxonClient();
    const mapResponse = await client.map(mapTarget, {
      sitemap: 'include',
      ignoreQueryParameters: true,
      includeSubdomains: false,
    });

    const { urls, sourceUrl } = mapLinksToUrls(mapResponse.links ?? [], domain);
    const apply = options.apply === true;
    const reconciliation = await reconcileCrawlDomainState({
      domain,
      seenUrls: urls,
      dryRun: !apply,
      now: options.now,
    });

    const collection = resolveCollectionName(container, options.collection);
    let deletedCount = 0;

    if (apply && reconciliation.urlsToDelete.length > 0) {
      const qdrant = container.getQdrantService();
      for (const url of reconciliation.urlsToDelete) {
        await qdrant.deleteByUrlAndSourceCommand(collection, url, 'crawl');
        deletedCount += 1;
      }
    }

    const data: ReconcileRunData = {
      domain,
      sourceUrl,
      seenUrls: urls.length,
      apply,
      trackedBefore: reconciliation.trackedBefore,
      trackedAfter: reconciliation.trackedAfter,
      candidateDeletes: reconciliation.urlsToDelete.length,
      deletedCount,
      deletedUrls: reconciliation.urlsToDelete,
    };

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function executeReconcileReset(
  _container: IContainer,
  options: ReconcileResetOptions
): Promise<ReconcileResetResult> {
  try {
    const domain = options.domain
      ? normalizeDomainInput(options.domain)
      : undefined;
    const result = await resetReconciliationState(domain);
    const data: ReconcileResetData = {
      domain,
      removedDomains: result.removedDomains,
      removedUrls: result.removedUrls,
    };
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

function formatStatusSummary(
  data: ReconcileStatusData,
  options: ReconcileStatusOptions
): string {
  const lines = formatHeaderBlock({
    title: 'Reconcile Status',
    summary: `Domains: ${data.totalDomains} | Tracked URLs: ${data.totalTrackedUrls} | Missing: ${data.totalMissingUrls} | Eligible now: ${data.totalEligibleForDeleteNow}`,
    filters: buildFiltersEcho([['domain', options.domain]]),
    includeFreshness: true,
  });

  if (data.domains.length === 0) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    formatAlignedTable(
      [
        { header: 'Domain', width: 32 },
        { header: 'Tracked', width: 7, align: 'right' },
        { header: 'Missing', width: 7, align: 'right' },
        { header: 'Eligible', width: 8, align: 'right' },
      ],
      data.domains.map((domain) => [
        truncateWithEllipsis(domain.domain, 32),
        String(domain.trackedUrls),
        String(domain.missingUrls),
        String(domain.eligibleForDeleteNow),
      ]),
      false
    )
  );

  if (data.domains.length === 1 && data.domains[0].missingRecords.length > 0) {
    lines.push('');
    lines.push(`  ${fmt.primary('Missing URL Details')}`);
    lines.push('');
    lines.push(
      formatAlignedTable(
        [
          { header: 'URL', width: 74 },
          { header: 'Misses', width: 6, align: 'right' },
          { header: 'Age(d)', width: 6, align: 'right' },
          { header: 'Elig', width: 4 },
        ],
        data.domains[0].missingRecords.map((record) => [
          truncateWithEllipsis(record.url, 74),
          String(record.missingConsecutive),
          String(
            record.missingAgeMs !== undefined
              ? Math.floor(record.missingAgeMs / (24 * 60 * 60 * 1000))
              : 0
          ),
          record.eligibleOnNextRun ? 'yes' : 'no',
        ]),
        false
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

function formatRunSummary(
  data: ReconcileRunData,
  options: ReconcileRunOptions
): string {
  const mode = data.apply ? 'apply' : 'preview';
  const lines = formatHeaderBlock({
    title: `Reconcile Run for ${data.domain}`,
    summary: `Mode: ${mode} | Seen: ${data.seenUrls} | Candidate deletes: ${data.candidateDeletes} | Deleted: ${data.deletedCount}`,
    filters: buildFiltersEcho([
      ['domain', data.domain],
      ['collection', options.collection],
      ['apply', data.apply],
    ]),
    includeFreshness: true,
  });

  if (data.deletedUrls.length === 0) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    formatAlignedTable(
      [
        { header: '#', width: 3, align: 'right' },
        { header: 'URL', width: 94 },
      ],
      data.deletedUrls.map((url, index) => [String(index + 1), url]),
      false
    )
  );

  return `${lines.join('\n')}\n`;
}

function formatResetSummary(data: ReconcileResetData): string {
  const lines = formatHeaderBlock({
    title: 'Reconcile Reset',
    summary: `Removed domains: ${data.removedDomains} | Removed URLs: ${data.removedUrls}`,
    filters: buildFiltersEcho([['domain', data.domain]]),
    includeFreshness: true,
  });
  return `${lines.join('\n')}\n`;
}

export async function handleReconcileStatusCommand(
  container: IContainer,
  options: ReconcileStatusOptions
): Promise<void> {
  await processCommandResult(
    await executeReconcileStatus(container, options),
    options,
    (data) => formatStatusSummary(data, options)
  );
}

export async function handleReconcileRunCommand(
  container: IContainer,
  options: ReconcileRunOptions
): Promise<void> {
  await processCommandResult(
    await executeReconcileRun(container, options),
    options,
    (data) => formatRunSummary(data, options)
  );
}

export async function handleReconcileResetCommand(
  container: IContainer,
  options: ReconcileResetOptions
): Promise<void> {
  if (options.yes !== true) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(
        fmt.error(
          'Cannot reset reconciliation state in non-interactive mode. Use --yes to confirm.'
        )
      );
      process.exitCode = 1;
      return;
    }
    const { askForConfirmation } = await import('../utils/prompts');
    const target = options.domain
      ? `domain ${normalizeDomainInput(options.domain)}`
      : 'all domains';
    const confirmed = await askForConfirmation(
      fmt.warning(
        `\n  ${icons.warning}  Reset reconciliation state for ${target}? This cannot be undone. (y/N) `
      )
    );
    if (!confirmed) {
      console.log(fmt.dim('  Cancelled.'));
      return;
    }
  }

  await processCommandResult(
    await executeReconcileReset(container, options),
    options,
    (data) => formatResetSummary(data)
  );
}

export function createReconcileCommand(): Command {
  const reconcileCmd = new Command('reconcile').description(
    'Inspect and control crawl reconciliation state'
  );

  reconcileCmd
    .command('status')
    .description('Show reconciliation state (all domains or one domain)')
    .argument('[domain]', 'Domain (or URL) to inspect')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (domain: string | undefined, options, command: Command) => {
      const container = requireContainer(command);
      await handleReconcileStatusCommand(container, {
        domain,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      });
    });

  addVectorOutputOptions(
    reconcileCmd
      .command('run')
      .description('Run manual reconciliation against latest map URLs')
      .argument('<domain>', 'Domain (or URL) to reconcile')
      .option('--apply', 'Apply deletes in Qdrant (default is preview)', false)
      .option('--pretty', 'Pretty print JSON output', false)
  ).action(async (domain: string, options, command: Command) => {
    const container = requireContainer(command);
    await handleReconcileRunCommand(container, {
      domain,
      apply: options.apply,
      collection: options.collection,
      output: options.output,
      json: options.json,
      pretty: options.pretty,
    });
  });

  reconcileCmd
    .command('reset')
    .description('Reset reconciliation state (domain or all)')
    .argument(
      '[domain]',
      'Domain (or URL) to reset. Omit to reset all domains.'
    )
    .option('--yes', 'Skip interactive confirmation prompt', false)
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (domain: string | undefined, options, command: Command) => {
      const container = requireContainer(command);
      await handleReconcileResetCommand(container, {
        domain,
        yes: options.yes,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      });
    });

  return reconcileCmd;
}
