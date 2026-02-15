/**
 * Crawl status rendering for the status command
 */

import {
  colorize,
  colors,
  fmt,
  formatProgress,
  getStatusColor,
  getStatusIcon,
  icons,
} from '../../utils/theme';
import {
  accentJobId,
  accentProgressText,
  changedPrefix,
  domainFromUrl,
  formatRelativeAge,
  statusHeading,
} from './helpers';
import type { JobStatusData, RenderStatusOptions } from './types';

/**
 * Renders the active crawls section showing currently running crawls.
 */
export function renderActiveCrawlsSection(
  data: JobStatusData,
  options: RenderStatusOptions
): void {
  console.log('');
  console.log(statusHeading(`${icons.processing} Crawls`));
  if (data.activeCrawls.crawls.length === 0) {
    console.log(fmt.dim('  No active crawls.'));
  } else {
    for (const crawl of data.activeCrawls.crawls) {
      const changed = changedPrefix(`active:${crawl.id}`, options.changedKeys);
      const domain = options.wide ? domainFromUrl(crawl.url) : null;
      console.log(
        `  ${changed}${colorize(colors.warning, icons.processing)} ${accentJobId(crawl.id)}${
          options.compact ? '' : ` ${crawl.url}`
        }${domain ? ` ${fmt.dim(`(${domain})`)}` : ''}`
      );
    }
  }
}

/**
 * Renders the crawl status section showing completed/pending/failed crawls.
 */
export function renderCrawlStatusSection(
  data: JobStatusData,
  crawlUrlById: Map<string, string>,
  options: RenderStatusOptions
): void {
  const hasCrawlLookup =
    data.crawls.length > 0 || data.resolvedIds.crawls.length > 0;

  if (hasCrawlLookup) {
    console.log('');
    console.log(statusHeading(`${icons.bullet} Crawl Status`));
    if (data.crawls.length === 0) {
      console.log(fmt.dim('  No crawl jobs found.'));
    }

    const crawlRows = data.crawls.map((crawl) => {
      const crawlError = crawl.error;
      const displayUrl = crawlUrlById.get(crawl.id ?? '');
      const status = crawl.status ?? 'unknown';
      const isFailed =
        Boolean(crawlError) || status === 'failed' || status === 'error';
      const isCompleted = status === 'completed';
      const hasProgress =
        crawl.completed !== undefined && crawl.total !== undefined;
      const completedValue = hasProgress ? (crawl.completed as number) : 0;
      const totalValue = hasProgress ? (crawl.total as number) : 0;
      const isStaleScraping =
        !isFailed &&
        !isCompleted &&
        (status === 'scraping' ||
          status === 'processing' ||
          status === 'running') &&
        hasProgress &&
        totalValue > 0 &&
        completedValue >= totalValue;
      const icon = getStatusIcon(status, isFailed);
      const statusColor = getStatusColor(status, isFailed);
      const progress = hasProgress && totalValue > 0
        ? formatProgress(completedValue, totalValue)
        : null;
      const age = formatRelativeAge(crawl.updatedAt);

      let line = `${changedPrefix(`crawl:${crawl.id}`, options.changedKeys)}${colorize(statusColor, icon)} ${accentJobId(crawl.id ?? 'unknown')} `;
      if (isFailed) {
        line += `${colorize(statusColor, 'error')} ${fmt.dim(`(${crawlError ?? 'Unknown error'})`)}`;
      } else if (progress) {
        line += `${colorize(statusColor, status)} ${accentProgressText(progress)}`;
      } else {
        line += `${colorize(statusColor, status)}`;
      }
      if (isStaleScraping) {
        line += ` ${colorize(colors.warning, `${icons.warning} [stale: reached total but not completed]`)}`;
      }
      if (!options.compact && displayUrl) {
        line += ` ${fmt.dim(displayUrl)}`;
      }
      const domain = options.wide ? domainFromUrl(displayUrl) : null;
      if (domain) {
        line += ` ${fmt.dim(`(${domain})`)}`;
      }
      if (age) {
        line += ` ${fmt.dim(age)}`;
      }
      return {
        crawl,
        line,
        isFailed,
        isCompleted,
        isStaleScraping,
      };
    });

    const failedCrawls = crawlRows.filter((row) => row.isFailed);
    const completedCrawls = crawlRows.filter((row) => row.isCompleted);
    const pendingCrawls = crawlRows.filter(
      (row) => !row.isFailed && !row.isCompleted
    );
    const staleCrawls = pendingCrawls.filter((row) => row.isStaleScraping);
    const nonStalePendingCrawls = pendingCrawls.filter(
      (row) => !row.isStaleScraping
    );

    console.log(
      `  ${colorize(colors.primary, 'Failed crawls:')} ${fmt.dim(`(${failedCrawls.length})`)}`
    );
    if (failedCrawls.length === 0) {
      console.log(fmt.dim('    No failed crawl jobs.'));
    } else {
      for (const row of failedCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    if (staleCrawls.length > 0) {
      console.log(
        `  ${colorize(colors.warning, 'Warn crawls:')} ${fmt.dim(`(${staleCrawls.length})`)}`
      );
      for (const row of staleCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    console.log(
      `  ${colorize(colors.primary, 'Pending crawls:')} ${fmt.dim(`(${nonStalePendingCrawls.length})`)}`
    );
    if (nonStalePendingCrawls.length === 0) {
      console.log(fmt.dim('    No pending crawl jobs.'));
    } else {
      for (const row of nonStalePendingCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    console.log(
      `  ${colorize(colors.primary, 'Completed crawls:')} ${fmt.dim(`(${completedCrawls.length})`)}`
    );
    if (completedCrawls.length === 0) {
      console.log(fmt.dim('    No completed crawl jobs.'));
    } else {
      for (const row of completedCrawls) {
        console.log(`    ${row.line}`);
      }
    }
  } else {
    console.log('');
    console.log(statusHeading('Crawl Status'));
    console.log(fmt.dim('  No recent crawl job IDs found.'));
  }
}
