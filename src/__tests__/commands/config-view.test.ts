import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewConfig } from '../../commands/config';

vi.mock('../../utils/auth', () => ({
  isAuthenticated: vi.fn(),
  getAuthSource: vi.fn(),
}));

vi.mock('../../utils/credentials', () => ({
  loadCredentials: vi.fn(),
  getConfigDirectoryPath: vi.fn().mockReturnValue('/tmp/firecrawl-config'),
}));

vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn().mockReturnValue({}),
  saveSettings: vi.fn(),
  clearSetting: vi.fn(),
}));

vi.mock('../../utils/theme', () => ({
  colorize: (_color: string, text: string) => text,
  colors: {
    primary: '',
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
    active: '●',
    error: '✗',
    warning: '⚠',
    pending: '○',
    bullet: '•',
    arrow: '→',
  },
}));

import { getAuthSource, isAuthenticated } from '../../utils/auth';
import { loadCredentials } from '../../utils/credentials';

describe('viewConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Clean all env vars read by buildRuntimeEnvItems and buildConfigDiagnostics
    // to prevent test pollution from the host environment
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_URL;
    delete process.env.ASK_CLI;
    delete process.env.SEARXNG_ENDPOINT;
    delete process.env.SEARXNG_ENGINES;
    delete process.env.SEARXNG_CATEGORIES;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL;
    delete process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET;
    delete process.env.FIRECRAWL_HOME;
    delete process.env.QDRANT_DATA_DIR;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_RATE_LIMIT_URL;
    delete process.env.PLAYWRIGHT_MICROSERVICE_URL;
    delete process.env.NUQ_RABBITMQ_URL;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PORT;
    delete process.env.TEI_URL;
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_COLLECTION;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows masked env key when authenticated via FIRECRAWL_API_KEY', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-env-key-1234567890';
    process.env.FIRECRAWL_API_URL = 'https://env.firecrawl.dev';
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getAuthSource).mockReturnValue('env');
    vi.mocked(loadCredentials).mockReturnValue(null);

    await viewConfig();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Authenticated via FIRECRAWL_API_KEY')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('API Key:')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('fc-env...7890')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('https://env.firecrawl.dev')
    );
  });

  it('shows not authenticated when no auth source is available', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);
    vi.mocked(getAuthSource).mockReturnValue('none');
    vi.mocked(loadCredentials).mockReturnValue(null);

    await viewConfig();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Not authenticated')
    );
  });

  it('shows command defaults and runtime environment with OPENAI_MODEL', async () => {
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    process.env.QDRANT_URL = 'http://qdrant:6333';
    process.env.OPENAI_API_KEY = 'sk-openai-test-1234567890';
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getAuthSource).mockReturnValue('env');
    vi.mocked(loadCredentials).mockReturnValue({
      apiKey: 'fc-stored-key-1234567890',
      apiUrl: 'https://stored.example',
    });

    await viewConfig();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Command Defaults')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Runtime Environment')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('OPENAI_MODEL:')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('gpt-4o-mini')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('QDRANT_URL:')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('http://qdrant:6333')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('sk-ope...7890')
    );
  });

  it('shows OPENAI_MODEL as not set when not configured', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getAuthSource).mockReturnValue('env');
    vi.mocked(loadCredentials).mockReturnValue({
      apiKey: 'fc-stored-key-1234567890',
      apiUrl: 'https://stored.example',
    });

    await viewConfig();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('OPENAI_MODEL:')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Not set')
    );
  });

  it('outputs structured JSON when json option is enabled', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-env-key-1234567890';
    process.env.OPENAI_MODEL = 'haiku';
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getAuthSource).mockReturnValue('env');
    vi.mocked(loadCredentials).mockReturnValue(null);

    await viewConfig({ json: true });

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    const parsed = JSON.parse(output) as {
      authenticated: boolean;
      authSource: string;
      commandDefaults: Record<string, unknown>;
      runtimeEnvironment: Record<string, { value: string }>;
    };

    expect(parsed.authenticated).toBe(true);
    expect(parsed.authSource).toBe('env');
    expect(parsed.commandDefaults.scrape).toBeDefined();
    expect(parsed.runtimeEnvironment.OPENAI_MODEL.value).toBe('haiku');
  });
});
