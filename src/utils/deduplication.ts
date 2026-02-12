import type { QueryResultItem } from '../types/query';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'your',
  'you',
  'are',
  'was',
  'were',
  'how',
  'what',
  'when',
  'where',
  'why',
  'who',
  'can',
  'could',
  'would',
  'should',
  'into',
  'about',
  'over',
  'under',
  'just',
  'more',
  'less',
  'very',
  'use',
  'using',
  'used',
  'get',
  'set',
  'via',
  'not',
  'all',
  'any',
  'but',
  'too',
  'out',
  'our',
  'their',
  'them',
  'they',
  'its',
  "it's",
  'then',
  'than',
  'also',
  'have',
  'has',
  'had',
]);

function stripFragment(url: string): string {
  const hashIndex = url.indexOf('#');
  return hashIndex === -1 ? url : url.substring(0, hashIndex);
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(stripFragment(url));
    parsed.hash = '';
    if (
      (parsed.protocol === 'https:' && parsed.port === '443') ||
      (parsed.protocol === 'http:' && parsed.port === '80')
    ) {
      parsed.port = '';
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const keepParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith('utm_') ||
        normalizedKey === 'gclid' ||
        normalizedKey === 'fbclid'
      ) {
        continue;
      }
      keepParams.append(key, value);
    }
    parsed.search = keepParams.toString() ? `?${keepParams.toString()}` : '';
    return parsed.toString();
  } catch {
    return stripFragment(url).replace(/\/+$/, '');
  }
}

export function groupByBaseUrl(
  items: QueryResultItem[]
): Map<string, QueryResultItem[]> {
  const grouped = new Map<string, QueryResultItem[]>();
  for (const item of items) {
    const baseUrl = canonicalizeUrl(item.url);
    const existing = grouped.get(baseUrl) || [];
    existing.push(item);
    grouped.set(baseUrl, existing);
  }
  return grouped;
}

function extractQueryTerms(query?: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function countTermMatches(text: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const lower = text.toLowerCase();
  let matches = 0;
  for (const term of queryTerms) {
    if (lower.includes(term)) matches++;
  }
  return matches;
}

function scoreUrlGroupForQuery(
  groupItems: QueryResultItem[],
  query: string
): { rankScore: number; coverageCount: number } {
  const queryTerms = extractQueryTerms(query);
  const queryLower = query.toLowerCase().trim();
  const topVector = groupItems[0]?.score ?? 0;

  if (groupItems.length === 0) {
    return { rankScore: topVector, coverageCount: 0 };
  }

  let maxCoverage = 0;
  let maxTitleHeaderCoverage = 0;
  let phraseHit = 0;

  for (const item of groupItems.slice(0, 6)) {
    const merged = `${item.title} ${item.chunkHeader ?? ''} ${item.chunkText}`;
    const titleAndHeader = `${item.title} ${item.chunkHeader ?? ''}`;
    maxCoverage = Math.max(maxCoverage, countTermMatches(merged, queryTerms));
    maxTitleHeaderCoverage = Math.max(
      maxTitleHeaderCoverage,
      countTermMatches(titleAndHeader, queryTerms)
    );
    if (
      queryLower.length >= 6 &&
      queryTerms.length >= 2 &&
      merged.toLowerCase().includes(queryLower)
    ) {
      phraseHit = 1;
    }
  }

  const queryTermCount = queryTerms.length || 1;
  const coverageBoost = (maxCoverage / queryTermCount) * 0.16;
  const titleHeaderBoost = (maxTitleHeaderCoverage / queryTermCount) * 0.06;
  const phraseBoost = phraseHit ? 0.08 : 0;

  return {
    rankScore: topVector + coverageBoost + titleHeaderBoost + phraseBoost,
    coverageCount: maxCoverage,
  };
}

export type RankedUrlGroup = {
  baseUrl: string;
  items: QueryResultItem[];
  topScore: number;
  rankScore: number;
  coverageCount: number;
};

export function rankUrlGroups(
  grouped: Map<string, QueryResultItem[]>,
  query: string,
  limit: number
): RankedUrlGroup[] {
  return Array.from(grouped.entries())
    .map(([baseUrl, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => b.score - a.score);
      const { rankScore, coverageCount } = scoreUrlGroupForQuery(sorted, query);
      return {
        baseUrl,
        items: sorted,
        topScore: sorted[0].score,
        rankScore,
        coverageCount,
      };
    })
    .sort(
      (a, b) =>
        b.rankScore - a.rankScore ||
        b.coverageCount - a.coverageCount ||
        b.topScore - a.topScore
    )
    .slice(0, limit);
}

export function deduplicateQueryItems(
  items: QueryResultItem[],
  query: string,
  limit: number
): QueryResultItem[] {
  const grouped = groupByBaseUrl(items);
  const topGroups = rankUrlGroups(grouped, query, limit);
  return topGroups.flatMap((group) => group.items);
}
