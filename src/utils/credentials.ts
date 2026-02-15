/**
 * OS-level credential storage utility
 * Stores credentials in the unified Firecrawl home directory.
 */

import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import {
  type StoredCredentials,
  StoredCredentialsSchema,
} from '../schemas/storage';
import {
  getStorageRoot,
  getCredentialsPath as getUnifiedCredentialsPath,
} from './storage-paths';
import { fmt } from './theme';

export type { StoredCredentials };

type ParsedMigrationData<T> = { kind: 'valid'; data: T } | { kind: 'invalid' };

type MigrationWriteMode = 'overwrite' | 'exclusive';

interface LegacyJsonMigrationOptions<T> {
  legacyPaths: readonly string[];
  targetPath: string;
  ensureTargetDir: () => void;
  parseAndValidate: (raw: string) => ParsedMigrationData<T>;
  writeMode?: MigrationWriteMode;
}

type LegacyJsonMigrationResult =
  | { status: 'target_exists' }
  | { status: 'migrated'; sourcePath: string }
  | { status: 'not_migrated' };

/**
 * Module-level flag to avoid repeated filesystem checks for migration
 */
let migrationDone = false;

/**
 * Legacy config directory paths (pre-FIRECRAWL_HOME unification).
 */
function getLegacyConfigDirs(): string[] {
  const homeDir = homedir();
  return [
    path.join(homeDir, 'Library', 'Application Support', 'firecrawl-cli'),
    path.join(homeDir, 'AppData', 'Roaming', 'firecrawl-cli'),
    path.join(homeDir, '.config', 'firecrawl-cli'),
  ];
}

/**
 * Get the unified storage directory.
 */
function getConfigDir(): string {
  return getStorageRoot();
}

/**
 * Get the credentials file path
 */
function getCredentialsPath(): string {
  return getUnifiedCredentialsPath();
}

function getLegacyCredentialsPaths(): string[] {
  return getLegacyConfigDirs().map((dir) => path.join(dir, 'credentials.json'));
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  // Use recursive:true directly — mkdirSync is a no-op when the directory
  // already exists, avoiding the TOCTOU race of existsSync + mkdirSync.
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 }); // rwx------
}

/**
 * Set file permissions to be readable/writable only by the owner.
 *
 * SEC-14: Only suppresses errors on Windows (which doesn't support POSIX perms).
 * On Linux/macOS, logs a warning if chmod fails.
 */
function setSecurePermissions(filePath: string): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o600); // rw-------
  } catch (error) {
    console.error(
      fmt.warning(
        `Could not set secure permissions on ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
}

export function parseJsonWithSchema<T>(
  raw: string,
  schema: {
    safeParse: (
      value: unknown
    ) => { success: true; data: T } | { success: false };
  }
): ParsedMigrationData<T> {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return { kind: 'invalid' };
    }
    return { kind: 'valid', data: result.data };
  } catch {
    return { kind: 'invalid' };
  }
}

export function migrateLegacyJsonFile<T>(
  options: LegacyJsonMigrationOptions<T>
): LegacyJsonMigrationResult {
  const writeMode = options.writeMode ?? 'overwrite';

  if (fs.existsSync(options.targetPath)) {
    return { status: 'target_exists' };
  }

  for (const legacyPath of options.legacyPaths) {
    if (!fs.existsSync(legacyPath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(legacyPath, 'utf-8');
      const candidate = options.parseAndValidate(raw);
      if (candidate.kind !== 'valid') {
        continue;
      }

      options.ensureTargetDir();
      const writeOptions =
        writeMode === 'exclusive'
          ? { encoding: 'utf-8' as const, flag: 'wx' as const }
          : ('utf-8' as const);

      fs.writeFileSync(
        options.targetPath,
        JSON.stringify(candidate.data, null, 2),
        writeOptions
      );

      return { status: 'migrated', sourcePath: legacyPath };
    } catch (error) {
      const isExclusiveCollision =
        writeMode === 'exclusive' &&
        (error as NodeJS.ErrnoException).code === 'EEXIST';
      if (isExclusiveCollision) {
        return { status: 'target_exists' };
      }
      // Ignore invalid legacy files and continue checking others
    }
  }

  return { status: 'not_migrated' };
}

/**
 * Migrate credentials from legacy paths to FIRECRAWL_HOME path.
 *
 * Migration uses exclusive creation (`flag: 'wx'`) to avoid cross-process
 * overwrite races during first-run bootstrap.
 */
function migrateLegacyCredentials(): void {
  if (migrationDone) {
    return;
  }

  const newPath = getCredentialsPath();
  const result = migrateLegacyJsonFile<StoredCredentials>({
    legacyPaths: getLegacyCredentialsPaths(),
    targetPath: newPath,
    ensureTargetDir: ensureConfigDir,
    parseAndValidate: (raw) =>
      parseJsonWithSchema(raw, StoredCredentialsSchema),
    writeMode: 'exclusive',
  });

  if (result.status === 'migrated') {
    setSecurePermissions(newPath);
    console.error(
      fmt.dim(
        `[Credentials] Migrated credentials from ${result.sourcePath} to ${newPath}`
      )
    );
  }

  migrationDone = true;
}

/**
 * Load credentials from OS storage
 */
export function loadCredentials(): StoredCredentials | null {
  try {
    migrateLegacyCredentials();
    const credentialsPath = getCredentialsPath();
    let data: string;
    try {
      data = fs.readFileSync(credentialsPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    const parsed = JSON.parse(data);

    // Validate with Zod schema for runtime type safety
    const result = StoredCredentialsSchema.safeParse(parsed);
    if (!result.success) {
      console.error(
        fmt.error(
          `[Credentials] Invalid credentials file: ${result.error.message}`
        )
      );
      return null;
    }

    return result.data;
  } catch (error) {
    console.error(
      fmt.error(
        `[Credentials] Failed to load credentials: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return null;
  }
}

/**
 * Save credentials to OS storage
 */
export function saveCredentials(credentials: StoredCredentials): void {
  try {
    ensureConfigDir();
    const credentialsPath = getCredentialsPath();

    // Read existing credentials and merge
    const existing = loadCredentials();
    const merged: StoredCredentials = {
      ...existing,
      ...credentials,
    };

    // Write to file
    fs.writeFileSync(credentialsPath, JSON.stringify(merged, null, 2), 'utf-8');

    // Set secure permissions
    setSecurePermissions(credentialsPath);
  } catch (error) {
    throw new Error(
      `Failed to save credentials: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Delete stored credentials
 */
export function deleteCredentials(): void {
  try {
    const credentialsPath = getCredentialsPath();
    try {
      fs.unlinkSync(credentialsPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to delete credentials: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get the config directory path (for informational purposes)
 */
export function getConfigDirectoryPath(): string {
  return getConfigDir();
}

/**
 * Test helper to reset module state between tests.
 */
export function __resetCredentialsStateForTests(): void {
  migrationDone = false;
}
