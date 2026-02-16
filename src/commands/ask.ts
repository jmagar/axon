/**
 * Ask command implementation
 * Q&A over embedded documents using configured AI backend
 */

import { spawn } from 'node:child_process';
import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type { AskOptions, AskResult, AskSource } from '../types/ask';
import type { QueryResultItem } from '../types/query';
import { getSettings } from '../utils/settings';
import { formatAsOfEst, truncateWithEllipsis } from '../utils/style-output';
import { colorize, colors, fmt, icons } from '../utils/theme';
import { executeQuery } from './query';
import { executeRetrieve } from './retrieve';
import {
  requireContainer,
  resolveCollectionName,
  validateEmbeddingUrls,
} from './shared';

type AskBackend =
  | {
      kind: 'cli';
      cliTool: 'gemini' | 'claude';
      model: string;
      aiName: string;
    }
  | {
      kind: 'openai';
      model: string;
      baseUrl: string;
      apiKey: string;
      aiName: string;
    };

function askAccent(text: string): string {
  return colorize(colors.materialLightBlue, text);
}

function pinkNumber(value: number | string): string {
  return fmt.primary(String(value));
}

function writeAssistantText(text: string): void {
  process.stdout.write(text);
}

function resolveSpeakerName(backend: AskBackend): string {
  const model = backend.model.toLowerCase();
  if (model.includes('gemini')) return 'Gemini';
  if (model.includes('claude')) return 'Claude';
  if (model.includes('codex')) return 'Codex';
  return backend.aiName;
}

function padCell(
  value: string,
  width: number,
  align: 'left' | 'right' = 'left'
): string {
  return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

function renderAskSourcesTable(
  rows: Array<{ rank: string; raw: string; url: string; title: string }>,
  urlWidth: number,
  titleWidth: number
): string {
  const rankWidth = 4;
  const rawWidth = 5;
  const sep = '  ';

  const header = [
    askAccent(padCell('Rank', rankWidth, 'right')),
    askAccent(padCell('Raw', rawWidth, 'right')),
    askAccent(padCell('URL', urlWidth)),
    askAccent(padCell('Title', titleWidth)),
  ].join(sep);

  const divider = [
    fmt.dim('─'.repeat(rankWidth)),
    fmt.dim('─'.repeat(rawWidth)),
    fmt.dim('─'.repeat(urlWidth)),
    fmt.dim('─'.repeat(titleWidth)),
  ].join(sep);

  const body = rows.map((row) =>
    [
      fmt.primary(padCell(row.rank, rankWidth, 'right')),
      fmt.primary(padCell(row.raw, rawWidth, 'right')),
      askAccent(padCell(row.url, urlWidth)),
      fmt.primary(padCell(row.title, titleWidth)),
    ].join(sep)
  );

  return [header, divider, ...body].join('\n');
}

const DEFAULT_SOURCES_PREVIEW_COUNT = 5;

const NON_INSTRUCTIONAL_URL_PATTERNS: RegExp[] = [
  /\/pricing(?:\/|$)/,
  /\/plans?(?:\/|$)/,
  /\/solutions?(?:\/|$)/,
  /\/customers?(?:\/|$)/,
  /\/case-studies?(?:\/|$)/,
  /\/about(?:\/|$)/,
  /\/careers?(?:\/|$)/,
  /\/blog(?:\/|$)/,
  /\/news(?:\/|$)/,
  /\/changelog(?:\/|$)/,
];

const GENERIC_REDIRECT_PATTERNS: RegExp[] = [
  /\/redirect(?:\/|$)/,
  /\/r\/[a-z0-9_-]+/i,
];

function selectDiverseChunks<T extends { url: string; score: number }>(
  items: T[],
  targetCount: number,
  maxPerUrl: number = 2
): T[] {
  if (items.length <= targetCount) {
    return items;
  }

  const selected: T[] = [];
  const perUrlCount = new Map<string, number>();
  const seenByIdentity = new Set<string>();

  function identity(item: T, index: number): string {
    return `${item.url}::${item.score.toFixed(6)}::${index}`;
  }

  // Pass 1: ensure source diversity (up to one chunk per URL)
  for (let i = 0; i < items.length && selected.length < targetCount; i++) {
    const item = items[i];
    if (perUrlCount.has(item.url)) continue;
    selected.push(item);
    perUrlCount.set(item.url, 1);
    seenByIdentity.add(identity(item, i));
  }

  // Pass 2: fill remaining slots, capped per URL
  for (let i = 0; i < items.length && selected.length < targetCount; i++) {
    const item = items[i];
    if (seenByIdentity.has(identity(item, i))) continue;
    const used = perUrlCount.get(item.url) ?? 0;
    if (used >= maxPerUrl) continue;
    selected.push(item);
    perUrlCount.set(item.url, used + 1);
    seenByIdentity.add(identity(item, i));
  }

  // Pass 3: if still under target, fill strictly by score order
  for (let i = 0; i < items.length && selected.length < targetCount; i++) {
    const item = items[i];
    if (seenByIdentity.has(identity(item, i))) continue;
    selected.push(item);
    seenByIdentity.add(identity(item, i));
  }

  return selected;
}

function tokenizeQuery(text: string): string[] {
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'how',
    'what',
    'where',
    'when',
    'you',
    'your',
    'are',
    'can',
    'does',
    'create',
    'make',
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
}

function tokenizePath(pathOrUrl: string): Set<string> {
  try {
    const parsed = new URL(pathOrUrl);
    return new Set(
      parsed.pathname
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3)
    );
  } catch {
    return new Set(
      pathOrUrl
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3)
    );
  }
}

