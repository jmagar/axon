/**
 * Tests for credentials utilities
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCredentialsStateForTests,
  deleteCredentials,
  getConfigDirectoryPath,
  loadCredentials,
  saveCredentials,
} from '../../utils/credentials';

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

// Mock os module
vi.mock('node:os', () => ({
  homedir: vi.fn(),
}));

describe('Credentials Utilities', () => {
  const originalFirecrawlHome = process.env.FIRECRAWL_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/home/testuser');
    delete process.env.FIRECRAWL_HOME;
    __resetCredentialsStateForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalFirecrawlHome === undefined) {
      delete process.env.FIRECRAWL_HOME;
    } else {
      process.env.FIRECRAWL_HOME = originalFirecrawlHome;
    }
    __resetCredentialsStateForTests();
  });

  describe('getConfigDirectoryPath', () => {
    it('should return default FIRECRAWL_HOME path', () => {
      const configPath = getConfigDirectoryPath();

      expect(configPath).toBe('/home/testuser/.firecrawl');
    });

    it('should use FIRECRAWL_HOME override when set', () => {
      process.env.FIRECRAWL_HOME = '/tmp/custom-firecrawl-home';

      const configPath = getConfigDirectoryPath();

      expect(configPath).toBe('/tmp/custom-firecrawl-home');
    });
  });

  describe('loadCredentials', () => {
    it('should return null when credentials file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadCredentials();

      expect(result).toBeNull();
    });

    it('should return credentials when file exists and is valid', () => {
      const mockCredentials = {
        apiKey: 'fc-test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockCredentials)
      );

      const result = loadCredentials();

      expect(result).toEqual(mockCredentials);
    });

    it('should return null when file is corrupted (invalid JSON)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

      const result = loadCredentials();

      expect(result).toBeNull();
    });

    it('should return null when file read fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = loadCredentials();

      expect(result).toBeNull();
    });

    it('migrates valid legacy credentials from ~/.config/firecrawl-cli', () => {
      const targetPath = '/home/testuser/.firecrawl/credentials.json';
      const legacyPath =
        '/home/testuser/.config/firecrawl-cli/credentials.json';
      let targetExists = false;

      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        const normalizedPath = String(filePath);
        if (normalizedPath === targetPath) {
          return targetExists;
        }
        return normalizedPath === legacyPath;
      });
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        targetExists = true;
      });
      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const normalizedPath = String(filePath);
        if (normalizedPath === legacyPath) {
          return JSON.stringify({ apiKey: 'fc-migrated-key' });
        }
        if (normalizedPath === targetPath) {
          return JSON.stringify({ apiKey: 'fc-migrated-key' });
        }
        throw new Error(`Unexpected read: ${normalizedPath}`);
      });

      const result = loadCredentials();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        targetPath,
        expect.stringContaining('"apiKey": "fc-migrated-key"'),
        'utf-8'
      );
      expect(result).toEqual({ apiKey: 'fc-migrated-key' });
    });

    it('skips invalid legacy credentials and returns null when target is missing', () => {
      const targetPath = '/home/testuser/.firecrawl/credentials.json';
      const legacyPath =
        '/home/testuser/.config/firecrawl-cli/credentials.json';

      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        const normalizedPath = String(filePath);
        if (normalizedPath === targetPath) {
          return false;
        }
        return normalizedPath === legacyPath;
      });
      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const normalizedPath = String(filePath);
        if (normalizedPath === legacyPath) {
          return '{invalid-json';
        }
        throw new Error(`Missing file: ${normalizedPath}`);
      });

      const result = loadCredentials();

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('saveCredentials', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    it('should create config directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      saveCredentials({ apiKey: 'fc-test-key' });

      expect(fs.mkdirSync).toHaveBeenCalledWith('/home/testuser/.firecrawl', {
        recursive: true,
        mode: 0o700,
      });
    });

    it('should save credentials to file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      saveCredentials({
        apiKey: 'fc-test-key',
        apiUrl: 'https://api.firecrawl.dev',
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('credentials.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should merge with existing credentials', () => {
      const existingCredentials = {
        apiKey: 'fc-old-key',
        apiUrl: 'https://old-api.example.com',
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(existingCredentials)
      );

      saveCredentials({ apiKey: 'fc-new-key' });

      // Check that writeFileSync was called with merged data
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenData = JSON.parse(
        vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      );
      expect(writtenData.apiKey).toBe('fc-new-key');
      expect(writtenData.apiUrl).toBe('https://old-api.example.com');
    });

    it('should save self-hosted credentials without fc- prefix', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      saveCredentials({
        apiKey: 'local-dev',
        apiUrl: 'http://localhost:53002',
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenData = JSON.parse(
        vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      );
      expect(writtenData.apiKey).toBe('local-dev');
      expect(writtenData.apiUrl).toBe('http://localhost:53002');
    });

    it('should set secure file permissions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      saveCredentials({ apiKey: 'fc-test-key' });

      expect(fs.chmodSync).toHaveBeenCalledWith(
        expect.stringContaining('credentials.json'),
        0o600
      );
    });

    it('should throw error when save fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      expect(() => saveCredentials({ apiKey: 'fc-test-key' })).toThrow(
        'Failed to save credentials: Disk full'
      );
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials file when it exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      deleteCredentials();

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('credentials.json')
      );
    });

    it('should not throw when credentials file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => deleteCredentials()).not.toThrow();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should throw error when delete fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => deleteCredentials()).toThrow(
        'Failed to delete credentials: Permission denied'
      );
    });
  });
});
