import { describe, expect, it } from 'vitest';
import type { QueryResultItem } from '../../types/query';
import {
  canonicalizeUrl,
  deduplicateQueryItems,
  groupByBaseUrl,
  rankUrlGroups,
} from '../../utils/deduplication';

function makeItem(
  url: string,
  score: number,
  chunkText: string,
  title: string = 'Doc',
  chunkHeader: string | null = null,
  chunkIndex: number = 0
): QueryResultItem {
  return {
    score,
    url,
    title,
    chunkHeader,
    chunkText,
    chunkIndex,
    totalChunks: 1,
    domain: 'example.com',
    sourceCommand: 'crawl',
  };
}

describe('canonicalizeUrl', () => {
  it('normalizes fragment, tracking params, default ports, and trailing slash', () => {
    const input =
      'https://example.com:443/docs///?utm_source=test&x=1&fbclid=abc#intro';
    const result = canonicalizeUrl(input);

    expect(result).toBe('https://example.com/docs?x=1');
  });

  it('falls back safely for non-URL strings', () => {
    expect(canonicalizeUrl('not-a-url#frag///')).toBe('not-a-url');
  });
});

describe('groupByBaseUrl', () => {
  it('groups canonical URL variants together', () => {
    const items = [
      makeItem(
        'https://example.com/docs/?utm_medium=email#overview',
        0.9,
        'Chunk A'
      ),
      makeItem('https://example.com/docs', 0.8, 'Chunk B'),
      makeItem('https://other.com/page', 0.7, 'Other'),
    ];

    const grouped = groupByBaseUrl(items);
    expect(grouped.size).toBe(2);
    expect(grouped.get('https://example.com/docs')).toHaveLength(2);
    expect(grouped.get('https://other.com/page')).toHaveLength(1);
  });
});

describe('rankUrlGroups', () => {
  it('prefers lexically relevant URL group even with slightly lower vector score', () => {
    const grouped = groupByBaseUrl([
      makeItem(
        'https://example.com/general',
        0.81,
        'This page is about general product updates.',
        'General docs'
      ),
      makeItem(
        'https://example.com/subagents',
        0.79,
        'This guide explains how Claude subagents are configured and used.',
        'Claude subagents guide'
      ),
    ]);

    const ranked = rankUrlGroups(grouped, 'claude subagents', 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].baseUrl).toBe('https://example.com/subagents');
  });
});

describe('deduplicateQueryItems', () => {
  it('keeps all chunks for top N canonicalized URLs', () => {
    const items = [
      makeItem(
        'https://example.com/docs/?utm_source=test#intro',
        0.9,
        'Chunk 1',
        'Docs',
        null,
        0
      ),
      makeItem('https://example.com/docs', 0.88, 'Chunk 2', 'Docs', null, 1),
      makeItem('https://other.com/page', 0.87, 'Other', 'Other', null, 0),
    ];

    const deduped = deduplicateQueryItems(items, 'docs intro', 1);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((item) => item.chunkIndex)).toEqual([0, 1]);
    expect(deduped.every((item) => item.url.includes('example.com'))).toBe(
      true
    );
  });
});