function tokenizeText(text: string): Set<string> {
  return new Set(tokenizeQuery(text));
}

type TemporalScope = {
  kind: 'today' | 'yesterday' | 'this_week' | 'this_month';
  label: string;
  startMs: number;
  endMs: number;
  strict: boolean;
  primaryDateYmd?: string;
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date: Date): Date {
  const day = date.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = startOfLocalDay(date);
  start.setDate(start.getDate() + mondayOffset);
  return start;
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function formatDateYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function detectTemporalScope(
  query: string,
  now: Date = new Date()
): TemporalScope | null {
  const q = query.toLowerCase();
  if (/\byesterday\b/.test(q)) {
    const todayStart = startOfLocalDay(now);
    const start = addDays(todayStart, -1);
    return {
      kind: 'yesterday',
      label: `yesterday (${formatDateYmd(start)})`,
      startMs: start.getTime(),
      endMs: todayStart.getTime(),
      strict: true,
      primaryDateYmd: formatDateYmd(start),
    };
  }

  if (/\btoday(?:'s)?\b|\btonight\b/.test(q)) {
    const start = startOfLocalDay(now);
    const end = addDays(start, 1);
    return {
      kind: 'today',
      label: `today (${formatDateYmd(start)})`,
      startMs: start.getTime(),
      endMs: end.getTime(),
      strict: true,
      primaryDateYmd: formatDateYmd(start),
    };
  }

  if (/\bthis week\b/.test(q)) {
    const start = startOfLocalWeek(now);
    const end = addDays(start, 7);
    return {
      kind: 'this_week',
      label: `this week (${formatDateYmd(start)} to ${formatDateYmd(addDays(end, -1))})`,
      startMs: start.getTime(),
      endMs: end.getTime(),
      strict: false,
    };
  }

  if (/\bthis month\b/.test(q)) {
    const start = startOfLocalMonth(now);
    const end = addMonths(start, 1);
    return {
      kind: 'this_month',
      label: `this month (${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')})`,
      startMs: start.getTime(),
      endMs: end.getTime(),
      strict: false,
    };
  }

  return null;
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function filterByTemporalScope(
  items: QueryResultItem[],
  scope: TemporalScope
): QueryResultItem[] {
  return items.filter((item) => {
    const timestamp =
      parseTimestamp(item.fileModifiedAt) ?? parseTimestamp(item.scrapedAt);
    if (timestamp === null) {
      return false;
    }
    return timestamp >= scope.startMs && timestamp < scope.endMs;
  });
}

function rerankChunks(
  chunks: QueryResultItem[],
  query: string,
  temporalScope?: TemporalScope | null
): QueryResultItem[] {
  const tokens = Array.from(new Set(tokenizeQuery(query)));
  if (tokens.length === 0) {
    return chunks;
  }

  return [...chunks].sort((a, b) => {
    function adjustedScore(item: (typeof chunks)[number]): number {
      const urlTokens = tokenizePath(item.url);
      const titleTokens = tokenizeText(item.title);
      const headerTokens = tokenizeText(item.chunkHeader ?? '');
      const chunkTokens = tokenizeText(item.chunkText);

      let docsBoost = 0;
      if (
        item.url.includes('/docs/') ||
        item.url.includes('/how-tos/') ||
        item.url.includes('/reference/')
      ) {
        docsBoost = 0.04;
      }

      let urlAdjustment = 0;
      const urlLower = item.url.toLowerCase();

      // Penalize non-English docs routes.
      if (
        /\/docs\/(?!en(?:-[a-z]{2,4})?\/)[a-z]{2}(?:-[a-z]{2,4})?\//.test(
          urlLower
        )
      ) {
        urlAdjustment -= 0.2;
      }

      // Prefer English docs routes where available.
      if (/\/docs\/en(?:-[a-z]{2,4})?\//.test(urlLower)) {
        urlAdjustment += 0.07;
      }

      // Penalize generic redirects and low-information marketing pages.
      if (GENERIC_REDIRECT_PATTERNS.some((pattern) => pattern.test(urlLower))) {
        urlAdjustment -= 0.2;
      }
      if (
        NON_INSTRUCTIONAL_URL_PATTERNS.some((pattern) => pattern.test(urlLower))
      ) {
        urlAdjustment -= 0.12;
      }

      // Generic lexical relevance boost from query token matches by location.
      let lexicalBoost = 0;
      for (const token of tokens) {
        if (urlTokens.has(token)) lexicalBoost += 0.045;
        if (titleTokens.has(token)) lexicalBoost += 0.03;
        if (headerTokens.has(token)) lexicalBoost += 0.02;
        if (chunkTokens.has(token)) lexicalBoost += 0.01;
      }
      lexicalBoost = Math.min(lexicalBoost, 0.35);

      let temporalPathBoost = 0;
      if (temporalScope) {
        const pathCandidate = (
          item.sourcePathRel ||
          item.url ||
          ''
        ).toLowerCase();
        if (
          pathCandidate.includes('docs/sessions/') ||
          pathCandidate.includes('/docs/sessions/')
        ) {
          temporalPathBoost += 0.06;
        }
        if (
          temporalScope.primaryDateYmd &&
          pathCandidate.includes(temporalScope.primaryDateYmd)
        ) {
          temporalPathBoost += 0.1;
        }
      }

      return (
        item.score +
        lexicalBoost +
        docsBoost +
        urlAdjustment +
        temporalPathBoost
      );
    }

    return adjustedScore(b) - adjustedScore(a);
  });
}

function getConfiguredCliModel(explicitModel?: string): string | undefined {
  const value = explicitModel?.trim() || process.env.ASK_CLI?.trim();
  return value && value.length > 0 ? value : undefined;
}

function getOpenAiFallbackConfig():
  | { baseUrl: string; apiKey: string; model: string }
  | undefined {
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) {
    return undefined;
  }
  return { baseUrl, apiKey, model };
}

function resolveAskBackend(explicitModel?: string): AskBackend | undefined {
  const cliModel = getConfiguredCliModel(explicitModel);
  if (cliModel) {
    const cliTool = cliModel.startsWith('gemini-') ? 'gemini' : 'claude';
    return {
      kind: 'cli',
      cliTool,
      model: cliModel,
      aiName: cliTool === 'gemini' ? 'Gemini' : 'Claude',
    };
  }

  const openAi = getOpenAiFallbackConfig();
  if (openAi) {
    return {
      kind: 'openai',
      model: openAi.model,
      baseUrl: openAi.baseUrl,
      apiKey: openAi.apiKey,
      aiName: 'Assistant',
    };
  }

  return undefined;
}

function resolveAndValidateMaxContext(
  maxContext?: number
): { valid: true; value: number } | { valid: false; error: string } {
  const resolved = maxContext ?? 250000;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    return {
      valid: false,
      error: `Invalid --max-context value: ${String(maxContext)}. It must be a positive safe integer.`,
    };
  }
  return { valid: true, value: resolved };
}

