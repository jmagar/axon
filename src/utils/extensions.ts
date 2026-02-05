/**
 * Utilities for converting file extensions to excludePaths patterns
 *
 * This module handles the conversion of extension lists (e.g., ['.pkg', '.exe'])
 * to wildcard path patterns compatible with Firecrawl SDK's excludePaths
 * (e.g., ['**\/*.pkg', '**\/*.exe']).
 */

/**
 * Normalize a file extension to standard format
 *
 * - Adds leading dot if missing
 * - Converts to lowercase
 * - Trims whitespace
 *
 * @param ext - Raw extension string (e.g., 'pkg', '.PKG', ' exe ')
 * @returns Normalized extension (e.g., '.pkg', '.pkg', '.exe')
 *
 * @example
 * normalizeExtension('pkg')    // '.pkg'
 * normalizeExtension('.PKG')   // '.pkg'
 * normalizeExtension(' exe ')  // '.exe'
 */
function normalizeExtension(ext: string): string {
  const trimmed = ext.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

/**
 * Validate extension format to prevent path traversal attacks
 *
 * Rejects extensions containing:
 * - Path separators (/, \)
 * - Parent directory references (..)
 * - Wildcards (*, ?)
 * - Empty strings after normalization
 *
 * @param ext - Extension to validate
 * @returns True if extension is safe to use
 *
 * @example
 * isValidExtension('.pkg')      // true
 * isValidExtension('.tar.gz')   // true
 * isValidExtension('../evil')   // false
 * isValidExtension('a/b')       // false
 * isValidExtension('')          // false
 */
function isValidExtension(ext: string): boolean {
  if (!ext || ext.length === 0) {
    return false;
  }

  // Reject path traversal attempts
  if (ext.includes('..') || ext.includes('/') || ext.includes('\\')) {
    return false;
  }

  // Reject wildcards (those are for excludePaths, not extensions)
  if (ext.includes('*') || ext.includes('?')) {
    return false;
  }

  // Must be just a dot followed by alphanumeric/dots (for .tar.gz)
  const normalized = normalizeExtension(ext);
  return /^\.[a-z0-9.]+$/.test(normalized);
}

/**
 * Convert file extensions to excludePaths regex patterns
 *
 * Takes a list of file extensions and converts them to regex patterns that can be
 * used with Firecrawl SDK's excludePaths option. Invalid extensions are
 * silently filtered out.
 *
 * Process:
 * 1. Normalize each extension (add dot, lowercase)
 * 2. Validate format (reject path traversal, wildcards)
 * 3. Convert to regex pattern (e.g., \.pkg$)
 * 4. Deduplicate
 *
 * @param extensions - Array of extensions (with or without leading dots)
 * @returns Array of regex patterns for excludePaths
 *
 * @example
 * extensionsToPaths(['.pkg', 'exe', '.DMG'])
 * // Returns: ['\\.dmg$', '\\.exe$', '\\.pkg$']
 *
 * extensionsToPaths(['.pkg', '.pkg', 'exe'])
 * // Returns: ['\\.exe$', '\\.pkg$'] (deduplicated)
 *
 * extensionsToPaths(['.tar.gz', '.zip'])
 * // Returns: ['\\.tar\\.gz$', '\\.zip$']
 *
 * extensionsToPaths(['../evil', '.pkg', ''])
 * // Returns: ['\\.pkg$'] (invalid entries filtered)
 */
export function extensionsToPaths(extensions: string[]): string[] {
  const patterns = new Set<string>();

  for (const ext of extensions) {
    const normalized = normalizeExtension(ext);

    if (isValidExtension(normalized)) {
      // Escape dots for regex and add end anchor
      const escapedExt = normalized.replace(/\./g, '\\.');
      patterns.add(`${escapedExt}$`);
    }
  }

  return Array.from(patterns).sort();
}
