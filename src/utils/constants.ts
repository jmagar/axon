/**
 * Global constants for the Firecrawl CLI
 *
 * This module defines shared constants used across the application.
 */

/**
 * Default file extensions to exclude from crawling operations
 *
 * These binary and large media files commonly cause worker crashes when the
 * HTML-to-Markdown parser attempts to process them. Users can customize this
 * list via: `firecrawl config set exclude-extensions "ext1,ext2"`
 *
 * Categories:
 * - Executables/Installers: Files that execute code or install software
 * - Archives: Compressed archives that don't contain HTML content
 * - Media: Large binary files (images, audio, video, documents)
 * - Fonts: Web font files
 */
export const DEFAULT_EXCLUDE_EXTENSIONS = [
  // Executables and installers
  '.exe',
  '.msi',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',

  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',

  // Media files
  '.mp4',
  '.mp3',
  '.avi',
  '.mov',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.pdf',

  // Fonts
  '.ttf',
  '.woff',
  '.woff2',
];
