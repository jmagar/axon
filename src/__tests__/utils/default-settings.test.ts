import { describe, expect, it } from 'vitest';
import { UserSettingsSchema } from '../../schemas/storage';
import {
  getDefaultSettings,
  mergeWithDefaults,
} from '../../utils/default-settings';

describe('default-settings', () => {
  it('returns schema-valid defaults', () => {
    const defaults = getDefaultSettings();
    const parsed = UserSettingsSchema.safeParse(defaults);

    expect(parsed.success).toBe(true);
    expect(defaults.settingsVersion).toBe(2);
    expect(defaults.crawl.maxDepth).toBe(5);
    expect(defaults.search.limit).toBe(5);
  });

  it('deep merges nested settings while preserving defaults', () => {
    const merged = mergeWithDefaults({
      crawl: { maxDepth: 11 },
      http: { timeoutMs: 45000 },
    });

    expect(merged.crawl.maxDepth).toBe(11);
    expect(merged.crawl.sitemap).toBe('include');
    expect(merged.http.timeoutMs).toBe(45000);
    expect(merged.http.maxRetries).toBe(3);
  });
});
