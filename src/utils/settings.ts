/**
 * User settings utility
 * Stores persistent user settings in the unified Axon home directory.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
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
  const homeDir = homedir();
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
  // mkdirSync with recursive:true is idempotent — no-op when dir exists,
  // avoiding the TOCTOU race of existsSync + mkdirSync.
  fs.mkdirSync(getConfigDirectoryPath(), { recursive: true, mode: 0o700 });
}

/**
 * SEC-14: Platform-aware secure permissions.
 * Only suppresses on Windows; logs failures on POSIX systems.
 */
function setSecurePermissions(filePath: string): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    console.error(
      `Warning: Could not set secure permissions on ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
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

  writeSettingsFileAtomically(
    settingsPath,
    JSON.stringify(validated.data, null, 2)
  );
}

function writeSettingsFileAtomically(
  settingsPath: string,
  content: string
): void {
  const tempPath = `${settingsPath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;

  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf-8', flag: 'wx' });
    setSecurePermissions(tempPath);
    fs.renameSync(tempPath, settingsPath);
    setSecurePermissions(settingsPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (unlinkError) {
      if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw unlinkError;
      }
    }
    throw error;
  }
}

type SettingsValidationResult =
  | { kind: 'valid'; data: UserSettings }
  | { kind: 'invalid' };

function parseAndValidateSettings(raw: string): SettingsValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid' };
  }

  const validation = UserSettingsSchema.safeParse(parsed);
  if (!validation.success) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', data: validation.data };
}

/**
 * Ensure settings file exists with valid default values.
 *
 * Initialization uses direct file operations and exclusive create (`flag: 'wx'`)
 * when materializing defaults to reduce cross-process race windows.
 */
function ensureSettingsFileMaterialized(): void {
  const settingsPath = getSettingsPath();

  try {
    ensureConfigDir();
    const defaults = mergeWithDefaults({});

    let raw: string;
    try {
      raw = fs.readFileSync(settingsPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      try {
        fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), {
          encoding: 'utf-8',
          flag: 'wx',
        });
        setSecurePermissions(settingsPath);
        return;
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw writeError;
        }
        raw = fs.readFileSync(settingsPath, 'utf-8');
      }
    }

    let validation = parseAndValidateSettings(raw);
    if (validation.kind === 'invalid') {
      // Retry once to avoid false-positive invalid backups caused by
      // cross-process read/write races.
      const retriedRaw = fs.readFileSync(settingsPath, 'utf-8');
      validation = parseAndValidateSettings(retriedRaw);
    }

    if (validation.kind === 'invalid') {
      fs.copyFileSync(
        settingsPath,
        `${settingsPath}.invalid-backup-${randomBytes(8).toString('hex')}`
      );
      writeSettingsFileAtomically(
        settingsPath,
        JSON.stringify(defaults, null, 2)
      );
      return;
    }

    const merged = mergeWithDefaults(validation.data);
    if (!isDeepStrictEqual(validation.data, merged)) {
      fs.copyFileSync(settingsPath, `${settingsPath}.backup-${Date.now()}`);
      writeSettingsFileAtomically(
        settingsPath,
        JSON.stringify(merged, null, 2)
      );
    }
  } catch (error) {
    console.error(
      fmt.warning(`Could not initialize/normalize settings: ${String(error)}`)
    );
  }
}

/**
 * Migrate settings from legacy paths to AXON_HOME path.
 *
 * Migration uses exclusive create (`flag: 'wx'`) through the shared migration helper
 * to avoid overwrite races if multiple processes bootstrap simultaneously.
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
    let data: string;
    try {
      data = fs.readFileSync(settingsPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }

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
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(settingsPath).mtimeMs;
  } catch {
    mtimeMs = -1;
  }

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
      // Avoid TOCTOU: just attempt unlink and ignore ENOENT
      try {
        fs.unlinkSync(settingsPath);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw unlinkError;
        }
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
