import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDaemonContainer } from '../../container/DaemonContainerFactory';
import * as credentials from '../../utils/credentials';

vi.mock('../../utils/credentials', () => ({
  loadCredentials: vi.fn(),
}));

describe('DaemonContainerFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_URL;
    vi.mocked(credentials.loadCredentials).mockReturnValue(null);
  });

  it('falls back to stored API key when env var is not set', () => {
    vi.mocked(credentials.loadCredentials).mockReturnValue({
      apiKey: 'fc-stored-key',
    });

    const container = createDaemonContainer();

    expect(container.config.apiKey).toBe('fc-stored-key');
    expect(credentials.loadCredentials).toHaveBeenCalledTimes(1);
  });

  it('prefers environment API key over stored credentials', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-env-key';
    vi.mocked(credentials.loadCredentials).mockReturnValue({
      apiKey: 'fc-stored-key',
    });

    const container = createDaemonContainer();

    expect(container.config.apiKey).toBe('fc-env-key');
  });

  it('prefers explicit override API key over env and stored credentials', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-env-key';
    vi.mocked(credentials.loadCredentials).mockReturnValue({
      apiKey: 'fc-stored-key',
    });

    const container = createDaemonContainer({
      apiKey: 'fc-override-key',
    });

    expect(container.config.apiKey).toBe('fc-override-key');
  });
});
