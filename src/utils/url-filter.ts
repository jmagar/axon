/**
 * URL filtering utilities for client-side exclude pattern matching
 */

export interface FilterStats {
  total: number;
  excluded: number;
  kept: number;
}

export interface ExcludedUrl {
  url: string;
  matchedPattern: string;
}

export interface FilterResult<T> {
  filtered: T[];
  stats: FilterStats;
  excluded: ExcludedUrl[];
}

/**
 * Tests if a URL matches an exclude pattern
 * - Patterns ending with $ or containing regex metacharacters are treated as regex
 * - Other patterns use substring matching (e.g., /blog/ matches any URL containing "/blog/")
 *
 * @param url - URL to test
 * @param pattern - Exclude pattern (literal or regex)
 * @returns true if URL matches pattern
 */
export function matchesPattern(url: string, pattern: string): boolean {
  // Check if pattern looks like regex:
  // - Ends with $ (anchor)
  // - Starts with ^ (anchor)
  // - Contains regex metacharacters: \, (, ), [, ], {, }, |, *, +, ., ?
  // Note: / is NOT a regex metacharacter in JavaScript
  const regexMetaChars = /[\^$\\()[\]{}|*+.?]/;
  const looksLikeRegex = regexMetaChars.test(pattern);

  if (looksLikeRegex) {
    try {
      const regex = new RegExp(pattern);
      return regex.test(url);
    } catch (error) {
      // Invalid regex - log warning and skip this pattern
      console.warn(
        `[url-filter] Invalid regex pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  // Literal substring matching
  return url.includes(pattern);
}

/**
 * Filters URLs against exclude patterns
 *
 * @param urls - Array of URL objects to filter
 * @param excludePatterns - Patterns to exclude (literal or regex)
 * @returns Filtered URLs, statistics, and excluded URLs
 */
export function filterUrls<T extends { url: string }>(
  urls: T[],
  excludePatterns: string[]
): FilterResult<T> {
  const total = urls.length;

  // Fast path: no patterns means no filtering
  if (excludePatterns.length === 0) {
    return {
      filtered: urls,
      stats: { total, excluded: 0, kept: total },
      excluded: [],
    };
  }

  const filtered: T[] = [];
  const excluded: ExcludedUrl[] = [];

  for (const item of urls) {
    let isExcluded = false;
    let matchedPattern: string | undefined;

    // Check against all patterns
    for (const pattern of excludePatterns) {
      if (matchesPattern(item.url, pattern)) {
        isExcluded = true;
        matchedPattern = pattern;
        break; // Stop on first match
      }
    }

    if (isExcluded && matchedPattern) {
      excluded.push({ url: item.url, matchedPattern });
    } else {
      filtered.push(item);
    }
  }

  return {
    filtered,
    stats: {
      total,
      excluded: excluded.length,
      kept: filtered.length,
    },
    excluded,
  };
}
