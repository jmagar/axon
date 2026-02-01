/**
 * Output formatting for crawl results
 */

import type { CrawlStatusResult } from '../../types/crawl';

/**
 * Format crawl status in human-readable way
 *
 * @param data - Crawl status data containing job details
 * @returns Formatted status string with job ID, status, progress, credits, and expiration
 *
 * @example
 * ```typescript
 * const formatted = formatCrawlStatus({
 *   id: 'job-123',
 *   status: 'completed',
 *   total: 100,
 *   completed: 100,
 *   creditsUsed: 50,
 *   expiresAt: '2026-02-15T00:00:00Z'
 * });
 * ```
 */
export function formatCrawlStatus(data: CrawlStatusResult['data']): string {
  if (!data) return '';

  const lines: string[] = [];
  lines.push(`Job ID: ${data.id}`);
  lines.push(`Status: ${data.status}`);
  lines.push(`Progress: ${data.completed}/${data.total} pages`);

  if (data.creditsUsed !== undefined) {
    lines.push(`Credits Used: ${data.creditsUsed}`);
  }

  if (data.expiresAt) {
    const expiresDate = new Date(data.expiresAt);
    // Extract locale from LANG environment variable, handling formats like en_US.UTF-8, C, etc.
    let locale = 'en-US';
    const langEnv = process.env.LANG;
    if (langEnv) {
      const langPart = langEnv.split('.')[0];
      // Only use if it looks like a valid locale (contains underscore or hyphen)
      if (langPart && (langPart.includes('_') || langPart.includes('-'))) {
        locale = langPart.replace('_', '-');
      }
    }
    lines.push(
      `Expires: ${expiresDate.toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    );
  }

  return `${lines.join('\n')}\n`;
}
