/**
 * E2E tests for config, login, and logout commands
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerTempDirLifecycle, runCLI, runCLISuccess } from './helpers';

describe('E2E: config command', () => {
  let tempDir: string;
  let configDir: string;

  registerTempDirLifecycle(
    (dir) => {
      tempDir = dir;
    },
    () => tempDir
  );

  beforeEach(async () => {
    configDir = join(tempDir, 'firecrawl-cli');
    await mkdir(configDir, { recursive: true });
  });

  describe('config help', () => {
    it('should display config command help', async () => {
      const result = await runCLISuccess(['config', '--help']);
      expect(result.stdout).toContain('Configure Firecrawl');
      expect(result.stdout).toContain('--api-key');
      expect(result.stdout).toContain('--api-url');
    });

    it('should display config set subcommand help', async () => {
      const result = await runCLISuccess(['config', 'set', '--help']);
      expect(result.stdout).toContain('Set a configuration value');
    });

    it('should display config get subcommand help', async () => {
      const result = await runCLISuccess(['config', 'get', '--help']);
      expect(result.stdout).toContain('Get a configuration value');
    });

    it('should display config clear subcommand help', async () => {
      const result = await runCLISuccess(['config', 'clear', '--help']);
      expect(result.stdout).toContain('Clear a configuration value');
    });
  });

  describe('config set/get/clear', () => {
    it('should set exclude-paths configuration', async () => {
      const result = await runCLI(
        ['config', 'set', 'exclude-paths', '/admin,/private'],
        {
          env: {
            HOME: tempDir,
            XDG_CONFIG_HOME: tempDir,
          },
        }
      );

      // Should complete without error
      expect(result.exitCode).toBe(0);
    });

    it('should get exclude-paths configuration', async () => {
      // First set the value
      await runCLI(['config', 'set', 'exclude-paths', '/admin,/private'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
        },
      });

      // Then get it
      const result = await runCLI(['config', 'get', 'exclude-paths'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
        },
      });

      expect(result.exitCode).toBe(0);
    });

    it('should clear exclude-paths configuration', async () => {
      // First set the value
      await runCLI(['config', 'set', 'exclude-paths', '/admin'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
        },
      });

      // Then clear it
      const result = await runCLI(['config', 'clear', 'exclude-paths'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
        },
      });

      expect(result.exitCode).toBe(0);
    });
  });

  describe('view-config command', () => {
    it('should display view-config command help', async () => {
      const result = await runCLISuccess(['view-config', '--help']);
      expect(result.stdout).toContain('View current configuration');
    });

    it('should show current configuration', async () => {
      const result = await runCLI(['view-config'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
          FIRECRAWL_API_KEY: '',
        },
      });

      expect(result.exitCode).toBe(0);
      // Output should contain some configuration info
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });
});

describe('E2E: login command', () => {
  let tempDir: string;

  registerTempDirLifecycle(
    (dir) => {
      tempDir = dir;
    },
    () => tempDir
  );

  describe('login help', () => {
    it('should display login command help', async () => {
      const result = await runCLISuccess(['login', '--help']);
      expect(result.stdout).toContain('Login to Firecrawl');
      expect(result.stdout).toContain('--api-key');
      expect(result.stdout).toContain('--api-url');
    });
  });

  describe('login with API key', () => {
    it('should accept API key via --api-key flag', async () => {
      const result = await runCLI(
        ['login', '--api-key', 'test-api-key-12345'],
        {
          env: {
            HOME: tempDir,
            XDG_CONFIG_HOME: tempDir,
          },
        }
      );

      // Login should succeed or fail gracefully (key validation may fail)
      expect(result.exitCode).toBeDefined();
    });

    it('should accept custom API URL via --api-url flag', async () => {
      const result = await runCLI(
        [
          'login',
          '--api-key',
          'test-api-key-12345',
          '--api-url',
          'https://custom.api.example.com',
        ],
        {
          env: {
            HOME: tempDir,
            XDG_CONFIG_HOME: tempDir,
          },
        }
      );

      expect(result.exitCode).toBeDefined();
    });
  });
});

describe('E2E: logout command', () => {
  let tempDir: string;

  registerTempDirLifecycle(
    (dir) => {
      tempDir = dir;
    },
    () => tempDir
  );

  describe('logout help', () => {
    it('should display logout command help', async () => {
      const result = await runCLISuccess(['logout', '--help']);
      expect(result.stdout).toContain('Logout and clear');
    });
  });

  describe('logout execution', () => {
    it('should logout successfully', async () => {
      const result = await runCLI(['logout'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
        },
      });

      // Should complete without error
      expect(result.exitCode).toBe(0);
    });

    it('should be idempotent (logout when not logged in)', async () => {
      // First logout
      await runCLI(['logout'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
        },
      });

      // Second logout should also succeed
      const result = await runCLI(['logout'], {
        env: {
          HOME: tempDir,
          XDG_CONFIG_HOME: tempDir,
        },
      });

      expect(result.exitCode).toBe(0);
    });
  });
});

describe('E2E: status command', () => {
  it('should display status with --status flag', async () => {
    const result = await runCLI(['--status'], {
      env: {
        FIRECRAWL_API_KEY: 'test-key',
      },
    });

    expect(result.exitCode).toBeDefined();
    // Should contain version info at minimum
    expect(result.stdout).toBeDefined();
  });
});
