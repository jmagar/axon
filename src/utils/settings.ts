/**
 * User settings utility
 * Stores persistent user settings in the unified Firecrawl home directory.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type EffectiveUserSettings,
  type UserSettings,
  UserSettingsSchema,
} from '../schemas/storage';
import {
  getConfigDirectoryPath,
  migrateLegacyJsonFile,
  parseJsonWithSchema,
} from './credentials';
import { mergeWithDefaults } from './default-settings';
import { getSettingsPath as getUnifiedSettingsPath } from './storage-paths';
import { fmt } from './theme';

export type { EffectiveUserSettings, UserSettings };

type ParsedLegacySettings =
  | { kind: 'valid'; data: UserSettings }
  | { kind: 'invalid' };

let migrationDone = false;
let settingsCache: EffectiveUserSettings | null = null;
let settingsCacheMtimeMs = -1;

function getSettingsPath(): string {
  return getUnifiedSettingsPath();
}

function getLegacySettingsPaths(): string[] {
  const homeDir = os.homedir();
  return [
    path.join(
      homeDir,
      'Library',
      'Application Support',
      'firecrawl-cli',
      'settings.json'
    ),
    path.join(homeDir, 'AppData', 'Roaming', 'firecrawl-cli', 'settings.json'),
    path.join(homeDir, '.config', 'firecrawl-cli', 'settings.json'),
  ];
}

function ensureConfigDir(): void {
  const configDir = getConfigDirectoryPath();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

function setSecurePermissions(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore on unsupported platforms.
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergePersistedSettings(
  base: UserSettings,
  update: Partial<UserSettings>
): UserSettings {
  const result: UserSettings = { ...base, ...update };

  const nestedKeys: Array<
    | 'crawl'
    | 'scrape'
    | 'map'
    | 'search'
    | 'extract'
    | 'batch'
    | 'ask'
    | 'http'
    | 'chunking'
    | 'embedding'
    | 'polling'
  > = [
    'crawl',
    'scrape',
    'map',
    'search',
    'extract',
    'batch',
    'ask',
    'http',
    'chunking',
    'embedding',
    'polling',
  ];

  for (const key of nestedKeys) {
    const baseValue = base[key];
    const updateValue = update[key];
    if (isObjectRecord(baseValue) && isObjectRecord(updateValue)) {
      (result as Record<string, unknown>)[key] = {
        ...baseValue,
        ...updateValue,
      };
    }
  }

  return result;
}

function writeValidatedSettings(
  settingsPath: string,
  settings: UserSettings
): void {
  const validated = UserSettingsSchema.safeParse(settings);
  if (!validated.success) {
    throw new Error(`Settings validation failed: ${validated.error.message}`);
  }

  fs.writeFileSync(
    settingsPath,
    JSON.stringify(validated.data, null, 2),
    'utf-8'
  );
  setSecurePermissions(settingsPath);
}

/**
 * Ensure settings file exists with valid default values.
 *
 * KNOWN LIMITATION (#89): TOCTOU race condition possible if multiple CLI processes
 * run simultaneously during initialization. This is acceptable for a single-user CLI
 * where concurrent execution is rare.
 *
 * Potential races:
 * 1. File creation: Multiple processes may create defaults simultaneously
 * 2. Backup creation: Timestamp-based backups may be overwritten
 * 3. Migration writes: Concurrent normalizations may interleave
 *
 * Impact: Benign - all operations are writing similar valid data. Settings are
 * re-loaded from disk on each access with mtime-based cache invalidation.
 */
function ensureSettingsFileMaterialized(): void {
  const settingsPath = getSettingsPath();

  try {
    ensureConfigDir();
    const defaults = mergeWithDefaults({});

    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(defaults, null, 2),
        'utf-8'
      );
      setSecurePermissions(settingsPath);
      return;
    }

    const raw = fs.readFileSync(settingsPath, 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fs.copyFileSync(
        settingsPath,
        `${settingsPath}.invalid-backup-${Date.now()}`
      );
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(defaults, null, 2),
        'utf-8'
      );
      setSecurePermissions(settingsPath);
      return;
    }

    const validation = UserSettingsSchema.safeParse(parsed);
    if (!validation.success) {
      fs.copyFileSync(
        settingsPath,
        `${settingsPath}.invalid-backup-${Date.now()}`
      );
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(defaults, null, 2),
        'utf-8'
      );
      setSecurePermissions(settingsPath);
      return;
    }

    const merged = mergeWithDefaults(validation.data);
    const currentNormalized = JSON.stringify(validation.data);
    const mergedNormalized = JSON.stringify(merged);

    if (currentNormalized !== mergedNormalized) {
      fs.copyFileSync(settingsPath, `${settingsPath}.backup-${Date.now()}`);
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
      setSecurePermissions(settingsPath);
    }
  } catch (error) {
    console.error(
      fmt.warning(`Could not initialize/normalize settings: ${String(error)}`)
    );
  }
}

