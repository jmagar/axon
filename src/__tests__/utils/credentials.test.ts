/**
 * Tests for credentials utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadCredentials,
  saveCredentials,
  deleteCredentials,
  getConfigDirectoryPath,
} from '../../utils/credentials';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(),
  platform: vi.fn(),
}));

describe('Credentials Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfigDirectoryPath', () => {
    it('should return macOS config path', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');

      const configPath = getConfigDirectoryPath();

      expect(configPath).toBe(
        '/home/testuser/Library/Application Support/firecrawl-cli'
      );
    });

    it('should return Windows config path', () => {
      vi.mocked(os.platform).mockReturnValue('win32');

      const configPath = getConfigDirectoryPath();

      expect(configPath).toBe('/home/testuser/AppData/Roaming/firecrawl-cli');
    });

    it('should return Linux config path', () => {
      vi.mocked(os.platform).mockReturnValue('linux');

      const configPath = getConfigDirectoryPath();

      expect(configPath).toBe('/home/testuser/.config/firecrawl-cli');
    });

    it('should return Linux config path for unknown platforms', () => {
      vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);

      const configPath = getConfigDirectoryPath();

      expect(configPath).toBe('/home/testuser/.config/firecrawl-cli');
    });
  });

  describe('loadCredentials', () => {
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue('darwin');
    });

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
  });

  describe('saveCredentials', () => {
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    it('should create config directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      saveCredentials({ apiKey: 'fc-test-key' });

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('firecrawl-cli'),
        { recursive: true, mode: 0o700 }
      );
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
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue('darwin');
    });

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
