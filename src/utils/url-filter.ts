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
 * - Glob patterns (e.g., `**\/*.pdf`) are converted to regex before matching
 * - Other patterns use substring matching (e.g., /blog/ matches any URL containing "/blog/")
 *
 * @param url - URL to test
 * @param pattern - Exclude pattern (literal or regex)
 * @returns true if URL matches pattern
 */
export function matchesPattern(url: string, pattern: string): boolean {
  // Detect glob patterns first so values like **/*.pdf are not treated as raw regex.
  // Glob support here intentionally focuses on *, **, and ? wildcards.
  // Two criteria for glob detection:
  // 1. Require at least one * to avoid ambiguity with literal ? in URLs (e.g., query params)
  // 2. Exclude patterns with regex metacharacters (\ ^ $ ( ) { } |) to avoid treating
  //    regex patterns like \.pdf$ or (foo|bar) as globs
  const looksLikeGlob = pattern.includes('*') && !/[\\^$(){}|]/.test(pattern);

  if (looksLikeGlob) {
    const globRegex = globToRegex(pattern);
    // For path patterns (starting with /), test against the path component only
    let testTarget = url;
    if (pattern.startsWith('/')) {
      try {
        testTarget = new URL(url).pathname;
      } catch {
        return false; // Invalid URL can't match path pattern
      }
    }
    return globRegex.test(testTarget);
  }

  // Check if pattern looks like regex:
  // - Ends with $ (anchor)
  // - Starts with ^ (anchor)
  // - Contains regex metacharacters: \, (, ), [, ], {, }, |, +, .
  // Note: / is NOT a regex metacharacter in JavaScript
  const regexMetaChars = /[\^$\\()[\]{}|+.]/;
  const looksLikeRegex = regexMetaChars.test(pattern);

  if (looksLikeRegex) {
    try {
      const regex = new RegExp(pattern);
      return regex.test(url);
    } catch (error) {
      throw new Error(
        `Invalid exclude pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}. ` +
          'Pattern looks like regex but has syntax errors. Use glob syntax (*.pdf) or literal strings instead.'
      );
    }
  }

  // Literal substring matching
  return url.includes(pattern);
}

function globToRegex(pattern: string): RegExp {
  // Use Unicode private use area character as placeholder (cannot appear in valid URLs)
  const DOUBLE_STAR_PLACEHOLDER = '\uE000';

  // Layer 1: Sanity check for pattern complexity (not primary ReDoS defense)
  // Wildcard limit prevents pathological cases, but actual ReDoS protection comes from:
  // - Layer 2: Smart anchoring (lines 93-101) limits backtracking search space
  // - Layer 3: Non-greedy [^/]* and .* quantifiers with Unicode placeholder
  const wildcardCount = (pattern.match(/\*/g) || []).length;
  if (wildcardCount > 50) {
    throw new Error(
      `Glob pattern too complex: ${wildcardCount} wildcards (max 50)`
    );
  }

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER);

  let regexBody = escaped
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(new RegExp(DOUBLE_STAR_PLACEHOLDER, 'g'), '.*');

  // Smart anchoring: anchor start/end only if pattern doesn't begin/end with wildcard
  // This allows both prefix matching (/docs/ matches /docs/anything) and exact matching (*.pdf matches files.pdf only at end)
  const anchorStart = !pattern.startsWith('*');
  const anchorEnd = !pattern.endsWith('*');

  if (anchorStart) {
    regexBody = `^${regexBody}`;
  }
  if (anchorEnd) {
    regexBody = `${regexBody}$`;
  }

  return new RegExp(regexBody);
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
