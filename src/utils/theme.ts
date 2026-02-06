/**
 * Shared theme and styling utilities for CLI output
 * Provides TTY-safe colored output and consistent icons
 */

/**
 * ANSI color codes - only applied when output is a TTY
 */
export const colors = {
  // Status
  success: '\x1b[32m', // Green
  error: '\x1b[31m', // Red
  warning: '\x1b[33m', // Yellow
  info: '\x1b[36m', // Cyan

  // Emphasis
  primary: '\x1b[38;5;208m', // Orange (firecrawl brand)
  secondary: '\x1b[35m', // Magenta

  // Utility
  dim: '\x1b[2m', // Gray/dimmed
  bold: '\x1b[1m', // Bold
  reset: '\x1b[0m', // Reset all styles
} as const;

/**
 * Terminal-safe Unicode icons
 */
export const icons = {
  // Status
  success: '✓',
  error: '✗',
  warning: '!',
  info: 'i',

  // Progress
  pending: '○',
  processing: '◉',
  active: '●',
  completed: '✓',

  // UI Elements
  bullet: '•',
  arrow: '→',
  separator: '|',

  // Progress bar characters
  filled: '█',
  empty: '░',
  partial: '▓',
} as const;

/**
 * Check if stdout is a TTY (terminal)
 * When false, output is being piped or redirected
 */
export function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}

/**
 * Apply color to text only if output is a TTY
 * When piped, returns plain text without ANSI codes
 */
export function colorize(colorCode: string, text: string): string {
  return isTTY() ? `${colorCode}${text}${colors.reset}` : text;
}

/**
 * Helper functions for common color patterns
 */
export const fmt = {
  success: (text: string) => colorize(colors.success, text),
  error: (text: string) => colorize(colors.error, text),
  warning: (text: string) => colorize(colors.warning, text),
  info: (text: string) => colorize(colors.info, text),
  primary: (text: string) => colorize(colors.primary, text),
  dim: (text: string) => colorize(colors.dim, text),
  bold: (text: string) => colorize(colors.bold, text),
};

/**
 * Get status icon based on status string
 */
export function getStatusIcon(status: string, hasError?: boolean): string {
  if (hasError) return icons.error;

  switch (status.toLowerCase()) {
    case 'completed':
    case 'success':
      return icons.success;
    case 'scraping':
    case 'processing':
    case 'running':
      return icons.processing;
    case 'pending':
    case 'queued':
      return icons.pending;
    case 'failed':
    case 'error':
      return icons.error;
    default:
      return icons.bullet;
  }
}

/**
 * Get color for status string
 */
export function getStatusColor(status: string, hasError?: boolean): string {
  if (!isTTY()) return '';
  if (hasError) return colors.error;

  switch (status.toLowerCase()) {
    case 'completed':
    case 'success':
      return colors.success;
    case 'scraping':
    case 'processing':
    case 'running':
      return colors.warning;
    case 'pending':
    case 'queued':
      return colors.info;
    case 'failed':
    case 'error':
      return colors.error;
    default:
      return colors.info;
  }
}

/**
 * Format progress as text or progress bar (TTY-aware)
 */
export function formatProgress(completed: number, total: number): string {
  if (!isTTY()) {
    return `${completed}/${total}`;
  }

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const barWidth = 20;
  const filled = Math.round((completed / total) * barWidth);
  const bar =
    icons.filled.repeat(filled) + icons.empty.repeat(barWidth - filled);

  return `${bar} ${percentage}% (${completed}/${total})`;
}

/**
 * Format a status line with icon, color, and optional metadata
 */
export function formatStatusLine(
  status: string,
  message: string,
  metadata?: string,
  error?: string
): string {
  const icon = getStatusIcon(status, !!error);
  const statusColor = getStatusColor(status, !!error);
  const statusText = error ? 'error' : status;

  let line = `${colorize(statusColor, icon)} ${message} ${colorize(statusColor, statusText)}`;

  if (error) {
    line += ` ${fmt.dim(`(${error})`)}`;
  }

  if (metadata) {
    line += ` ${fmt.dim(metadata)}`;
  }

  return line;
}

/**
 * Format a header (bold when TTY)
 */
export function formatHeader(text: string): string {
  return fmt.bold(text);
}

/**
 * Format a bullet list item
 */
export function formatBullet(text: string, indent = 2): string {
  const spaces = ' '.repeat(indent);
  return `${spaces}${icons.bullet} ${text}`;
}

/**
 * Format a success message
 */
export function success(message: string): string {
  return `${colorize(colors.success, icons.success)} ${message}`;
}

/**
 * Format an error message
 */
export function error(message: string, details?: string): string {
  let result = `${colorize(colors.error, icons.error)} ${message}`;
  if (details) {
    result += `\n  ${fmt.dim(details)}`;
  }
  return result;
}

/**
 * Format a warning message
 */
export function warning(message: string): string {
  return `${colorize(colors.warning, icons.warning)} ${message}`;
}

/**
 * Format an info message
 */
export function info(message: string): string {
  return `${colorize(colors.info, icons.info)} ${message}`;
}

/**
 * Format a command start message
 */
export function commandStart(action: string, target: string): string {
  return `${icons.arrow} ${action} ${fmt.dim(target)}`;
}

/**
 * Format timing information
 */
export function formatTiming(seconds: number): string {
  return fmt.dim(`${seconds.toFixed(1)}s`);
}

/**
 * Format a count with label
 */
export function formatCount(count: number, label: string): string {
  const plural = count === 1 ? label : `${label}s`;
  return `${count} ${plural}`;
}

/**
 * Format retry count display
 * @param current - Current retry count
 * @param max - Maximum retries allowed
 * @returns Formatted string like "retries: 2/3"
 */
export function formatRetries(current: number, max: number): string {
  return `retries: ${current}/${max}`;
}
