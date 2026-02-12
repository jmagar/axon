/**
 * Query command implementation
 * Semantic search over Qdrant vectors
 */

import type { IContainer } from '../container/types';
import type {
  QueryOptions,
  QueryResult,
  QueryResultItem,
} from '../types/query';
import { processCommandResult } from '../utils/command';
import { deduplicateQueryItems, groupByBaseUrl } from '../utils/deduplication';
import { colorize, colors, fmt, icons } from '../utils/theme';
import {
  requireContainer,
  resolveCollectionName,
  validateEmbeddingUrls,
} from './shared';

/**
 * Execute query command
 * Embeds query text via TEI then searches Qdrant for similar vectors
 * @param container DI container with services
 * @param options Query options including query text, limit, domain filter
 * @returns QueryResult with matched items or error
 */
export async function executeQuery(
  container: IContainer,
  options: QueryOptions
): Promise<QueryResult> {
  try {
    const teiUrl = container.config.teiUrl;
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    const validation = validateEmbeddingUrls(teiUrl, qdrantUrl, 'query');
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Get services from container
    const teiService = container.getTeiService();
    const qdrantService = container.getQdrantService();

    // Embed the query text
    const [queryVector] = await teiService.embedBatch([options.query]);

    // Build filter for Qdrant query
    const filter = options.domain ? { domain: options.domain } : undefined;

    // Validate limit parameter
    if (options.limit !== undefined && options.limit < 1) {
      return {
        success: false,
        error:
          'Limit must be a positive integer (received: ' + options.limit + ')',
      };
    }

    // Determine fetch strategy based on output mode
    // Compact/grouped modes deduplicate by URL, so fetch extra chunks to ensure enough unique URLs
    // Full mode shows all chunks, so no need to overfetch
    const requestedLimit = options.limit || 10;
    const needsDeduplication = !options.full; // Compact and grouped modes deduplicate
    const MAX_FETCH_LIMIT = 1000; // Cap to prevent excessive Qdrant queries
    const rawFetchLimit = needsDeduplication
      ? requestedLimit * 10
      : requestedLimit;
    const fetchLimit = Math.min(rawFetchLimit, MAX_FETCH_LIMIT);

    // Search Qdrant
    const results = await qdrantService.queryPoints(
      collection,
      queryVector,
      fetchLimit,
      filter
    );

    const getString = (value: unknown): string =>
      typeof value === 'string' ? value : '';
    const getNumber = (value: unknown, fallback: number): number =>
      typeof value === 'number' ? value : fallback;

    // Map to result items
    const items: QueryResultItem[] = results.map((r) => ({
      score: r.score ?? 0,
      url: getString(r.payload.url),
      title: getString(r.payload.title),
      chunkHeader:
        typeof r.payload.chunk_header === 'string'
          ? r.payload.chunk_header
          : null,
      chunkText: getString(r.payload.chunk_text),
      chunkIndex: getNumber(r.payload.chunk_index, 0),
      totalChunks: getNumber(r.payload.total_chunks, 1),
      domain: getString(r.payload.domain),
      sourceCommand: getString(r.payload.source_command),
    }));

    // Apply deduplication only for compact/grouped modes, not full mode
    let limitedItems: QueryResultItem[];

    if (needsDeduplication) {
      limitedItems = deduplicateQueryItems(
        items,
        options.query,
        requestedLimit
      );
    } else {
      // Full mode: return raw chunks without deduplication, just apply limit
      limitedItems = items.slice(0, requestedLimit);
    }

    return { success: true, data: limitedItems };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

function queryHeading(text: string): string {
  return fmt.bold(colorize(colors.primary, text));
}

function formatScore(score: number): string {
  const scoreText = `[${score.toFixed(2)}]`;
  if (score >= 0.75) return fmt.success(scoreText);
  if (score >= 0.65) return fmt.warning(scoreText);
  if (score >= 0.55) return fmt.info(scoreText);
  return fmt.dim(scoreText);
}

/**
 * Get meaningful snippet from chunk text
 * Skips formatting characters and finds substantive content
 * @param text Chunk text to extract snippet from
 * @returns Meaningful snippet or truncated text
 */
function isRelevantSentence(sentence: string): boolean {
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

function cleanSnippetSource(text: string): string {
  return text
    .replace(
      /^\s*(prev|next|home|menu|read more|copy|developer docs|subscribe|button text)\s*$/gim,
      ' '
    ) // remove standalone nav/cta lines
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ') // remove markdown images
    .replace(/\[​\]\([^)]+\)/g, ' ') // remove empty markdown links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // keep link text only
    .replace(/https?:\/\/\S+/g, ' ') // remove bare URLs
    .replace(/^\s*#{1,6}\s+/gm, '') // remove markdown headers
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ') // remove horizontal rules
    .replace(/^\s*[*\-•]\s+/gm, '') // strip list markers
    .replace(/\bwas this page helpful\?\b/gi, ' ') // remove docs feedback boilerplate
    .replace(/\b(table of contents|on this page)\b/gi, ' ') // remove nav headings
    .replace(/\s+/g, ' ')
    .trim();
}

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

function extractQueryTerms(query?: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function scoreSentenceForQuery(
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

type PreviewCandidate = {
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

  // Prefer query-relevant sentences first, then nearby context to reach 3-5.
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

  // Fallback: first relevant non-empty line with markdown stripped.
  const fallbackLines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 20 && /[a-zA-Z]/.test(l));
  const fallback = fallbackLines[0] || cleaned;
  return fallback.length > 220 ? `${fallback.slice(0, 220)}...` : fallback;
}

/**
 * Format compact output (default)
 * Groups by base URL and shows highest-scoring chunk with numbered results
 * @param items Query result items to format
 * @param limit Maximum number of unique URLs to display
 * @returns Formatted string for compact display
 */
function formatCompact(
  items: QueryResultItem[],
  query: string,
  verboseSnippets: boolean,
  _limit: number = 10
): string {
  if (items.length === 0) return fmt.dim('No results found.');

  // Items are already deduplicated and limited by executeQuery;
  // just re-group by URL for display (no re-ranking needed).
  const grouped = groupByBaseUrl(items);
  const sortedGroups = Array.from(grouped.entries()).map(
    ([baseUrl, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => b.score - a.score);
      return { baseUrl, items: sorted };
    }
  );

  // Format each group (show highest-scoring chunk)
  const lines: string[] = [];
  lines.push('');
  lines.push(queryHeading('Query Results'));
  lines.push(`  Query: ${fmt.dim(`"${query}"`)}`);
  lines.push(`  ${fmt.primary('Results:')}`);
  lines.push('');

  const results: string[] = [];
  let index = 1;
  for (const { baseUrl, items: groupItems } of sortedGroups) {
    const selection = selectBestPreviewItem(groupItems, query);
    const topItem = selection.selected;
    const chunkCount = groupItems.length;

    const score = topItem.score;
    const countPart = chunkCount > 1 ? ` (${chunkCount} chunks)` : ' (1 chunk)';
    const snippet = getMeaningfulSnippet(topItem.chunkText, query);

    results.push(
      `    ${fmt.info(icons.bullet)} ${fmt.dim(`${index}.`)} ${formatScore(score)} ${fmt.primary(baseUrl)}${fmt.dim(countPart)}`
    );
    results.push(`      ${snippet}`);
    if (verboseSnippets) {
      const topCandidates = selection.candidates
        .slice()
        .sort(
          (a, b) =>
            b.previewScore - a.previewScore || b.item.score - a.item.score
        )
        .slice(0, 3)
        .map(
          (c) =>
            `#${c.item.chunkIndex}(v=${c.item.score.toFixed(2)},p=${c.previewScore.toFixed(2)},s=${c.sentenceCount})`
        )
        .join(', ');
      results.push(
        `      ${fmt.dim(`snippet debug: selected=#${topItem.chunkIndex} vector=${topItem.score.toFixed(2)} preview=${selection.selectedPreviewScore.toFixed(2)} candidates=${selection.candidates.length}`)}`
      );
      results.push(`      ${fmt.dim(`top candidates: ${topCandidates}`)}`);
    }
    results.push('');
    index++;
  }

  lines.push(results.join('\n'));
  lines.push(`  ${fmt.primary('Next:')}`);
  lines.push(`    ${getRetrievalHint()}`);
  return lines.join('\n');
}

/**
 * Format full output (--full flag)
 * Shows score, URL, optional header, and complete chunk text
 * @param items Query result items to format
 * @returns Formatted string with full chunk text
 */
function formatFull(
  items: QueryResultItem[],
  query: string,
  _limit: number = 10
): string {
  if (items.length === 0) return fmt.dim('No results found.');

  // Items are already deduplicated and limited by executeQuery;
  // just re-group by URL for display.
  const _grouped = groupByBaseUrl(items);
  const limitedItems = items;

  const lines: string[] = [];
  lines.push('');
  lines.push(queryHeading('Query Results'));
  lines.push(`  Query: ${fmt.dim(`"${query}"`)}`);
  lines.push(`  ${fmt.primary('Results:')}`);
  lines.push('');
  const results = limitedItems
    .map((item) => {
      const header = item.chunkHeader ? ` - ${item.chunkHeader}` : '';
      return `    ${fmt.info(icons.bullet)} ${formatScore(item.score)} ${fmt.primary(item.url)}${fmt.dim(header)}\n\n${item.chunkText}`;
    })
    .join('\n\n---\n\n');
  lines.push(results);
  lines.push('');
  lines.push(`  ${fmt.primary('Next:')}`);
  lines.push(`    ${getRetrievalHint()}`);
  return lines.join('\n');
}

/**
 * Format grouped output (--group flag)
 * Groups results by URL, showing chunks under each URL heading
 * @param items Query result items to format
 * @param full Whether to show full chunk text or truncated
 * @returns Formatted string grouped by URL
 */
function formatGrouped(
  items: QueryResultItem[],
  full: boolean,
  query: string,
  verboseSnippets: boolean,
  _limit: number = 10
): string {
  if (items.length === 0) return fmt.dim('No results found.');

  // Items are already deduplicated and limited by executeQuery;
  // just re-group by URL for display (no re-ranking needed).
  const grouped = groupByBaseUrl(items);
  const groups = Array.from(grouped.entries()).map(([baseUrl, groupItems]) => {
    const sorted = [...groupItems].sort((a, b) => b.score - a.score);
    return { baseUrl, items: sorted };
  });

  const parts: string[] = [];
  parts.push('');
  parts.push(queryHeading('Query Results'));
  parts.push(`  Query: ${fmt.dim(`"${query}"`)}`);
  parts.push(`  ${fmt.primary('Results:')}`);
  parts.push('');
  for (const group of groups) {
    const baseUrl = group.baseUrl;
    const groupItems = group.items;
    parts.push(`  ${fmt.primary(baseUrl)}`);
    const selection = !full
      ? selectBestPreviewItem(groupItems, query)
      : undefined;
    for (const item of groupItems) {
      const header = item.chunkHeader ? ` - ${item.chunkHeader}` : '';
      const score = item.score;
      if (full) {
        parts.push(
          `    ${fmt.info(icons.bullet)} ${formatScore(score)}${fmt.dim(header)}\n${item.chunkText}`
        );
      } else {
        const truncated = getMeaningfulSnippet(item.chunkText, query);
        parts.push(
          `    ${fmt.info(icons.bullet)} ${formatScore(score)}${fmt.dim(header)}\n      ${truncated}`
        );
        if (
          verboseSnippets &&
          selection &&
          item.chunkIndex === selection.selected.chunkIndex
        ) {
          const topCandidates = selection.candidates
            .slice()
            .sort(
              (a, b) =>
                b.previewScore - a.previewScore || b.item.score - a.item.score
            )
            .slice(0, 3)
            .map(
              (c) =>
                `#${c.item.chunkIndex}(v=${c.item.score.toFixed(2)},p=${c.previewScore.toFixed(2)},s=${c.sentenceCount})`
            )
            .join(', ');
          parts.push(
            `      ${fmt.dim(`snippet debug: selected=#${selection.selected.chunkIndex} vector=${selection.selected.score.toFixed(2)} preview=${selection.selectedPreviewScore.toFixed(2)} candidates=${selection.candidates.length}`)}`
          );
          parts.push(`      ${fmt.dim(`top candidates: ${topCandidates}`)}`);
        }
      }
    }
    parts.push('');
  }

  parts.push(`  ${fmt.primary('Next:')}`);
  parts.push(`    ${getRetrievalHint()}`);
  return parts.join('\n');
}

/**
 * Get hint text for retrieving full documents
 * @returns Formatted hint message for users
 */
function getRetrievalHint(): string {
  return `${fmt.dim(`${icons.arrow} To retrieve full documents from the vector DB, use: firecrawl retrieve <url>`)}`;
}

/**
 * Handle query command output
 * Routes to appropriate formatter based on options flags
 * @param container DI container with services
 * @param options Query options including output format flags
 */
export async function handleQueryCommand(
  container: IContainer,
  options: QueryOptions
): Promise<void> {
  const requestStartTime = Date.now();
  const result = await executeQuery(container, options);
  const requestEndTime = Date.now();
  const durationMs = requestEndTime - requestStartTime;

  processCommandResult(result, options, (data) => {
    if (options.group) {
      return formatGrouped(
        data,
        !!options.full,
        options.query,
        !!options.verboseSnippets,
        options.limit || 10
      );
    }
    if (options.full) {
      return formatFull(data, options.query, options.limit || 10);
    }
    return formatCompact(
      data,
      options.query,
      !!options.verboseSnippets,
      options.limit || 10
    );
  });

  if (!options.timing) return;

  // Keep JSON output machine-friendly (no extra stdout text).
  if (options.json) {
    const status = result.success ? 'success' : 'error';
    const errorPart = result.success
      ? ''
      : ` (${result.error ?? 'Unknown error'})`;
    console.error(`Timing: ${durationMs}ms [${status}]${errorPart}`);
    return;
  }

  if (result.success) {
    const totalChunks = result.data?.length ?? 0;
    const uniqueUrls = groupByBaseUrl(result.data ?? []).size;
    console.error('');
    console.error(
      fmt.dim(
        `${icons.info} Query completed in ${durationMs}ms (${uniqueUrls} URLs, ${totalChunks} chunks scanned)`
      )
    );
    return;
  }

  console.error('');
  console.error(
    fmt.dim(
      `${icons.warning} Query failed after ${durationMs}ms (${result.error ?? 'Unknown error'})`
    )
  );
}

import { Command } from 'commander';

/**
 * Create and configure the query command
 */
export function createQueryCommand(): Command {
  const queryCmd = new Command('query')
    .description('Semantic search over embedded content in Qdrant')
    .argument('<query>', 'Search query text')
    .option(
      '--limit <number>',
      'Maximum number of results (default: 10)',
      (val) => parseInt(val, 10),
      10
    )
    .option('--domain <domain>', 'Filter results by domain')
    .option(
      '--full',
      'Show full chunk text instead of truncated (default: false)',
      false
    )
    .option('--group', 'Group results by URL', false)
    .option(
      '--verbose-snippets',
      'Show snippet selection diagnostics (chunk choice and candidate scores)',
      false
    )
    .option(
      '--timing',
      'Show request timing and other useful information',
      false
    )
    .option(
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (query: string, options, command: Command) => {
      const container = requireContainer(command);

      await handleQueryCommand(container, {
        query,
        limit: options.limit,
        domain: options.domain,
        full: options.full,
        group: options.group,
        verboseSnippets: options.verboseSnippets,
        timing: options.timing,
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return queryCmd;
}
