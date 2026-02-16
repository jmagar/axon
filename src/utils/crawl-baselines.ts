/**
 * Crawl preflight map baselines.
 *
 * Stores expected URL counts from preflight map runs keyed by crawl job ID,
 * allowing status checks to detect unexpectedly low crawl discovery.
 */

import { promises as fs } from 'node:fs';
import { getStoragePath, getStorageRoot } from './storage-paths';

export interface CrawlBaselineEntry {
  jobId: string;
  url: string;
  mapCount: number;
  createdAt: string;
  sitemapRetryJobId?: string;
  sitemapRetryTriggeredAt?: string;
}

interface CrawlBaselineStore {
  entries: CrawlBaselineEntry[];
}

const MAX_BASELINES = 200;

let baselineLock: Promise<void> = Promise.resolve();

async function withBaselineLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = baselineLock;
  let release: () => void = () => {};
  baselineLock = new Promise((resolve) => {
    release = resolve;
  });

  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

function getBaselinePath(): string {
  return getStoragePath('crawl-baselines.json');
}

async function ensureStorageDir(): Promise<void> {
  await fs.mkdir(getStorageRoot(), { recursive: true, mode: 0o700 });
}

function isValidEntry(value: unknown): value is CrawlBaselineEntry {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.jobId === 'string' &&
    typeof obj.url === 'string' &&
    typeof obj.mapCount === 'number' &&
    Number.isFinite(obj.mapCount) &&
    typeof obj.createdAt === 'string' &&
    (obj.sitemapRetryJobId === undefined ||
      typeof obj.sitemapRetryJobId === 'string') &&
    (obj.sitemapRetryTriggeredAt === undefined ||
      typeof obj.sitemapRetryTriggeredAt === 'string')
  );
}

function sanitizeEntries(value: unknown): CrawlBaselineEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidEntry);
}

async function loadStore(): Promise<CrawlBaselineStore> {
  try {
    const raw = await fs.readFile(getBaselinePath(), 'utf-8');
    const parsed = JSON.parse(raw) as { entries?: unknown };
    return { entries: sanitizeEntries(parsed.entries) };
  } catch {
    return { entries: [] };
  }
}

async function saveStore(store: CrawlBaselineStore): Promise<void> {
  await ensureStorageDir();
  const targetPath = getBaselinePath();
  const tempPath = `${targetPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2));
  await fs.rename(tempPath, targetPath);
}

export async function recordCrawlBaseline(
  entry: CrawlBaselineEntry
): Promise<void> {
  if (!entry.jobId) return;
  await withBaselineLock(async () => {
    const store = await loadStore();
    const withoutExisting = store.entries.filter(
      (candidate) => candidate.jobId !== entry.jobId
    );
    withoutExisting.unshift(entry);
    store.entries = withoutExisting.slice(0, MAX_BASELINES);
    await saveStore(store);
  });
}

export async function getCrawlBaseline(
  jobId: string
): Promise<CrawlBaselineEntry | undefined> {
  if (!jobId) return undefined;
  const store = await loadStore();
  return store.entries.find((entry) => entry.jobId === jobId);
}

export async function removeCrawlBaselines(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  await withBaselineLock(async () => {
    const store = await loadStore();
    store.entries = store.entries.filter(
      (entry) => !jobIds.includes(entry.jobId)
    );
    await saveStore(store);
  });
}

export async function markSitemapRetry(
  jobId: string,
  retryJobId: string
): Promise<void> {
  if (!jobId || !retryJobId) return;
  await withBaselineLock(async () => {
    const store = await loadStore();
    const now = new Date().toISOString();
    store.entries = store.entries.map((entry) =>
      entry.jobId === jobId
        ? {
            ...entry,
            sitemapRetryJobId: retryJobId,
            sitemapRetryTriggeredAt: now,
          }
        : entry
    );
    await saveStore(store);
  });
}
