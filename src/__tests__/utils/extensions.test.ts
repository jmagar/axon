import { describe, expect, it } from 'vitest';
import { extensionsToPaths } from '../../utils/extensions.js';

describe('extensionsToPaths', () => {
  describe('basic conversion', () => {
    it('converts extensions with leading dots', () => {
      const result = extensionsToPaths(['.pkg', '.exe', '.dmg']);
      expect(result).toEqual(['\\.dmg$', '\\.exe$', '\\.pkg$']);
    });

    it('converts extensions without leading dots', () => {
      const result = extensionsToPaths(['pkg', 'exe', 'dmg']);
      expect(result).toEqual(['\\.dmg$', '\\.exe$', '\\.pkg$']);
    });

    it('handles mixed formats', () => {
      const result = extensionsToPaths(['.pkg', 'exe', '.dmg', 'zip']);
      expect(result).toEqual(['\\.dmg$', '\\.exe$', '\\.pkg$', '\\.zip$']);
    });
  });

  describe('normalization', () => {
    it('converts uppercase to lowercase', () => {
      const result = extensionsToPaths(['.PKG', '.EXE', '.DMG']);
      expect(result).toEqual(['\\.dmg$', '\\.exe$', '\\.pkg$']);
    });

    it('handles mixed case', () => {
      const result = extensionsToPaths(['.PkG', 'ExE', '.dMg']);
      expect(result).toEqual(['\\.dmg$', '\\.exe$', '\\.pkg$']);
    });

    it('trims whitespace', () => {
      const result = extensionsToPaths([' .pkg ', '  exe  ', '\t.dmg\t']);
      expect(result).toEqual(['\\.dmg$', '\\.exe$', '\\.pkg$']);
    });
  });

  describe('deduplication', () => {
    it('removes duplicate extensions', () => {
      const result = extensionsToPaths(['.pkg', '.pkg', '.exe', 'pkg']);
      expect(result).toEqual(['\\.exe$', '\\.pkg$']);
    });

    it('deduplicates case-insensitive', () => {
      const result = extensionsToPaths(['.PKG', '.pkg', '.Pkg', 'PKG']);
      expect(result).toEqual(['\\.pkg$']);
    });

    it('deduplicates with different formats', () => {
      const result = extensionsToPaths(['.exe', 'exe', ' exe ', '.EXE']);
      expect(result).toEqual(['\\.exe$']);
    });
  });

  describe('multi-part extensions', () => {
    it('handles double extensions like .tar.gz', () => {
      const result = extensionsToPaths(['.tar.gz', '.tar.bz2']);
      expect(result).toEqual(['\\.tar\\.bz2$', '\\.tar\\.gz$']);
    });

    it('handles triple extensions', () => {
      const result = extensionsToPaths(['.backup.tar.gz']);
      expect(result).toEqual(['\\.backup\\.tar\\.gz$']);
    });

    it('normalizes multi-part extensions', () => {
      const result = extensionsToPaths(['.TAR.GZ', 'tar.bz2', ' .tar.xz ']);
      expect(result).toEqual(['\\.tar\\.bz2$', '\\.tar\\.gz$', '\\.tar\\.xz$']);
    });
  });

  describe('invalid input rejection', () => {
    it('filters out empty strings', () => {
      const result = extensionsToPaths(['', '.pkg', '', '.exe']);
      expect(result).toEqual(['\\.exe$', '\\.pkg$']);
    });

    it('filters out whitespace-only strings', () => {
      const result = extensionsToPaths(['   ', '.pkg', '\t\t', '.exe']);
      expect(result).toEqual(['\\.exe$', '\\.pkg$']);
    });

    it('rejects path traversal with ..', () => {
      const result = extensionsToPaths(['../evil', '.pkg', '..', '.exe']);
      expect(result).toEqual(['\\.exe$', '\\.pkg$']);
    });

    it('rejects forward slashes', () => {
      const result = extensionsToPaths(['a/b', '.pkg', './exe', '.dmg']);
      expect(result).toEqual(['\\.dmg$', '\\.pkg$']);
    });

    it('rejects backslashes', () => {
      const result = extensionsToPaths(['a\\b', '.pkg', '.\\exe', '.dmg']);
      expect(result).toEqual(['\\.dmg$', '\\.pkg$']);
    });

    it('rejects wildcards', () => {
      const result = extensionsToPaths(['*.pkg', '.exe?', '.dm*g', '.zip']);
      expect(result).toEqual(['\\.zip$']);
    });

    it('rejects special characters', () => {
      const result = extensionsToPaths(['.pkg;', '.exe|', '.dm&g', '.zip']);
      expect(result).toEqual(['\\.zip$']);
    });
  });

  describe('edge cases', () => {
    it('handles empty array', () => {
      const result = extensionsToPaths([]);
      expect(result).toEqual([]);
    });

    it('handles all-invalid inputs', () => {
      const result = extensionsToPaths(['', '..', '*', '/', '']);
      expect(result).toEqual([]);
    });

    it('handles single extension', () => {
      const result = extensionsToPaths(['.pkg']);
      expect(result).toEqual(['\\.pkg$']);
    });

    it('handles extensions with numbers', () => {
      const result = extensionsToPaths(['.mp3', '.mp4', '.h264']);
      expect(result).toEqual(['\\.h264$', '\\.mp3$', '\\.mp4$']);
    });

    it('sorts results alphabetically', () => {
      const result = extensionsToPaths(['.zip', '.exe', '.pkg', '.dmg']);
      expect(result).toEqual(['\\.dmg$', '\\.exe$', '\\.pkg$', '\\.zip$']);
    });
  });

  describe('real-world examples', () => {
    it('handles common binary extensions', () => {
      const result = extensionsToPaths([
        '.exe',
        '.msi',
        '.dmg',
        '.pkg',
        '.deb',
        '.rpm',
      ]);
      expect(result).toEqual([
        '\\.deb$',
        '\\.dmg$',
        '\\.exe$',
        '\\.msi$',
        '\\.pkg$',
        '\\.rpm$',
      ]);
    });

    it('handles common archive extensions', () => {
      const result = extensionsToPaths([
        '.zip',
        '.tar',
        '.gz',
        '.bz2',
        '.7z',
        '.rar',
      ]);
      expect(result).toEqual([
        '\\.7z$',
        '\\.bz2$',
        '\\.gz$',
        '\\.rar$',
        '\\.tar$',
        '\\.zip$',
      ]);
    });

    it('handles common media extensions', () => {
      const result = extensionsToPaths([
        '.mp4',
        '.mp3',
        '.jpg',
        '.png',
        '.pdf',
      ]);
      expect(result).toEqual([
        '\\.jpg$',
        '\\.mp3$',
        '\\.mp4$',
        '\\.pdf$',
        '\\.png$',
      ]);
    });

    it('handles default exclude extensions from constants', () => {
      const DEFAULT_EXTENSIONS = [
        '.exe',
        '.msi',
        '.dmg',
        '.pkg',
        '.deb',
        '.rpm',
        '.zip',
        '.tar',
        '.gz',
        '.bz2',
        '.7z',
        '.rar',
        '.mp4',
        '.mp3',
        '.avi',
        '.mov',
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.pdf',
        '.ttf',
        '.woff',
        '.woff2',
      ];
      const result = extensionsToPaths(DEFAULT_EXTENSIONS);
      expect(result).toHaveLength(24);
      expect(result[0]).toBe('\\.7z$');
      expect(result[result.length - 1]).toBe('\\.zip$');
    });
  });
});