function resolveAndValidateCount(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  flagName: string
): { valid: true; value: number } | { valid: false; error: string } {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    return {
      valid: false,
      error: `Invalid ${flagName} value: ${String(value)}. It must be an integer between ${min} and ${max}.`,
    };
  }
  return { valid: true, value: resolved };
}

/**
 * Execute ask command
 * 1. Query Qdrant for relevant documents
 * 2. Build context from top semantic chunks
 * 3. Format context
 * 4. Stream model response from configured backend
 * @param container DI container with services
 * @param options Ask options
 * @returns AskResult with formatted context
 */
export async function executeAsk(
  container: IContainer,
  options: AskOptions
): Promise<AskResult> {
  try {
    const teiUrl = container.config.teiUrl;
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    // Validate embedding services are configured
    const validation = validateEmbeddingUrls(teiUrl, qdrantUrl, 'ask');
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    const settings = getSettings();
    const limitValidation = resolveAndValidateCount(
      options.limit,
      settings.ask.limit,
      1,
      100,
      '--limit'
    );
    if (!limitValidation.valid) {
      return { success: false, error: limitValidation.error };
    }
    const fullDocsValidation = resolveAndValidateCount(
      options.fullDocs,
      settings.ask.fullDocs ?? 5,
      1,
      20,
      '--full-docs'
    );
    if (!fullDocsValidation.valid) {
      return { success: false, error: fullDocsValidation.error };
    }
    const backfillValidation = resolveAndValidateCount(
      options.backfillChunks,
      settings.ask.backfillChunks ?? 3,
      0,
      20,
      '--backfill-chunks'
    );
    if (!backfillValidation.valid) {
      return { success: false, error: backfillValidation.error };
    }
    const limit = limitValidation.value;
    const fullDocsTarget = fullDocsValidation.value;
    const backfillTarget = backfillValidation.value;

    const backend = resolveAskBackend(options.model);
    if (!backend) {
      return {
        success: false,
        error:
          'No ask backend configured. Set ASK_CLI or configure OPENAI_BASE_URL + OPENAI_API_KEY + OPENAI_MODEL.',
      };
    }
    const maxContextValidation = resolveAndValidateMaxContext(
      options.maxContext
    );
    if (!maxContextValidation.valid) {
      return {
        success: false,
        error: maxContextValidation.error,
      };
    }
    const maxContextChars = maxContextValidation.value;

    // Step 1: Query Qdrant for relevant documents
    console.error(
      askAccent(`${icons.processing} Searching for relevant documents...`)
    );

    const basePoolSize = Math.max(limit, fullDocsTarget + backfillTarget);
    const candidatePoolLimit = Math.max(
      basePoolSize,
      Math.min(basePoolSize * 8, 120)
    );
    const queryResult = await executeQuery(container, {
      query: options.query,
      limit: candidatePoolLimit,
      domain: options.domain,
      collection,
      json: true, // Get structured data
    });

    if (!queryResult.success || !queryResult.data) {
      return {
        success: false,
        error: queryResult.error || 'Query failed with no results',
      };
    }

    if (queryResult.data.length === 0) {
      return {
        success: false,
        error:
          'No relevant documents found. Try a different query or domain filter.',
      };
    }

    const temporalScope = detectTemporalScope(options.query);
    const reranked = rerankChunks(
      queryResult.data,
      options.query,
      temporalScope
    );
    const scopedReranked = temporalScope
      ? filterByTemporalScope(reranked, temporalScope)
      : reranked;
    if (temporalScope?.strict && scopedReranked.length === 0) {
      return {
        success: false,
        error: `No ${temporalScope.label} matches found in collection "${collection}".`,
      };
    }
    const usedScopeFallback = Boolean(
      temporalScope && !temporalScope.strict && scopedReranked.length === 0
    );
    const retrievalPool = usedScopeFallback ? reranked : scopedReranked;

    if (temporalScope && !usedScopeFallback) {
      console.error(
        `${askAccent(icons.success)} ${askAccent('Applied Temporal Scope:')} ${fmt.primary(temporalScope.label)} ${askAccent('(')}${pinkNumber(retrievalPool.length)} ${askAccent('candidates)')}`
      );
    }
    if (temporalScope && usedScopeFallback) {
      console.error(
        fmt.warning(
          `${icons.warning} No matches for temporal scope ${temporalScope.label}; using unscoped retrieval.`
        )
      );
    }

    const topChunks = selectDiverseChunks(retrievalPool, limit, 2);
    const topDocumentCandidates = selectDiverseChunks(
      retrievalPool,
      fullDocsTarget,
      1
    );
    console.error(
      `${askAccent(icons.processing)} ${askAccent('Building context from')} ${pinkNumber(topChunks.length)} ${askAccent('chunks (from')} ${pinkNumber(retrievalPool.length)} ${askAccent('candidates), top')} ${pinkNumber(topDocumentCandidates.length)} ${askAccent('full docs...')}`
    );

    const retrieveResults = await Promise.all(
      topDocumentCandidates.map((item) =>
        executeRetrieve(container, {
          url: item.url,
          collection,
          json: true,
        })
      )
    );

    const successfulRetrieves = retrieveResults.filter(
      (result) => result.success && result.data
    );
    if (successfulRetrieves.length === 0) {
      return {
        success: false,
        error: 'Failed to retrieve full documents for top sources.',
      };
    }

    console.error(
      `${askAccent(icons.success)} ${askAccent('Retrieved')} ${pinkNumber(successfulRetrieves.length)} ${askAccent('full documents')}`
    );
    const backendDetails =
      backend.kind === 'openai'
        ? `${backend.aiName} via OpenAI-compatible endpoint (${backend.model})`
        : `${backend.aiName} (${backend.model})`;
    console.error(askAccent(`${icons.arrow} Asking ${backendDetails}...`));
    console.error(''); // Blank line before AI response

    // Step 3: Build formatted context from top full documents + chunk backfill
    const separator = '---';
    const fullDocumentUrls = new Set(
      successfulRetrieves
        .map((retrieved) => retrieved.data?.url)
        .filter((url): url is string => typeof url === 'string')
    );
    const backfillCandidates = selectDiverseChunks(
      retrievalPool.filter((item) => !fullDocumentUrls.has(item.url)),
      backfillTarget,
      1
    );

    // Build full-document context incrementally with size limit
    const fullDocumentParts: string[] = [];
    const backfillChunkParts: string[] = [];
    let totalChars = 0;
    let includedDocuments = 0;
    let includedChunks = 0;

    for (let idx = 0; idx < successfulRetrieves.length; idx++) {
      const retrieved = successfulRetrieves[idx];
      if (!retrieved.data) continue;
      const sourceLabel = `S${idx + 1}`;
      const documentPart = `## Source Document ${idx + 1} [${sourceLabel}]: ${retrieved.data.url}\n\n${retrieved.data.content}`;
      const documentSize = documentPart.length + separator.length + 2; // +2 for newlines

      // Check if adding this document would exceed limit
      if (totalChars + documentSize > maxContextChars) {
        // If we haven't included any docs yet, the limit is too small
        if (includedDocuments === 0) {
          return {
            success: false,
            error: `Context size limit (${maxContextChars} chars) too small to include any full documents. Try increasing --max-context.`,
          };
        }
        // Otherwise, stop adding more docs
        console.error(
          fmt.warning(
            `${icons.warning} Context size limit reached (${maxContextChars} chars). Included ${includedDocuments}/${successfulRetrieves.length} full documents.`
          )
        );
        break;
      }

      fullDocumentParts.push(documentPart);
      totalChars += documentSize;
      includedDocuments++;
    }

    if (includedDocuments === 0) {
      return {
        success: false,
        error:
          'No relevant full documents could be included in prompt context.',
      };
    }

    for (let idx = 0; idx < backfillCandidates.length; idx++) {
      const chunk = backfillCandidates[idx];
      const sourceLabel = `S${includedDocuments + idx + 1}`;
      const chunkHeaderText = chunk.chunkHeader
        ? `\n\n### ${chunk.chunkHeader}`
        : '';
      const chunkPart = `## Supplemental Chunk ${idx + 1} [${sourceLabel}]: ${chunk.url} (chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks})${chunkHeaderText}\n\n${chunk.chunkText}`;
      const chunkSize = chunkPart.length + separator.length + 2;
      if (totalChars + chunkSize > maxContextChars) {
        break;
      }
      backfillChunkParts.push(chunkPart);
      totalChars += chunkSize;
      includedChunks++;
    }

    console.error(
      `${askAccent(icons.success)} ${askAccent('Context ready:')} ${askAccent('docs')} ${pinkNumber(includedDocuments)} ${fmt.dim('|')} ${askAccent('chunks')} ${pinkNumber(includedChunks)}`
    );

    const contextParts = [...fullDocumentParts, ...backfillChunkParts];
    const documentsContext = contextParts.join(`\n\n${separator}\n\n`);
    const context = [
      'Answer using the provided full documents and supplemental chunks below.',
      'Do NOT inspect local files, codebase, MCP tools, or any external sources.',
      'If details are incomplete, provide the best answer possible from these documents/chunks and clearly note what is missing.',
      'Cite supporting sources inline with [S#] references that match the source labels below.',
      '',
      'Full documents and supplemental chunks:',
      documentsContext,
      '',
      separator,
      '',
      `Question: ${options.query}`,
    ].join('\n');

    const bestScoreByUrl = new Map<string, number>();
    for (const item of retrievalPool) {
      const existing = bestScoreByUrl.get(item.url);
      if (existing === undefined || item.score > existing) {
        bestScoreByUrl.set(item.url, item.score);
      }
    }

    // Include sources for full docs actually added to context, deduped by URL.
    const sourceByUrl = new Map<string, AskSource>();
    for (let idx = 0; idx < includedDocuments; idx++) {
      const retrieved = successfulRetrieves[idx];
      if (!retrieved.data) continue;
      const url = retrieved.data.url;
      if (sourceByUrl.has(url)) continue;
      const sourceCandidate = topDocumentCandidates.find(
        (item) => item.url === url
      );
      sourceByUrl.set(url, {
        url,
        title: sourceCandidate?.title,
        score: bestScoreByUrl.get(url) ?? sourceCandidate?.score ?? 0,
      });
    }
    for (let idx = 0; idx < includedChunks; idx++) {
      const chunk = backfillCandidates[idx];
      if (sourceByUrl.has(chunk.url)) continue;
      sourceByUrl.set(chunk.url, {
        url: chunk.url,
        title: chunk.title,
        score: bestScoreByUrl.get(chunk.url) ?? chunk.score,
      });
    }
    const sources: AskSource[] = Array.from(sourceByUrl.values());
    const uniqueSourceUrls = new Set(sources.map((source) => source.url)).size;

    // Step 4: Call AI backend and stream response to stdout
    const speakerName = resolveSpeakerName(backend);
    console.error('');
    console.error(`  ${askAccent('Conversation')}`);
    console.error(`    ${fmt.primary('You:')} ${options.query}`);
    console.error(`    ${fmt.primary(`${speakerName}:`)}`);
    const responseStart = process.hrtime.bigint();
    const answer = await callAskBackend(context, backend);
    const responseDurationSeconds =
      Number(process.hrtime.bigint() - responseStart) / 1_000_000_000;

    return {
      success: true,
      data: {
        query: options.query,
        context,
        sources,
        appliedScope: temporalScope?.label,
        scopeFallback: usedScopeFallback || undefined,
        scopeStrict: temporalScope ? temporalScope.strict : undefined,
        fullDocumentsUsed: includedDocuments,
        chunksUsed: includedChunks,
        rawCandidateChunks: reranked.length,
        scopedCandidateChunks: scopedReranked.length,
        uniqueSourceUrls,
        candidateChunks: retrievalPool.length,
        contextCharsUsed: totalChars,
        contextCharsLimit: maxContextChars,
        responseDurationSeconds,
        answer,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Extract assistant text from OpenAI-compatible payload
 */
function extractOpenAiText(payload: unknown): string | undefined {
  const root = payload as Record<string, unknown>;
  const choices = root.choices as Array<Record<string, unknown>> | undefined;
  const first = choices?.[0];
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  const outputText = root.output_text;
  if (typeof outputText === 'string' && outputText.trim().length > 0) {
    return outputText;
  }
  return undefined;
}

async function callAskBackend(
  context: string,
  backend: AskBackend
): Promise<string> {
  if (backend.kind === 'openai') {
    return callOpenAiCompatible(context, backend);
  }
  return callAICLI(context, backend.model, backend.cliTool);
}

/**
 * Call AI CLI tool as subprocess (claude or gemini)
 * Pipes context to stdin, captures stdout
 */
async function callAICLI(
  context: string,
  model: string,
  cliTool: 'claude' | 'gemini'
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Build arguments - both CLIs use --model
    // Claude CLI requires -p (print mode) for non-interactive stdin piping
    const args =
      cliTool === 'gemini'
        ? [
            '--model',
            model,
            '--prompt',
            'Answer only from stdin context. Do not use tools.',
          ]
        : ['-p', '--model', model];

    // Spawn the appropriate CLI
    const aiProcess = spawn(cliTool, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    // Capture stdout (AI's response)
    aiProcess.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      writeAssistantText(text); // Stream to terminal in real-time
    });

    if (aiProcess.stderr) {
      aiProcess.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });
    }

    // Handle stdin errors (e.g. child exits before stdin is flushed)
    aiProcess.stdin.on('error', () => {
      // Ignore stdin write errors - the close handler will report the real error
    });

    // Write context to stdin
    aiProcess.stdin.write(context);
    aiProcess.stdin.end();

    // Handle process exit
    aiProcess.on('close', (code: number | null) => {
      if (code === null) {
        const stderrTail = errorOutput.trim().split('\n').slice(-8).join('\n');
        reject(
          new Error(
            stderrTail
              ? `${cliTool} CLI was killed by a signal.\n${stderrTail}`
              : `${cliTool} CLI was killed by a signal.`
          )
        );
      } else if (code !== 0) {
        const stderrTail = errorOutput.trim().split('\n').slice(-8).join('\n');
        reject(
          new Error(
            stderrTail
              ? `${cliTool} CLI exited with code ${code}.\n${stderrTail}`
              : `${cliTool} CLI exited with code ${code}.`
          )
        );
      } else {
        resolve(output.trim());
      }
    });

    aiProcess.on('error', (err: Error) => {
      reject(
        new Error(
          `Failed to spawn ${cliTool} CLI: ${err.message}. Make sure '${cliTool}' is installed and in PATH.`
        )
      );
    });
  });
}

