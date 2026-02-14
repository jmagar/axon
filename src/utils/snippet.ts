/**
 * Text snippet extraction and scoring utilities
 *
 * Provides NLP-adjacent text processing for extracting meaningful,
 * query-relevant snippets from chunk text. Used by the query command
 * for compact and grouped display modes.
 */

import type { QueryResultItem } from '../types/query';
import { extractQueryTerms } from './deduplication';
import { truncateWithMarker } from './display';

type ScoreBand = 'high' | 'medium' | 'low';

export function scoreBand(score: number): ScoreBand {
  if (score >= 0.75) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

export function scoreBandRank(score: number): number {
  if (score >= 0.75) return 0;
  if (score >= 0.55) return 1;
  return 2;
}

export function compareBySeverityThenScore(
  left: Pick<QueryResultItem, 'score'>,
  right: Pick<QueryResultItem, 'score'>
): number {
  const rankDelta = scoreBandRank(left.score) - scoreBandRank(right.score);
  if (rankDelta !== 0) return rankDelta;
  return right.score - left.score;
}

export function isRelevantSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length < 25) return false;
  if (trimmed.split(/\s+/).length < 5) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (
    /^(prev|next|home|menu|read more|copy|developer docs|subscribe|button text)$/i.test(
      trimmed
    )
  ) {
    return false;
  }
  if (/^[@#][a-z0-9_-]+$/i.test(trimmed)) return false;
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) return false;
  return true;
}

export function cleanSnippetSource(text: string): string {
  return text
    .replace(
      /^\s*(prev|next|home|menu|read more|copy|developer docs|subscribe|button text)\s*$/gim,
      ' '
    )
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[​\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/^\s*[*\-•]\s+/gm, '')
    .replace(/\bwas this page helpful\?\b/gi, ' ')
    .replace(/\b(table of contents|on this page)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreSentenceForQuery(
  sentence: string,
  queryTerms: string[],
  queryLower: string
): number {
  const lower = sentence.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (lower.includes(term)) {
      score += 2;
    }
  }

  if (
    queryLower.length >= 6 &&
    lower.includes(queryLower) &&
    queryTerms.length >= 2
  ) {
    score += 4;
  }

  return score;
}

function collectRelevantSentences(text: string): string[] {
  return cleanSnippetSource(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(isRelevantSentence);
}

function scoreChunkForPreview(text: string, query?: string): number {
  const queryTerms = extractQueryTerms(query);
  const queryLower = query?.toLowerCase().trim() || '';
  const sentences = collectRelevantSentences(text);

  let relevanceScore = 0;
  for (const sentence of sentences) {
    relevanceScore += scoreSentenceForQuery(sentence, queryTerms, queryLower);
  }

  const richnessScore =
    Math.min(sentences.length, 5) * 2 +
    Math.min(cleanSnippetSource(text).length, 500) / 100;

  return relevanceScore * 10 + richnessScore;
}

export type PreviewCandidate = {
  item: QueryResultItem;
  previewScore: number;
  sentenceCount: number;
  cleanedChars: number;
};

export type PreviewSelection = {
  selected: QueryResultItem;
  selectedPreviewScore: number;
  candidates: PreviewCandidate[];
};

function buildPreviewCandidates(
  groupItems: QueryResultItem[],
  query: string
): PreviewCandidate[] {
  const candidates = groupItems.slice(0, 8);
  return candidates.map((item) => {
    const cleaned = cleanSnippetSource(item.chunkText);
    const sentences = collectRelevantSentences(item.chunkText);
    return {
      item,
      previewScore: scoreChunkForPreview(item.chunkText, query),
      sentenceCount: sentences.length,
      cleanedChars: cleaned.length,
    };
  });
}

export function selectBestPreviewItem(
  groupItems: QueryResultItem[],
  query: string
): PreviewSelection {
  const candidates = buildPreviewCandidates(groupItems, query);

  if (candidates.length === 0) {
    throw new Error('Cannot select preview item from empty candidates list');
  }

  let selected = candidates[0];

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (
      candidate.previewScore > selected.previewScore ||
      (candidate.previewScore === selected.previewScore &&
        candidate.item.score > selected.item.score)
    ) {
      selected = candidate;
    }
  }

  return {
    selected: selected.item,
    selectedPreviewScore: selected.previewScore,
    candidates,
  };
}

/**
 * Build a compact, relevant preview from chunk text.
 * Targets ~3-5 sentences and filters navigation/boilerplate noise.
 */
export function getMeaningfulSnippet(text: string, query?: string): string {
  const cleaned = cleanSnippetSource(text);
  const sentences = collectRelevantSentences(text);

  const queryTerms = extractQueryTerms(query);
  const queryLower = query?.toLowerCase().trim() || '';

  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreSentenceForQuery(sentence, queryTerms, queryLower),
  }));

  const selected: string[] = [];
  const selectedIndexes = new Set<number>();
  let totalLength = 0;
  const maxChars = 700;

  if (queryTerms.length > 0) {
    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    for (const candidate of relevant) {
      if (selected.length === 5) break;
      if (
        totalLength + candidate.sentence.length > maxChars &&
        selected.length >= 3
      ) {
        break;
      }
      if (selectedIndexes.has(candidate.index)) continue;
      selected.push(candidate.sentence);
      selectedIndexes.add(candidate.index);
      totalLength += candidate.sentence.length;
    }

    if (selected.length > 0 && selected.length < 3) {
      const anchor = Math.min(...Array.from(selectedIndexes));
      const byDistance = scored
        .filter((s) => !selectedIndexes.has(s.index))
        .sort(
          (a, b) =>
            Math.abs(a.index - anchor) - Math.abs(b.index - anchor) ||
            b.score - a.score
        );

      for (const candidate of byDistance) {
        if (selected.length >= 3) break;
        if (
          totalLength + candidate.sentence.length > maxChars &&
          selected.length >= 2
        ) {
          break;
        }
        selected.push(candidate.sentence);
        selectedIndexes.add(candidate.index);
        totalLength += candidate.sentence.length;
      }
    }
  }

  if (selected.length === 0) {
    for (const sentence of sentences.slice(0, 5)) {
      if (totalLength + sentence.length > maxChars && selected.length >= 3) {
        break;
      }
      selected.push(sentence);
      totalLength += sentence.length;
    }
  }

  if (selected.length > 0) {
    if (selectedIndexes.size > 0) {
      return Array.from(selectedIndexes)
        .sort((a, b) => a - b)
        .map((i) => sentences[i])
        .join(' ');
    }
    return selected.join(' ');
  }

  const fallbackLines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 20 && /[a-zA-Z]/.test(l));
  const fallback = fallbackLines[0] || cleaned;
  return truncateWithMarker(fallback, 220);
}
