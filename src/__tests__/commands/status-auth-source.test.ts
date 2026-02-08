import { describe, expect, it, vi } from 'vitest';
import { getStatus } from '../../commands/status';
import type { ImmutableConfig } from '../../container/types';

vi.mock('../../utils/auth', () => ({
  getAuthSource: vi.fn().mockReturnValue('env'),
  isAuthenticated: vi.fn().mockReturnValue(true),
}));

import { getAuthSource, isAuthenticated } from '../../utils/auth';

describe('getStatus auth source', () => {
  it('should not treat resolved container apiKey as explicit override', () => {
    const config: ImmutableConfig = Object.freeze({
      apiKey: 'resolved-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    const result = getStatus(config);

    expect(vi.mocked(getAuthSource)).toHaveBeenCalledWith();
    expect(vi.mocked(isAuthenticated)).toHaveBeenCalledWith('resolved-key');
    expect(result.authSource).toBe('env');
  });
});
