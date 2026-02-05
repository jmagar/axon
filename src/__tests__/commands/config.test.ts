import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleConfigClear,
  handleConfigGet,
  handleConfigSet,
} from '../../commands/config';

// Mock the settings module
vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  clearSetting: vi.fn(),
}));

// Mock the theme module to avoid ANSI codes
vi.mock('../../utils/theme', () => ({
  fmt: {
    error: (msg: string) => msg,
    dim: (msg: string) => msg,
    success: (msg: string) => msg,
    bold: (msg: string) => msg,
    warning: (msg: string) => msg,
    primary: (msg: string) => msg,
  },
  icons: {
    success: '✓',
    error: '✗',
    warning: '⚠',
    pending: '○',
    bullet: '•',
    arrow: '→',
  },
}));

import { clearSetting, loadSettings, saveSettings } from '../../utils/settings';

describe('handleConfigSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  describe('exclude-paths', () => {
    it('should set exclude paths from comma-separated string', () => {
      handleConfigSet('exclude-paths', '/admin,/api,/login');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('/admin, /api, /login')
      );
    });

    it('should trim whitespace from paths', () => {
      handleConfigSet('exclude-paths', ' /admin , /api , /login ');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });
    });

    it('should filter empty strings', () => {
      handleConfigSet('exclude-paths', '/admin,,/api,  ,/login');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });
    });

    it('should error on empty value', () => {
      handleConfigSet('exclude-paths', '');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No exclude-paths provided')
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should error on whitespace-only value', () => {
      handleConfigSet('exclude-paths', '   ,  , ');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No exclude-paths provided')
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('exclude-extensions', () => {
    it('should set exclude extensions from comma-separated string', () => {
      handleConfigSet('exclude-extensions', '.pkg,.exe,.dmg');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', '.exe', '.dmg'],
      });
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.pkg, .exe, .dmg')
      );
    });

    it('should trim whitespace from extensions', () => {
      handleConfigSet('exclude-extensions', ' .pkg , exe , .dmg ');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', 'exe', '.dmg'],
      });
    });

    it('should filter empty strings', () => {
      handleConfigSet('exclude-extensions', '.pkg,,.exe,  ,.dmg');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', '.exe', '.dmg'],
      });
    });

    it('should accept extensions with or without dots', () => {
      handleConfigSet('exclude-extensions', '.pkg,exe,dmg');

      expect(saveSettings).toHaveBeenCalledWith({
        defaultExcludeExtensions: ['.pkg', 'exe', 'dmg'],
      });
    });

    it('should error on empty value', () => {
      handleConfigSet('exclude-extensions', '');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No exclude-extensions provided')
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('unknown setting', () => {
    it('should error on unknown setting key', () => {
      handleConfigSet('unknown-key', 'value');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Unknown setting "unknown-key"')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('exclude-paths, exclude-extensions')
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});

describe('handleConfigGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  describe('exclude-paths', () => {
    it('should display configured exclude paths', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: ['/admin', '/api', '/login'],
      });

      handleConfigGet('exclude-paths');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('/admin, /api, /login')
      );
    });

    it('should handle empty exclude paths', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: [],
      });

      handleConfigGet('exclude-paths');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No default exclude paths configured')
      );
    });

    it('should handle missing exclude paths', () => {
      vi.mocked(loadSettings).mockReturnValue({});

      handleConfigGet('exclude-paths');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No default exclude paths configured')
      );
    });
  });

  describe('exclude-extensions', () => {
    it('should display configured exclude extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludeExtensions: ['.pkg', '.exe', '.dmg'],
      });

      handleConfigGet('exclude-extensions');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.pkg, .exe, .dmg')
      );
    });

    it('should handle empty exclude extensions with built-in defaults message', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludeExtensions: [],
      });

      handleConfigGet('exclude-extensions');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('using built-in defaults')
      );
    });

    it('should handle missing exclude extensions with built-in defaults message', () => {
      vi.mocked(loadSettings).mockReturnValue({});

      handleConfigGet('exclude-extensions');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('using built-in defaults')
      );
    });
  });

  describe('excludes (combined view)', () => {
    it('should display both paths and extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: ['/admin', '/api'],
        defaultExcludeExtensions: ['.pkg', '.exe'],
      });

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Exclude Configuration')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Paths:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('/admin, /api')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Extensions:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.pkg, .exe')
      );
    });

    it('should show built-in defaults with categories when no custom extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludePaths: ['/admin'],
      });

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('using built-in defaults')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Executables:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Archives:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Media:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Fonts:')
      );
    });

    it('should handle empty paths and custom extensions', () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultExcludeExtensions: ['.custom1', '.custom2'],
      });

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No custom exclude paths configured')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('custom configuration')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('.custom1, .custom2')
      );
    });

    it('should handle both empty', () => {
      vi.mocked(loadSettings).mockReturnValue({});

      handleConfigGet('excludes');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No custom exclude paths configured')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('using built-in defaults')
      );
    });
  });

  describe('unknown setting', () => {
    it('should error on unknown setting key', () => {
      handleConfigGet('unknown-key');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Unknown setting "unknown-key"')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('exclude-paths, exclude-extensions, excludes')
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});

describe('handleConfigClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  describe('exclude-paths', () => {
    it('should clear exclude paths', () => {
      handleConfigClear('exclude-paths');

      expect(clearSetting).toHaveBeenCalledWith('defaultExcludePaths');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('cleared')
      );
    });
  });

  describe('exclude-extensions', () => {
    it('should clear exclude extensions', () => {
      handleConfigClear('exclude-extensions');

      expect(clearSetting).toHaveBeenCalledWith('defaultExcludeExtensions');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('cleared')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('built-in defaults')
      );
    });
  });

  describe('unknown setting', () => {
    it('should error on unknown setting key', () => {
      handleConfigClear('unknown-key');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Unknown setting "unknown-key"')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('exclude-paths, exclude-extensions')
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
