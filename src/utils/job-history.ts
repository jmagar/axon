/**
 * Local job history for status auto-suggestions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type JobType = 'crawl' | 'batch' | 'extract';

interface JobHistoryEntry {
  id: string;
  updatedAt: string;
}

interface JobHistoryData {
  crawl: JobHistoryEntry[];
  batch: JobHistoryEntry[];
  extract: JobHistoryEntry[];
}

const HISTORY_DIR = join(process.cwd(), '.cache');
const HISTORY_PATH = join(HISTORY_DIR, 'job-history.json');
const MAX_ENTRIES = 20;

function ensureHistoryDir(): void {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function loadHistory(): JobHistoryData {
  if (!existsSync(HISTORY_PATH)) {
    return { crawl: [], batch: [], extract: [] };
  }

  try {
    const data = readFileSync(HISTORY_PATH, 'utf-8');
    const parsed = JSON.parse(data) as Partial<JobHistoryData>;
    return {
      crawl: parsed.crawl ?? [],
      batch: parsed.batch ?? [],
      extract: parsed.extract ?? [],
    };
  } catch {
    return { crawl: [], batch: [], extract: [] };
  }
}

function saveHistory(history: JobHistoryData): void {
  ensureHistoryDir();
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

export function recordJob(type: JobType, id: string): void {
  if (!id) return;

  const history = loadHistory();
  const list = history[type];
  const now = new Date().toISOString();

  const filtered = list.filter((entry) => entry.id !== id);
  filtered.unshift({ id, updatedAt: now });
  history[type] = filtered.slice(0, MAX_ENTRIES);

  saveHistory(history);
}

export function getRecentJobIds(type: JobType, limit = 5): string[] {
  const history = loadHistory();
  return history[type].slice(0, limit).map((entry) => entry.id);
}

export function removeJobIds(type: JobType, ids: string[]): void {
  if (ids.length === 0) return;
  const history = loadHistory();
  history[type] = history[type].filter((entry) => !ids.includes(entry.id));
  saveHistory(history);
}

export function clearJobHistory(): void {
  saveHistory({ crawl: [], batch: [], extract: [] });
}
