/**
 * User settings utility
 * Stores persistent user settings in the platform config directory
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type UserSettings, UserSettingsSchema } from '../schemas/storage';
import { getConfigDirectoryPath } from './credentials';
import { fmt } from './theme';

export type { UserSettings };

/**
 * Get the settings file path
 */
function getSettingsPath(): string {
  return path.join(getConfigDirectoryPath(), 'settings.json');
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  const configDir = getConfigDirectoryPath();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Set file permissions to be readable/writable only by the owner
 */
function setSecurePermissions(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_error) {
    // Ignore errors on Windows or if file doesn't exist
  }
}

/**
 * Load settings from disk
 */
export function loadSettings(): UserSettings {
  try {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return {};
    }

    const data = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(data);

    // Validate with Zod schema for runtime type safety
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
 * Save settings to disk (merges with existing)
 */
export function saveSettings(settings: Partial<UserSettings>): void {
  try {
    ensureConfigDir();
    const existing = loadSettings();
    const merged: UserSettings = { ...existing, ...settings };
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
    setSecurePermissions(settingsPath);
  } catch (error) {
    throw new Error(
      `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Clear a specific setting key
 */
export function clearSetting(key: keyof UserSettings): void {
  try {
    const existing = loadSettings();
    delete existing[key];
    const settingsPath = getSettingsPath();

    if (Object.keys(existing).length === 0) {
      // Remove file if no settings remain
      if (fs.existsSync(settingsPath)) {
        fs.unlinkSync(settingsPath);
      }
      return;
    }

    ensureConfigDir();
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2), 'utf-8');
    setSecurePermissions(settingsPath);
  } catch (error) {
    throw new Error(
      `Failed to clear setting: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
