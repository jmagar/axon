/**
 * Local job history for status auto-suggestions
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getJobHistoryPath, getStorageRoot } from './storage-paths';
import { fmt } from './theme';

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

const MAX_ENTRIES = 20;

/**
 * Get legacy cache directory path for migration
 */
function getLegacyCachePath(): string {
  return join(process.cwd(), '.cache', 'job-history.json');
}

function getLegacyDataPath(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return join(xdgDataHome, 'firecrawl-cli', 'job-history.json');
  }

  const home = homedir();
  const platform = process.platform;
  if (platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    return join(appData, 'firecrawl-cli', 'job-history.json');
  }
  if (platform === 'darwin') {
    return join(
      home,
      'Library',
      'Application Support',
      'firecrawl-cli',
      'job-history.json'
    );
  }
  return join(home, '.local', 'share', 'firecrawl-cli', 'job-history.json');
}

const HISTORY_DIR = getStorageRoot();
const HISTORY_PATH = getJobHistoryPath();

async function ensureHistoryDir(): Promise<void> {
  await fs.mkdir(HISTORY_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Migrate job history from legacy cache directory if it exists
 */
async function migrateLegacyHistory(): Promise<void> {
  // Skip if already migrated (idempotency check)
  try {
    await fs.readFile(HISTORY_PATH, 'utf-8');
    return; // Already migrated
  } catch {
    // HISTORY_PATH doesn't exist, proceed with migration
  }

  const legacyPaths = [getLegacyDataPath(), getLegacyCachePath()];
  for (const legacyPath of legacyPaths) {
    try {
      const legacyData = await fs.readFile(legacyPath, 'utf-8');
      // Validate the data is valid JSON before migrating
      JSON.parse(legacyData);

      await ensureHistoryDir();
      await fs.writeFile(HISTORY_PATH, legacyData);

      console.error(
        fmt.dim(`[Job History] Migrated from ${legacyPath} to ${HISTORY_PATH}`)
      );
      return;
    } catch {
      // Continue checking additional legacy paths
    }
  }
}

async function loadHistory(): Promise<JobHistoryData> {
  // Attempt migration first (idempotent)
  await migrateLegacyHistory();

  try {
    const data = await fs.readFile(HISTORY_PATH, 'utf-8');
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

async function saveHistory(history: JobHistoryData): Promise<void> {
  await ensureHistoryDir();
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
}

export async function recordJob(type: JobType, id: string): Promise<void> {
  if (!id) return;

  const history = await loadHistory();
  const list = history[type];
  const now = new Date().toISOString();

  const filtered = list.filter((entry) => entry.id !== id);
  filtered.unshift({ id, updatedAt: now });
  history[type] = filtered.slice(0, MAX_ENTRIES);

  await saveHistory(history);
}

export async function getRecentJobIds(
  type: JobType,
  limit = 5
): Promise<string[]> {
  const history = await loadHistory();
  return history[type].slice(0, limit).map((entry) => entry.id);
}

export async function removeJobIds(
  type: JobType,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const history = await loadHistory();
  history[type] = history[type].filter((entry) => !ids.includes(entry.id));
  await saveHistory(history);
}

export async function clearJobHistory(): Promise<void> {
  await saveHistory({ crawl: [], batch: [], extract: [] });
}

export async function clearJobTypeHistory(type: JobType): Promise<void> {
  const history = await loadHistory();
  history[type] = [];
  await saveHistory(history);
}
