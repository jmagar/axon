import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

describe('storage-paths', () => {
  const originalFirecrawlHome = process.env.FIRECRAWL_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FIRECRAWL_HOME;
  });

  afterEach(() => {
    process.env.FIRECRAWL_HOME = originalFirecrawlHome;
  });

  it('should default to ~/.firecrawl', async () => {
    const { getStorageRoot } = await import('../../utils/storage-paths');
    expect(getStorageRoot()).toBe('/home/testuser/.firecrawl');
  });

  it('should use FIRECRAWL_HOME override', async () => {
    process.env.FIRECRAWL_HOME = '/tmp/custom-firecrawl-home';
    const { getStorageRoot } = await import('../../utils/storage-paths');
    expect(getStorageRoot()).toBe('/tmp/custom-firecrawl-home');
  });

  it('should expand leading tilde in FIRECRAWL_HOME', async () => {
    process.env.FIRECRAWL_HOME = '~/.firecrawl';
    const { getStorageRoot } = await import('../../utils/storage-paths');
    expect(getStorageRoot()).toBe('/home/testuser/.firecrawl');
  });
});
