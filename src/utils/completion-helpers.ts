/**
 * Completion helpers for dynamic completion and shell detection
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getRecentJobIds as getRecentJobIdsFromHistory } from './job-history';

/**
 * Get recent job IDs from job history for completion
 * Returns up to 10 most recent job IDs across all job types
 *
 * @returns Array of recent job IDs
 */
export async function getRecentJobIds(): Promise<string[]> {
  try {
    const [crawl, batch, extract] = await Promise.all([
      getRecentJobIdsFromHistory('crawl', 10),
      getRecentJobIdsFromHistory('batch', 10),
      getRecentJobIdsFromHistory('extract', 10),
    ]);
    return Array.from(new Set([...crawl, ...batch, ...extract])).slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * Detect user's current shell
 * Returns 'bash', 'zsh', 'fish', or 'unknown'
 *
 * @returns Shell type
 */
export function detectShell(): string {
  const shellPath = process.env.SHELL || '';

  // Check SHELL environment variable first
  if (shellPath.includes('zsh')) return 'zsh';
  if (shellPath.includes('bash')) return 'bash';
  if (shellPath.includes('fish')) return 'fish';

  // Fallback to checking parent process
  try {
    const shell = execSync('ps -p $$ -o comm=', { encoding: 'utf-8' })
      .toString()
      .trim();

    if (shell.includes('zsh')) return 'zsh';
    if (shell.includes('bash')) return 'bash';
    if (shell.includes('fish')) return 'fish';
  } catch {
    // Ignore errors - will return 'unknown'
  }

  return 'unknown';
}

/**
 * Get shell RC file path for the given shell type
 *
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 * @returns Path to RC file, or null if unsupported shell
 */
export function getShellRcPath(shell: string): string | null {
  const home = homedir();

  switch (shell) {
    case 'bash': {
      // Check in order: .bashrc, .bash_profile, .profile
      const candidates = ['.bashrc', '.bash_profile', '.profile'];
      for (const candidate of candidates) {
        const path = join(home, candidate);
        if (existsSync(path)) return path;
      }
      // Default to .bashrc if none exist
      return join(home, '.bashrc');
    }
    case 'zsh': {
      const candidates = ['.zshrc', '.zprofile'];
      for (const candidate of candidates) {
        const path = join(home, candidate);
        if (existsSync(path)) return path;
      }
      return join(home, '.zshrc');
    }
    case 'fish':
      return join(home, '.config/fish/config.fish');
    default:
      return null;
  }
}

/**
 * Format values for shell completion
 *
 * @returns Array of available format options
 */
export function getFormatOptions(): string[] {
  return [
    'markdown',
    'html',
    'rawHtml',
    'links',
    'images',
    'screenshot',
    'summary',
    'changeTracking',
    'json',
    'attributes',
    'branding',
  ];
}

/**
 * Get status filter options for list command
 *
 * @returns Array of status values
 */
export function getStatusOptions(): string[] {
  return ['completed', 'scraping', 'failed', 'cancelled'];
}

/**
 * Get command types for history filtering
 *
 * @returns Array of command types
 */
export function getCommandTypes(): string[] {
  return ['scrape', 'crawl', 'map', 'search', 'extract', 'batch'];
}

/**
 * Get search modes for search command
 *
 * @returns Array of search modes
 */
export function getSearchModes(): string[] {
  return ['fast', 'accurate'];
}

/**
 * Get scrape modes for search command
 *
 * @returns Array of scrape modes
 */
export function getScrapeModes(): string[] {
  return ['none', 'auto', 'always'];
}

/**
 * Get sitemap modes for crawl command
 *
 * @returns Array of sitemap modes
 */
export function getSitemapModes(): string[] {
  return ['skip', 'include'];
}