/**
 * Migrate settings from legacy paths to FIRECRAWL_HOME path.
 *
 * KNOWN LIMITATION (#89): TOCTOU race condition possible if multiple CLI processes
 * run simultaneously during migration. This is acceptable for a single-user CLI tool
 * where concurrent execution during first-time setup is extremely rare.
 *
 * Potential race:
 * - Process A: checks newPath doesn't exist
 * - Process B: checks newPath doesn't exist
 * - Process A: writes settings (wx flag ensures exclusive create)
 * - Process B: writes settings (EEXIST error caught and ignored)
 *
 * Impact: Benign - 'wx' flag ensures only one process wins the race. The loser
 * receives EEXIST which is caught and ignored. Both processes write the same data
 * from legacy source. Migration is idempotent and only runs once per process lifetime.
 */
function migrateLegacySettings(): void {
  if (migrationDone) {
    return;
  }

  const newPath = getSettingsPath();
  const parseAndValidateLegacySettings = (
    raw: string
  ): ParsedLegacySettings => {
    const parsed = parseJsonWithSchema(raw, UserSettingsSchema);
    return parsed.kind === 'valid'
      ? { kind: 'valid', data: parsed.data }
      : { kind: 'invalid' };
  };

  const result = migrateLegacyJsonFile<UserSettings>({
    legacyPaths: getLegacySettingsPaths(),
    targetPath: newPath,
    ensureTargetDir: ensureConfigDir,
    parseAndValidate: parseAndValidateLegacySettings,
    writeMode: 'exclusive',
  });

  if (result.status === 'migrated') {
    setSecurePermissions(newPath);
    console.error(
      fmt.dim(
        `[Settings] Migrated settings from ${result.sourcePath} to ${newPath}`
      )
    );
  }

  migrationDone = true;
}

/**
 * Load persisted settings from disk.
 */
export function loadSettings(): UserSettings {
  try {
    migrateLegacySettings();
    ensureSettingsFileMaterialized();

    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return {};
    }

    const data = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(data);
    const result = UserSettingsSchema.safeParse(parsed);
    if (!result.success) {
      console.error(
        fmt.error(`[Settings] Invalid settings file: ${result.error.message}`)
      );
      return {};
    }

    return result.data;
  } catch {
    return {};
  }
}

/**
 * Get complete effective settings (persisted values + defaults).
 */
export function getSettings(): EffectiveUserSettings {
  const settingsPath = getSettingsPath();
  const mtimeMs = fs.existsSync(settingsPath)
    ? fs.statSync(settingsPath).mtimeMs
    : -1;

  if (settingsCache && settingsCacheMtimeMs === mtimeMs) {
    return settingsCache;
  }

  const merged = mergeWithDefaults(loadSettings());
  settingsCache = merged;
  settingsCacheMtimeMs = mtimeMs;
  return merged;
}

/**
 * Save settings to disk (deep-merges with existing persisted settings).
 */
export function saveSettings(settings: Partial<UserSettings>): void {
  try {
    ensureConfigDir();
    const existing = loadSettings();
    const merged = mergePersistedSettings(existing, settings);
    const settingsPath = getSettingsPath();
    writeValidatedSettings(settingsPath, merged);

    settingsCache = null;
    settingsCacheMtimeMs = -1;
  } catch (error) {
    throw new Error(
      `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Clear a specific top-level setting key.
 */
export function clearSetting(key: keyof UserSettings): void {
  try {
    const existing = loadSettings();
    delete existing[key];
    const settingsPath = getSettingsPath();

    if (Object.keys(existing).length === 0) {
      if (fs.existsSync(settingsPath)) {
        fs.unlinkSync(settingsPath);
      }
      settingsCache = null;
      settingsCacheMtimeMs = -1;
      return;
    }

    ensureConfigDir();
    writeValidatedSettings(settingsPath, existing);
    settingsCache = null;
    settingsCacheMtimeMs = -1;
  } catch (error) {
    throw new Error(
      `Failed to clear setting: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Test helper to reset module state between tests.
 */
export function __resetSettingsStateForTests(): void {
  migrationDone = false;
  settingsCache = null;
  settingsCacheMtimeMs = -1;
}
