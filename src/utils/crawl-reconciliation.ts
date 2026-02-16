/**
 * Crawl reconciliation state for safe stale-document cleanup.
 *
 * Tracks previously seen URLs per domain and identifies URLs that should be
 * deleted when they remain missing across consecutive successful crawls.
 */

import { promises as fs } from 'node:fs';
import type { Document } from '@mendable/firecrawl-js';
import { getStoragePath, getStorageRoot } from './storage-paths';

export const DEFAULT_MISSING_THRESHOLD = 2;
export const DEFAULT_MISSING_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

interface TrackedUrlState {
  url: string;
  lastSeenAt: string;
  missingConsecutive: number;
  firstMissingAt?: string;
  lastMissingAt?: string;
}

interface DomainState {
  urls: Record<string, TrackedUrlState>;
}

interface ReconciliationStore {
  version: 1;
  domains: Record<string, DomainState>;
}

export interface ReconcileCrawlDomainOptions {
  domain: string;
  seenUrls: string[];
  hardSync?: boolean;
  dryRun?: boolean;
  missingThreshold?: number;
  gracePeriodMs?: number;
  now?: Date;
}

export interface ReconcileCrawlDomainResult {
  urlsToDelete: string[];
  trackedBefore: number;
  trackedAfter: number;
  seen: number;
}

export interface ReconciliationMissingRecord {
  url: string;
  missingConsecutive: number;
  firstMissingAt?: string;
  lastMissingAt?: string;
  missingAgeMs?: number;
  eligibleOnNextRun: boolean;
}

export interface ReconciliationDomainStatus {
  domain: string;
  trackedUrls: number;
  missingUrls: number;
  eligibleForDeleteNow: number;
  missingRecords: ReconciliationMissingRecord[];
}

export interface ResetReconciliationResult {
  removedDomains: number;
  removedUrls: number;
}

const STORE_VERSION = 1;
let reconciliationLock: Promise<void> = Promise.resolve();

function getStorePath(): string {
  return getStoragePath('crawl-reconciliation.json');
}

async function ensureStorageDir(): Promise<void> {
  await fs.mkdir(getStorageRoot(), { recursive: true, mode: 0o700 });
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function normalizeHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function toValidIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function sanitizeStore(input: unknown): ReconciliationStore {
  if (typeof input !== 'object' || input === null) {
    return { version: STORE_VERSION, domains: {} };
  }

  const obj = input as { version?: unknown; domains?: unknown };
  const domains: Record<string, DomainState> = {};

  if (typeof obj.domains === 'object' && obj.domains !== null) {
    for (const [rawDomain, rawState] of Object.entries(obj.domains)) {
      if (typeof rawState !== 'object' || rawState === null) continue;
      const domain = normalizeDomain(rawDomain);
      const candidateUrls = (rawState as { urls?: unknown }).urls;
      if (typeof candidateUrls !== 'object' || candidateUrls === null) continue;

      const urls: Record<string, TrackedUrlState> = {};
      for (const [rawUrl, rawUrlState] of Object.entries(candidateUrls)) {
        if (typeof rawUrlState !== 'object' || rawUrlState === null) continue;
        const normalizedUrl = normalizeHttpUrl(rawUrl);
        if (!normalizedUrl) continue;

        const state = rawUrlState as {
          lastSeenAt?: unknown;
          missingConsecutive?: unknown;
          firstMissingAt?: unknown;
          lastMissingAt?: unknown;
        };
        const lastSeenAt = toValidIso(state.lastSeenAt);
        if (!lastSeenAt) continue;

        const missingConsecutive =
          typeof state.missingConsecutive === 'number' &&
          Number.isFinite(state.missingConsecutive) &&
          state.missingConsecutive >= 0
            ? Math.floor(state.missingConsecutive)
            : 0;

        urls[normalizedUrl] = {
          url: normalizedUrl,
          lastSeenAt,
          missingConsecutive,
          firstMissingAt: toValidIso(state.firstMissingAt),
          lastMissingAt: toValidIso(state.lastMissingAt),
        };
      }

      if (Object.keys(urls).length > 0) {
        domains[domain] = { urls };
      }
    }
  }

  return {
    version:
      typeof obj.version === 'number' && obj.version === STORE_VERSION
        ? STORE_VERSION
        : STORE_VERSION,
    domains,
  };
}

async function loadStore(): Promise<ReconciliationStore> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf-8');
    return sanitizeStore(JSON.parse(raw));
  } catch {
    return { version: STORE_VERSION, domains: {} };
  }
}

