/**
 * Display utilities for command execution info
 */

/**
 * Format a value for display
 *
 * @param value - Value to format
 * @returns Formatted string representation
 */
function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.join(',')}]`;
  }
  return String(value);
}

/**
 * Format options for display, filtering out undefined/empty values
 *
 * @param options - Options object to format
 * @returns Formatted string of key=value pairs, or empty string if no options
 *
 * @example
 * ```typescript
 * formatOptionsDisplay({ limit: 10, timeout: undefined })
 * // Returns: "limit=10"
 *
 * formatOptionsDisplay({ tags: ['nav', 'footer'], enabled: true })
 * // Returns: "tags=[nav,footer], enabled=true"
 * ```
 */
export function formatOptionsDisplay(options: Record<string, unknown>): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(options)) {
    // Skip undefined and null
    if (value === undefined || value === null) continue;
    // Skip empty arrays
    if (Array.isArray(value) && value.length === 0) continue;

    pairs.push(`${key}=${formatValue(value)}`);
  }

  return pairs.join(', ');
}

/**
 * Display command execution info to stderr
 *
 * Outputs the action being performed, target URL/query, and effective options.
 * All output goes to stderr so results can still be piped.
 *
 * @param action - Action being performed (e.g., "Crawling", "Scraping")
 * @param target - Target URL or query string
 * @param options - Options being used for the command
 *
 * @example
 * ```typescript
 * displayCommandInfo('Crawling', 'https://example.com', {
 *   maxDepth: 3,
 *   allowSubdomains: true,
 * });
 * // Outputs to stderr:
 * // Crawling: https://example.com
 * // Options: maxDepth=3, allowSubdomains=true
 * //
 * ```
 */
export function displayCommandInfo(
  action: string,
  target: string,
  options: Record<string, unknown>
): void {
  console.error(`${action}: ${target}`);

  const optionsStr = formatOptionsDisplay(options);
  if (optionsStr) {
    console.error(`Options: ${optionsStr}`);
  }

  console.error(''); // Blank line for separation
}
