import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleConfigClear,
  handleConfigGet,
  handleConfigReset,
  handleConfigSet,
  maskUrlCredentials,
} from '../../commands/config';

// Mock the settings module
vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  clearSetting: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock('../../utils/default-settings', () => ({
  getDefaultSettings: vi.fn(),
}));

// Mock the theme module to avoid ANSI codes
vi.mock('../../utils/theme', () => ({
  colorize: (_color: string, text: string) => text,
  colors: {
    primary: '',
    info: '',
    warning: '',
    secondary: '',
    success: '',
    error: '',
    materialLightBlue: '',
  },
  fmt: {
    error: (msg: string) => msg,
    dim: (msg: string) => msg,
    success: (msg: string) => msg,
    bold: (msg: string) => msg,
    warning: (msg: string) => msg,
    primary: (msg: string) => msg,
  },
  icons: {
    success: '✓',
    error: '✗',
    warning: '⚠',
    pending: '○',
    bullet: '•',
    arrow: '→',
  },
}));

import { getDefaultSettings } from '../../utils/default-settings';
import {
  clearSetting,
  getSettings,
  loadSettings,
  saveSettings,
} from '../../utils/settings';

describe('handleConfigSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exclude-paths', () => {
    it('should set exclude paths from comma-separated string', () => {
      handleConfigSet('exclude-paths', '/admin,/api,/login');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('/admin, /api, /login')
      );
    });

    it('should trim whitespace from paths', () => {
      handleConfigSet('exclude-paths', ' /admin , /api , /login ');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });
    });

    it('should filter empty strings', () => {
      handleConfigSet('exclude-paths', '/admin,,/api,  ,/login');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });
    });

    it('should error on empty value', () => {
      handleConfigSet('exclude-paths', '');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No exclude-paths provided')
      );
      expect(process.exitCode).toBe(1);
    });

    it('should error on whitespace-only value', () => {
      handleConfigSet('exclude-paths', '   ,  , ');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No exclude-paths provided')
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('exclude-extensions', () => {
    it('should set exclude extensions from comma-separated string', () => {
      handleConfigSet('exclude-extensions', '.pkg,.exe,.dmg');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', '.exe', '.dmg'],
      });
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.pkg, .exe, .dmg')
      );
    });

    it('should trim whitespace from extensions', () => {
      handleConfigSet('exclude-extensions', ' .pkg , exe , .dmg ');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', 'exe', '.dmg'],
      });
    });

    it('should filter empty strings', () => {
      handleConfigSet('exclude-extensions', '.pkg,,.exe,  ,.dmg');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', '.exe', '.dmg'],
      });
    });

    it('should accept extensions with or without dots', () => {
      handleConfigSet('exclude-extensions', '.pkg,exe,dmg');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', 'exe', 'dmg'],
      });
    });

    it('should error on empty value', () => {
      handleConfigSet('exclude-extensions', '');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No exclude-extensions provided')
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('unknown setting', () => {
    it('should error on unknown setting key', () => {
      handleConfigSet('unknown-key', 'value');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Unknown setting "unknown-key"')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('exclude-paths, exclude-extensions')
      );
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('handleConfigGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
    vi.mocked(getDefaultSettings).mockReturnValue({
      defaultExcludeExtensions: [
        '.exe',
        '.pkg',
        '.dmg',
        '.zip',
        '.jpg',
        '.ttf',
      ],
    } as unknown as ReturnType<typeof getDefaultSettings>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exclude-paths', () => {
    it('should display configured exclude paths', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });

      handleConfigGet('exclude-paths');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('/admin, /api, /login')
      );
    });

    it('should handle empty exclude paths', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: [],
      });

      handleConfigGet('exclude-paths');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'No exclude paths found on current configuration'
        )
      );
    });

    it('should handle missing exclude paths', () => {
      vi.mocked(loadSettings).mockReturnValue({});

      handleConfigGet('exclude-paths');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'No exclude paths found on current configuration'
        )
      );
    });
  });

  describe('exclude-extensions', () => {
    it('should display configured exclude extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludeExtensions: ['.pkg', '.exe', '.dmg'],
      });

      handleConfigGet('exclude-extensions');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.pkg, .exe, .dmg')
      );
    });

    it('should handle empty exclude extensions with built-in defaults message', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludeExtensions: [],
      });

      handleConfigGet('exclude-extensions');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'No custom exclude extensions found on current configuration'
        )
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Using built-in defaults')
      );
    });

    it('should handle missing exclude extensions with built-in defaults message', () => {
      vi.mocked(loadSettings).mockReturnValue({});

      handleConfigGet('exclude-extensions');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'No custom exclude extensions found on current configuration'
        )
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Using built-in defaults')
      );
    });
  });

  describe('excludes (combined view)', () => {
    it('should display both paths and extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: ['/admin', '/api'],
        defaultExcludeExtensions: ['.pkg', '.exe'],
      });

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Exclude Configuration')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Paths:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('/admin, /api')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Extensions:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.pkg, .exe')
      );
    });

    it('should show built-in defaults with categories when no custom extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: ['/admin'],
      });

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('using built-in defaults')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Executables:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Archives:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Media:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Fonts:')
      );
    });

    it('should handle empty paths and custom extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludeExtensions: ['.custom1', '.custom2'],
      });

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'No exclude paths found on current configuration'
        )
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('custom configuration')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.custom1, .custom2')
      );
    });

    it('should handle both empty', () => {
      vi.mocked(loadSettings).mockReturnValue({});

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'No exclude paths found on current configuration'
        )
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('using built-in defaults')
      );
    });
  });

  describe('unknown setting', () => {
    it('should error on unknown setting key', () => {
      handleConfigGet('unknown-key');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Unknown setting "unknown-key"')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('exclude-paths, exclude-extensions, excludes')
      );
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('nested settings', () => {
  const effectiveSettings = {
    settingsVersion: 2 as const,
    defaultExcludePaths: [],
    defaultExcludeExtensions: [],
    crawl: {
      maxDepth: 7,
      crawlEntireDomain: true,
      allowSubdomains: true,
      onlyMainContent: true,
      excludeTags: ['nav', 'footer'],
      sitemap: 'include' as const,
      ignoreQueryParameters: true,
      autoEmbed: true,
      pollIntervalSeconds: 5,
    },
    scrape: {
      formats: ['markdown'],
      onlyMainContent: true,
      timeoutSeconds: 15,
      excludeTags: ['nav', 'footer'],
      autoEmbed: true,
    },
    map: {
      sitemap: 'include' as const,
      includeSubdomains: null,
      ignoreQueryParameters: true,
      ignoreCache: null,
    },
    search: {
      limit: 5,
      sources: ['web'],
      timeoutMs: 60000,
      ignoreInvalidUrls: true,
      scrape: true,
      scrapeFormats: ['markdown'],
      onlyMainContent: true,
      autoEmbed: true,
    },
    extract: {
      allowExternalLinks: false,
      enableWebSearch: true,
      includeSubdomains: true,
      showSources: true,
      ignoreInvalidUrls: true,
      autoEmbed: true,
    },
    batch: { onlyMainContent: false, ignoreInvalidUrls: false },
    ask: { limit: 10, fullDocs: 5, backfillChunks: 3 },
    http: {
      timeoutMs: 30000,
      maxRetries: 3,
      baseDelayMs: 5000,
      maxDelayMs: 60000,
    },
    chunking: {
      maxChunkSize: 1500,
      targetChunkSize: 1000,
      overlapSize: 100,
      minChunkSize: 50,
    },
    embedding: {
      maxConcurrent: 10,
      batchSize: 24,
      maxConcurrentBatches: 4,
      maxRetries: 3,
    },
    polling: { intervalMs: 5000 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getSettings).mockReturnValue(effectiveSettings);
    vi.mocked(getDefaultSettings).mockReturnValue(effectiveSettings);
  });

  it('gets a nested setting path', () => {
    handleConfigGet('crawl.maxDepth');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('crawl.maxDepth: 7')
    );
  });

  it('sets a nested setting path', () => {
    vi.mocked(loadSettings).mockReturnValue({ crawl: { sitemap: 'include' } });

    handleConfigSet('crawl.maxDepth', '10');

    expect(saveSettings).toHaveBeenCalledWith({
      crawl: { sitemap: 'include', maxDepth: 10 },
    });
  });

  it('rejects unsafe integer values for nested numeric settings', () => {
    vi.mocked(loadSettings).mockReturnValue({ crawl: { sitemap: 'include' } });

    handleConfigSet('crawl.maxDepth', '9007199254740992');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('safe integer range')
    );
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('rejects out-of-range nested numeric values', () => {
    vi.mocked(loadSettings).mockReturnValue({ crawl: { sitemap: 'include' } });

    handleConfigSet('scrape.timeoutSeconds', '999999');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('expected 1-300')
    );
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('resets a nested setting path to defaults', () => {
    vi.mocked(loadSettings).mockReturnValue({ crawl: { maxDepth: 17 } });

    handleConfigReset('crawl.maxDepth');

    expect(saveSettings).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('crawl.maxDepth reset')
    );
  });

  it('rejects unknown nested setting path', () => {
    handleConfigSet('crawl.unknownField', '10');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown setting path')
    );
    expect(saveSettings).not.toHaveBeenCalled();
  });
});

describe('handleConfigClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exclude-paths', () => {
    it('should clear exclude paths', () => {
      handleConfigClear('exclude-paths');

      expect(clearSetting).toHaveBeenCalledWith('defaultExcludePaths');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('cleared')
      );
    });
  });

  describe('exclude-extensions', () => {
    it('should clear exclude extensions', () => {
      handleConfigClear('exclude-extensions');

      expect(clearSetting).toHaveBeenCalledWith('defaultExcludeExtensions');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('cleared')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('built-in defaults')
      );
    });
  });

  describe('unknown setting', () => {
    it('should error on unknown setting key', () => {
      handleConfigClear('unknown-key');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Unknown setting "unknown-key"')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('exclude-paths, exclude-extensions')
      );
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('maskUrlCredentials', () => {
  describe('URLs with credentials', () => {
    it('should mask username and password in connection string URLs', () => {
      const url = 'redis://myuser:mypassword@localhost:6379';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@localhost:6379');
      expect(masked).not.toContain('myuser');
      expect(masked).not.toContain('mypassword');
      expect(masked).toMatch(/^redis:\/\/.*:.*@localhost:6379$/);
    });

    it('should mask credentials in PostgreSQL connection strings', () => {
      const url = 'postgresql://admin:secretpass123@db.example.com:5432/mydb';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@db.example.com:5432/mydb');
      expect(masked).not.toContain('admin');
      expect(masked).not.toContain('secretpass123');
      expect(masked).toMatch(
        /^postgresql:\/\/.*:.*@db\.example\.com:5432\/mydb$/
      );
    });

    it('should mask credentials in RabbitMQ URLs', () => {
      const url = 'amqp://guest:guest@rabbitmq:5672';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@rabbitmq:5672');
      expect(masked).not.toContain('guest');
      expect(masked).toMatch(/^amqp:\/\/.*:.*@rabbitmq:5672$/);
    });

    it('should mask credentials in URLs with path and query params', () => {
      const url =
        'https://user:pass@api.example.com:8080/v1/endpoint?key=value';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@api.example.com:8080/v1/endpoint?key=value');
      expect(masked).not.toContain('user');
      expect(masked).not.toContain('pass');
    });

    it('should mask credentials in URLs with hash fragments', () => {
      const url = 'http://admin:secret@localhost:3000/path#section';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@localhost:3000/path#section');
      expect(masked).not.toContain('admin');
      expect(masked).not.toContain('secret');
    });

    it('should handle username-only URLs', () => {
      const url = 'redis://myuser@localhost:6379';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@localhost:6379');
      expect(masked).not.toContain('myuser');
      expect(masked).toMatch(/^redis:\/\/.*@localhost:6379$/);
    });

    it('should mask long credentials properly', () => {
      const url = 'redis://verylongusername:verylongpassword@localhost:6379';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@localhost:6379');
      expect(masked).not.toContain('verylongusername');
      expect(masked).not.toContain('verylongpassword');
      // Verify it uses the maskValue pattern (first 6 chars + ... + last 4)
      expect(masked).toMatch(/^redis:\/\/[^:]+\.\.\.[^@]+:[^:]+\.\.\.[^@]+@/);
    });
  });

  describe('URLs without credentials', () => {
    it('should return URL unchanged if no credentials', () => {
      const url = 'http://localhost:3000';
      const masked = maskUrlCredentials(url);

      expect(masked).toBe(url);
    });

    it('should return URL unchanged for https without credentials', () => {
      const url = 'https://api.example.com:8080/v1/endpoint';
      const masked = maskUrlCredentials(url);

      expect(masked).toBe(url);
    });

    it('should return URL unchanged for custom protocols without credentials', () => {
      const url = 'redis://localhost:6379';
      const masked = maskUrlCredentials(url);

      expect(masked).toBe(url);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      const url = '';
      const masked = maskUrlCredentials(url);

      expect(masked).toBe('');
    });

    it('should handle "Not set" string', () => {
      const url = 'Not set';
      const masked = maskUrlCredentials(url);

      expect(masked).toBe('Not set');
    });

    it('should handle whitespace-only string', () => {
      const url = '   ';
      const masked = maskUrlCredentials(url);

      expect(masked).toBe('');
    });

    it('should handle invalid URLs gracefully', () => {
      const invalidUrl = 'not-a-url';
      const masked = maskUrlCredentials(invalidUrl);

      // Should return as-is since it's not a valid URL
      expect(masked).toBe(invalidUrl);
    });

    it('should handle malformed URL strings gracefully', () => {
      const invalidUrl = 'http://[invalid';
      const masked = maskUrlCredentials(invalidUrl);

      // Should return as-is since it's not a valid URL
      expect(masked).toBe(invalidUrl);
    });

    it('should handle plain text that looks URL-like', () => {
      const text = 'localhost:3000';
      const masked = maskUrlCredentials(text);

      // Should return as-is since it's not a valid URL (no protocol)
      expect(masked).toBe(text);
    });

    it('should trim whitespace before processing', () => {
      const url = '  redis://user:pass@localhost:6379  ';
      const masked = maskUrlCredentials(url);

      expect(masked).toContain('@localhost:6379');
      expect(masked).not.toContain('user');
      expect(masked).not.toContain('pass');
      expect(masked).not.toMatch(/^\s/); // Should not start with whitespace
      expect(masked).not.toMatch(/\s$/); // Should not end with whitespace
    });
  });
});
