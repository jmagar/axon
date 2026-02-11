import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/auth', () => ({
  isAuthenticated: vi.fn(),
  getAuthSource: vi.fn(),
  interactiveLogin: vi.fn(),
}));

vi.mock('../../utils/credentials', () => ({
  getConfigDirectoryPath: vi.fn().mockReturnValue('/tmp/firecrawl-home'),
  loadCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
}));

vi.mock('../../utils/theme', () => ({
  fmt: {
    dim: (msg: string) => msg,
    success: (msg: string) => msg,
    error: (msg: string) => msg,
  },
  icons: {
    success: '✓',
  },
}));

import { handleLoginCommand } from '../../commands/login';
import { handleLogoutCommand } from '../../commands/logout';
import { getAuthSource, isAuthenticated } from '../../utils/auth';
import { deleteCredentials, loadCredentials } from '../../utils/credentials';

describe('login/logout auth source messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('login should explain env auth when already authenticated via FIRECRAWL_API_KEY', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getAuthSource).mockReturnValue('env');
    vi.mocked(loadCredentials).mockReturnValue(null);

    await handleLoginCommand();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Authentication source: FIRECRAWL_API_KEY')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('unset FIRECRAWL_API_KEY')
    );
  });

  it('logout should explain env auth when no stored credentials exist', async () => {
    vi.mocked(loadCredentials).mockReturnValue(null);
    vi.mocked(getAuthSource).mockReturnValue('env');
    vi.mocked(isAuthenticated).mockReturnValue(true);

    await handleLogoutCommand();

    expect(deleteCredentials).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Authentication is from environment')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Unset FIRECRAWL_API_KEY')
    );
  });
});
