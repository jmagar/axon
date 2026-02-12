import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetSettingsStateForTests,
  getSettings,
  loadSettings,
} from '../../utils/settings';

describe('settings materialization', () => {
  const originalHome = process.env.FIRECRAWL_HOME;
  const originalUserHome = process.env.HOME;
  let testHome: string;
  let testUserHome: string;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'firecrawl-settings-'));
    testUserHome = mkdtempSync(join(tmpdir(), 'firecrawl-legacy-home-'));
    process.env.FIRECRAWL_HOME = testHome;
    process.env.HOME = testUserHome;
    __resetSettingsStateForTests();
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    rmSync(testUserHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.FIRECRAWL_HOME;
    } else {
      process.env.FIRECRAWL_HOME = originalHome;
    }
    if (originalUserHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalUserHome;
    }
    __resetSettingsStateForTests();
  });

  it('creates settings.json with defaults when missing', () => {
    const settings = getSettings();

    expect(settings.settingsVersion).toBe(2);
    const onDisk = JSON.parse(
      readFileSync(join(testHome, 'settings.json'), 'utf-8')
    ) as {
      crawl?: { maxDepth?: number };
      settingsVersion?: number;
    };
    expect(onDisk.settingsVersion).toBe(2);
    expect(onDisk.crawl?.maxDepth).toBe(5);
  });

  it('materializes existing partial file to full schema preserving overrides', () => {
    writeFileSync(
      join(testHome, 'settings.json'),
      JSON.stringify({
        defaultExcludePaths: ['/private/*'],
        crawl: { maxDepth: 9 },
      })
    );

    const settings = getSettings();
    const onDisk = JSON.parse(
      readFileSync(join(testHome, 'settings.json'), 'utf-8')
    ) as {
      defaultExcludePaths?: string[];
      crawl?: { maxDepth?: number; sitemap?: string };
      settingsVersion?: number;
      search?: { limit?: number };
    };

    expect(settings.crawl.maxDepth).toBe(9);
    expect(settings.search.limit).toBe(5);
    expect(onDisk.defaultExcludePaths).toEqual(['/private/*']);
    expect(onDisk.crawl?.maxDepth).toBe(9);
    expect(onDisk.crawl?.sitemap).toBe('include');
    expect(onDisk.settingsVersion).toBe(2);
  });

  it('recovers from invalid settings file by writing defaults', () => {
    writeFileSync(join(testHome, 'settings.json'), '{not-json');

    const settings = getSettings();

    expect(settings.settingsVersion).toBe(2);
    const files = JSON.stringify(readdirSync(testHome));
    expect(files).toContain('invalid-backup');
  });

  it('loadSettings returns persisted user values only', () => {
    writeFileSync(
      join(testHome, 'settings.json'),
      JSON.stringify({ crawl: { maxDepth: 7 } })
    );

    const persisted = loadSettings();
    expect(persisted.crawl?.maxDepth).toBe(7);
  });

  it('migrates valid legacy settings from ~/.config/firecrawl-cli/settings.json', () => {
    const legacyDir = join(testUserHome, '.config', 'firecrawl-cli');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, 'settings.json'),
      JSON.stringify({ crawl: { maxDepth: 8 } })
    );

    const persisted = loadSettings();

    expect(persisted.crawl?.maxDepth).toBe(8);
    expect(existsSync(join(testHome, 'settings.json'))).toBe(true);
    const migrated = JSON.parse(
      readFileSync(join(testHome, 'settings.json'), 'utf-8')
    ) as { crawl?: { maxDepth?: number } };
    expect(migrated.crawl?.maxDepth).toBe(8);
  });
});
