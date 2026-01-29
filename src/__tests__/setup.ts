import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // Prevent local environment variables from leaking into tests
  // This ensures tests run in a clean environment regardless of .env files or shell context
  vi.stubEnv('TEI_URL', undefined);
  vi.stubEnv('QDRANT_URL', undefined);
  vi.stubEnv('QDRANT_COLLECTION', undefined);
  vi.stubEnv('FIRECRAWL_API_KEY', undefined);
  vi.stubEnv('FIRECRAWL_API_URL', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});