async function saveStore(store: ReconciliationStore): Promise<void> {
  await ensureStorageDir();
  const targetPath = getStorePath();
  const tempPath = `${targetPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2));
  await fs.rename(tempPath, targetPath);
}

async function withReconciliationLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = reconciliationLock;
  let release: () => void = () => {};
  reconciliationLock = new Promise((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

export function getDomainFromUrl(url: string): string | undefined {
  const normalized = normalizeHttpUrl(url);
  if (!normalized) return undefined;
  try {
    return normalizeDomain(new URL(normalized).hostname);
  } catch {
    return undefined;
  }
}

export function collectCrawlPageUrls(pages: Document[]): string[] {
  const urls = new Set<string>();
  for (const page of pages) {
    const source = page.metadata?.sourceURL ?? page.metadata?.url;
    if (typeof source !== 'string') continue;
    const normalized = normalizeHttpUrl(source);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

export async function reconcileCrawlDomainState(
  options: ReconcileCrawlDomainOptions
): Promise<ReconcileCrawlDomainResult> {
  const domain = normalizeDomain(options.domain);
  if (!domain) {
    return { urlsToDelete: [], trackedBefore: 0, trackedAfter: 0, seen: 0 };
  }

  const uniqueSeen = new Set(
    options.seenUrls
      .map((url) => normalizeHttpUrl(url))
      .filter((url): url is string => Boolean(url))
  );
  if (uniqueSeen.size === 0) {
    return { urlsToDelete: [], trackedBefore: 0, trackedAfter: 0, seen: 0 };
  }

  const hardSync = options.hardSync === true;
  const dryRun = options.dryRun === true;
  const missingThreshold = Math.max(
    1,
    Math.floor(options.missingThreshold ?? DEFAULT_MISSING_THRESHOLD)
  );
  const gracePeriodMs = Math.max(
    0,
    options.gracePeriodMs ?? DEFAULT_MISSING_GRACE_MS
  );
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  return withReconciliationLock(async () => {
    const store = await loadStore();
    const domainState = store.domains[domain] ?? { urls: {} };
    const trackedBefore = Object.keys(domainState.urls).length;

    for (const seenUrl of uniqueSeen) {
      domainState.urls[seenUrl] = {
        url: seenUrl,
        lastSeenAt: nowIso,
        missingConsecutive: 0,
      };
    }

    const urlsToDelete: string[] = [];
    for (const [url, state] of Object.entries(domainState.urls)) {
      if (uniqueSeen.has(url)) {
        continue;
      }

      if (hardSync) {
        urlsToDelete.push(url);
        delete domainState.urls[url];
        continue;
      }

      const firstMissingAt = state.firstMissingAt ?? nowIso;
      const nextMissingCount = state.missingConsecutive + 1;
      const missingAgeMs = now.getTime() - Date.parse(firstMissingAt);

      if (
        nextMissingCount >= missingThreshold &&
        missingAgeMs >= gracePeriodMs
      ) {
        urlsToDelete.push(url);
        delete domainState.urls[url];
      } else {
        domainState.urls[url] = {
          ...state,
          missingConsecutive: nextMissingCount,
          firstMissingAt,
          lastMissingAt: nowIso,
        };
      }
    }

    if (!dryRun) {
      if (Object.keys(domainState.urls).length > 0) {
        store.domains[domain] = domainState;
      } else {
        delete store.domains[domain];
      }
      await saveStore(store);
    }

    return {
      urlsToDelete,
      trackedBefore,
      trackedAfter: Object.keys(domainState.urls).length,
      seen: uniqueSeen.size,
    };
  });
}

function buildDomainStatus(
  domain: string,
  state: DomainState,
  now: Date,
  missingThreshold: number,
  gracePeriodMs: number
): ReconciliationDomainStatus {
  const missingRecords: ReconciliationMissingRecord[] = [];

  for (const urlState of Object.values(state.urls)) {
    if (urlState.missingConsecutive <= 0) continue;
    const firstMissingAtMs = urlState.firstMissingAt
      ? Date.parse(urlState.firstMissingAt)
      : NaN;
    const missingAgeMs = Number.isNaN(firstMissingAtMs)
      ? undefined
      : now.getTime() - firstMissingAtMs;
    const eligibleOnNextRun =
      urlState.missingConsecutive + 1 >= missingThreshold &&
      (missingAgeMs ?? 0) >= gracePeriodMs;

    missingRecords.push({
      url: urlState.url,
      missingConsecutive: urlState.missingConsecutive,
      firstMissingAt: urlState.firstMissingAt,
      lastMissingAt: urlState.lastMissingAt,
      missingAgeMs,
      eligibleOnNextRun,
    });
  }

  missingRecords.sort((a, b) => b.missingConsecutive - a.missingConsecutive);

  return {
    domain,
    trackedUrls: Object.keys(state.urls).length,
    missingUrls: missingRecords.length,
    eligibleForDeleteNow: missingRecords.filter((r) => r.eligibleOnNextRun)
      .length,
    missingRecords,
  };
}

export async function listReconciliationStatus(options?: {
  domain?: string;
  now?: Date;
  missingThreshold?: number;
  gracePeriodMs?: number;
}): Promise<ReconciliationDomainStatus[]> {
  const domainFilter = options?.domain
    ? normalizeDomain(options.domain)
    : undefined;
  const missingThreshold = Math.max(
    1,
    Math.floor(options?.missingThreshold ?? DEFAULT_MISSING_THRESHOLD)
  );
  const gracePeriodMs = Math.max(
    0,
    options?.gracePeriodMs ?? DEFAULT_MISSING_GRACE_MS
  );
  const now = options?.now ?? new Date();

  const store = await loadStore();
  const statuses: ReconciliationDomainStatus[] = [];

  for (const [domain, state] of Object.entries(store.domains)) {
    if (domainFilter && domain !== domainFilter) continue;
    statuses.push(
      buildDomainStatus(domain, state, now, missingThreshold, gracePeriodMs)
    );
  }

  statuses.sort((a, b) => a.domain.localeCompare(b.domain));
  return statuses;
}

export async function resetReconciliationState(
  domain?: string
): Promise<ResetReconciliationResult> {
  const normalized = domain ? normalizeDomain(domain) : undefined;
  return withReconciliationLock(async () => {
    const store = await loadStore();
    let removedDomains = 0;
    let removedUrls = 0;

    if (normalized) {
      const existing = store.domains[normalized];
      if (existing) {
        removedDomains = 1;
        removedUrls = Object.keys(existing.urls).length;
        delete store.domains[normalized];
      }
    } else {
      removedDomains = Object.keys(store.domains).length;
      removedUrls = Object.values(store.domains).reduce(
        (sum, item) => sum + Object.keys(item.urls).length,
        0
      );
      store.domains = {};
    }

    await saveStore(store);
    return { removedDomains, removedUrls };
  });
}