/**
 * Call OpenAI-compatible chat/completions endpoint and stream response.
 */
async function callOpenAiCompatible(
  context: string,
  backend: Extract<AskBackend, { kind: 'openai' }>
): Promise<string> {
  const url = `${backend.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const requestHeaders = {
    Authorization: `Bearer ${backend.apiKey}`,
    'Content-Type': 'application/json',
  };

  const streamResponse = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({
      model: backend.model,
      temperature: 0.2,
      stream: true,
      messages: [{ role: 'user', content: context }],
    }),
  });

  if (!streamResponse.ok) {
    const errorBody = await streamResponse.text();
    throw new Error(
      `OpenAI ask request failed (${streamResponse.status}): ${errorBody || streamResponse.statusText}`
    );
  }

  const contentType = streamResponse.headers.get('content-type') || '';
  if (
    streamResponse.body &&
    contentType.toLowerCase().includes('text/event-stream')
  ) {
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const eventPayload = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = eventPayload.choices?.[0]?.delta?.content;
          if (token && token.length > 0) {
            output += token;
            writeAssistantText(token);
          }
        } catch {
          // Ignore malformed SSE frames from non-standard providers.
        }
      }
    }

    if (output.trim().length > 0) {
      return output.trim();
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({
      model: backend.model,
      temperature: 0.2,
      messages: [{ role: 'user', content: context }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenAI ask request failed (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const payload = (await response.json()) as unknown;
  const text = extractOpenAiText(payload);
  if (!text) {
    throw new Error('OpenAI ask request returned no text content');
  }

  writeAssistantText(text);
  return text.trim();
}

/**
 * Handle ask command
 * AI response is already streamed to stdout during execution
 * This just shows sources and metadata on stderr
 */
export async function handleAskCommand(
  container: IContainer,
  options: AskOptions
): Promise<void> {
  const result = await executeAsk(container, options);

  if (!result.success) {
    console.error(fmt.error(`${icons.error} ${result.error}`));
    process.exitCode = 1;
    return;
  }

  if (!result.data) {
    console.error(fmt.error(`${icons.error} No data returned`));
    process.exitCode = 1;
    return;
  }

  const summaryParts = [
    `full docs used: ${result.data.fullDocumentsUsed}`,
    `chunks used: ${result.data.chunksUsed}`,
    `sources: ${result.data.sources.length}`,
    `unique source urls: ${result.data.uniqueSourceUrls}`,
    `candidates: scoped ${result.data.candidateChunks}/${result.data.rawCandidateChunks}`,
    `fallback used: ${result.data.scopeFallback ? 'yes' : 'no'}`,
    `response took: ${result.data.responseDurationSeconds.toFixed(2)}s`,
  ];
  if (result.data.appliedScope) {
    summaryParts.push(
      `scope: ${result.data.appliedScope}${result.data.scopeFallback ? ' (fallback: unscoped)' : ''}`
    );
  }
  if (options.diagnostics) {
    summaryParts.push(
      `scope candidates: ${result.data.scopedCandidateChunks}`,
      `strict scope: ${result.data.scopeStrict ? 'yes' : 'no'}`
    );
    summaryParts.push(
      `context: ${result.data.contextCharsUsed}/${result.data.contextCharsLimit} chars`
    );
  }

  const headerFilters: Record<string, unknown> = {
    domain: options.domain,
    collection: options.collection,
    model: options.model,
    limit: options.limit,
    fullDocs: options.fullDocs,
    backfillChunks: options.backfillChunks,
    maxContext: options.maxContext,
  };

  // AI response was already streamed to stdout during executeAsk
  // Now show sources and metadata on stderr
  // Ensure Ask Sources starts on a fresh line even when the streamed response
  // does not end with a newline.
  process.stdout.write('\n\n');
  console.error(
    fmt.bold(
      `${askAccent('Ask Sources:')} ${fmt.primary(`"${result.data.query}"`)}`
    )
  );
  const summaryColorized = [
    `${askAccent('Docs:')} ${fmt.primary(String(result.data.fullDocumentsUsed))}`,
    `${askAccent('Chunks:')} ${fmt.primary(String(result.data.chunksUsed))}`,
    `${askAccent('Sources:')} ${fmt.primary(String(result.data.sources.length))}`,
    `${askAccent('URLs:')} ${fmt.primary(String(result.data.uniqueSourceUrls))}`,
    `${askAccent('Candidates:')} ${fmt.primary(String(result.data.candidateChunks))}`,
    `${askAccent('Response Time:')} ${fmt.primary(`${result.data.responseDurationSeconds.toFixed(2)}s`)}`,
  ];
  if (result.data.appliedScope) {
    summaryColorized.push(
      `${askAccent('Scope:')} ${fmt.primary(`${result.data.appliedScope}${result.data.scopeFallback ? ' (fallback: unscoped)' : ''}`)}`
    );
  }
  if (options.diagnostics) {
    summaryColorized.push(
      `${askAccent('Scope Candidates:')} ${fmt.primary(String(result.data.scopedCandidateChunks))}`
    );
    summaryColorized.push(
      `${askAccent('Strict Scope:')} ${fmt.primary(result.data.scopeStrict ? 'yes' : 'no')}`
    );
    summaryColorized.push(
      `${askAccent('Context:')} ${fmt.primary(`${result.data.contextCharsUsed}/${result.data.contextCharsLimit}`)} ${askAccent('chars')}`
    );
    summaryColorized.push(
      `${askAccent('Fallback:')} ${fmt.primary(result.data.scopeFallback ? 'yes' : 'no')}`
    );
  }
  console.error(`  ${summaryColorized.join(` ${fmt.dim('|')} `)}`);

  const activeFilters = Object.entries(headerFilters)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) => `${askAccent(`${key}=`)}${fmt.primary(String(value))}`
    );
  if (activeFilters.length > 0) {
    console.error(
      `  ${askAccent('Filters:')} ${activeFilters.join(` ${fmt.dim('|')} `)}`
    );
  }
  const asOf = formatAsOfEst();
  const [asOfTime, asOfDate] = asOf.split('|').map((part) => part.trim());
  const asOfValue = [
    fmt.primary(asOfTime || ''),
    fmt.dim('|'),
    fmt.primary(asOfDate || ''),
  ]
    .filter((segment) => segment.length > 0)
    .join(' ');
  console.error(`  ${askAccent('As of (ET):')} ${asOfValue}`);
  console.error('');

  console.error(
    `  ${askAccent('Ordering:')} ${fmt.primary('Reranked')} ${fmt.dim('|')} ${askAccent('Raw:')} ${fmt.primary('Vector Similarity')}`
  );
  if (result.data.scopeFallback) {
    console.error(
      `  ${fmt.warning(`${icons.warning} Temporal scope had no direct matches; used unscoped fallback`)}`
    );
  }
  console.error('');
  const terminalWidth = process.stderr.columns ?? 120;
  const fixedWidths = 4 + 5; // Rank + Raw
  const spacing = 2 * 3; // gaps between 4 columns
  const contentWidth = terminalWidth - fixedWidths - spacing;

  const sourcesToShow = options.diagnostics
    ? result.data.sources
    : result.data.sources.slice(0, DEFAULT_SOURCES_PREVIEW_COUNT);
  const hiddenSources = Math.max(
    result.data.sources.length - sourcesToShow.length,
    0
  );

  if (contentWidth < 48) {
    for (let i = 0; i < sourcesToShow.length; i++) {
      const source = sourcesToShow[i];
      const rank = i + 1;
      const raw = source.score.toFixed(2);
      const url = truncateWithEllipsis(
        source.url,
        Math.max(24, terminalWidth - 18)
      );
      const title = truncateWithEllipsis(
        source.title || '—',
        Math.max(16, terminalWidth - 10)
      );
      console.error(
        `  ${fmt.primary(String(rank))}. [${fmt.primary(raw)}] ${askAccent(url)}`
      );
      console.error(`     ${fmt.primary(title)}`);
    }
  } else {
    const urlWidth = Math.max(28, Math.floor(contentWidth * 0.68));
    const titleWidth = Math.max(16, contentWidth - urlWidth);
    const rows = sourcesToShow.map((source, index) => ({
      rank: String(index + 1),
      raw: source.score.toFixed(2),
      url: truncateWithEllipsis(source.url, urlWidth),
      title: truncateWithEllipsis(source.title || '—', titleWidth),
    }));
    console.error(renderAskSourcesTable(rows, urlWidth, titleWidth));
  }
  if (hiddenSources > 0) {
    console.error(
      `  ${fmt.dim(`… ${hiddenSources} more source${hiddenSources === 1 ? '' : 's'} (use --diagnostics to show all)`)}`
    );
  }
  console.error('');
  console.error(`  ${askAccent('Next:')}`);
  console.error(
    `    ${fmt.primary(`${icons.arrow} Inspect a source document with: axon retrieve <url>`)}`
  );
}

/**
 * Create ask command
 */
export function createAskCommand(): Command {
  const settings = getSettings();

  const askCmd = new Command('ask')
    .description(
      'Ask a question about your embedded documents (ASK_CLI or OpenAI-compatible fallback)'
    )
    .argument('<query>', 'Question to ask about your documents')
    .option(
      '--limit <number>',
      'Maximum number of relevant chunks to include (default: 10)',
      (val) => Number.parseInt(val, 10),
      settings.ask.limit
    )
    .option(
      '--full-docs <number>',
      'Number of top sources to retrieve as full documents (default: settings.ask.fullDocs, fallback 5)',
      (val) => Number.parseInt(val, 10),
      settings.ask.fullDocs
    )
    .option(
      '--backfill-chunks <number>',
      'Number of supplemental chunks to backfill from non-full-doc URLs (default: settings.ask.backfillChunks, fallback 3)',
      (val) => Number.parseInt(val, 10),
      settings.ask.backfillChunks
    )
    .option('--domain <domain>', 'Filter results by domain')
    .option('--collection <name>', 'Qdrant collection name (default: axon)')
    .option(
      '--model <name>',
      'Model for CLI mode (e.g. opus/sonnet/haiku or gemini-3-*-preview). Backend precedence: --model, ASK_CLI, then OPENAI_BASE_URL + OPENAI_API_KEY + OPENAI_MODEL.'
    )
    .option(
      '--max-context <chars>',
      'Maximum context size in characters (default: 250000)',
      (val) => Number.parseInt(val, 10)
    )
    .option(
      '--diagnostics',
      'Show retrieval/context diagnostics in Ask Sources summary'
    )
    .action(async (query: string, options, command: Command) => {
      const container = requireContainer(command);

      await handleAskCommand(container, {
        query,
        limit: options.limit,
        fullDocs: options.fullDocs,
        backfillChunks: options.backfillChunks,
        domain: options.domain,
        collection: options.collection,
        model: options.model,
        maxContext: options.maxContext,
        diagnostics: options.diagnostics,
      });
    });

  return askCmd;
}
