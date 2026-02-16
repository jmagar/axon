/**
 * Global constants for the Axon CLI
 *
 * This module defines shared constants used across the application.
 */

/**
 * Default file extensions to exclude from crawling operations
 *
 * These binary and large media files commonly cause worker crashes when the
 * HTML-to-Markdown parser attempts to process them. Users can customize this
 * list via: `axon config set exclude-extensions "ext1,ext2"`
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

/**
 * Default path prefixes to exclude from crawling operations.
 *
 * These primarily target foreign-language route trees and blog pages
 * that are commonly excluded in production crawls.
 *
 * Patterns use glob syntax: /ar/* matches /ar/page.html but not /params/
 */
export const DEFAULT_EXCLUDE_PATHS = [
  // Nested docs locale routes (e.g., /docs/it/*, /docs/es/*).
  // Keep English docs (en, en-US, en-GB) included.
  '\\/(?:docs|reference|guides|guide|how-tos)\\/(?!en(?:-[A-Za-z]{2,4})?\\/)[a-z]{2}(?:-[A-Za-z]{2,4})?\\/',

  '/ar/*',
  '/bg/*',
  '/bn/*',
  '/ca/*',
  '/cs/*',
  '/da/*',
  '/de/*',
  '/el/*',
  '/es/*',
  '/et/*',
  '/fa/*',
  '/fi/*',
  '/fr/*',
  '/he/*',
  '/hi/*',
  '/hr/*',
  '/hu/*',
  '/id/*',
  '/it/*',
  '/ja/*',
  '/ko/*',
  '/lt/*',
  '/lv/*',
  '/ms/*',
  '/nl/*',
  '/no/*',
  '/pl/*',
  '/pt/*',
  '/pt-BR/*',
  '/pt-PT/*',
  '/ro/*',
  '/ru/*',
  '/sk/*',
  '/sl/*',
  '/sr/*',
  '/sv/*',
  '/th/*',
  '/tr/*',
  '/uk/*',
  '/vi/*',
  '/zh/*',
  '/zh-CN/*',
  '/zh-TW/*',
  '/zh-Hans/*',
  '/zh-Hant/*',
  '/blog/',
  '/tag/',
  '/tags/',
  '/category/',
  '/categories/',
  '/author/',
  '/authors/',
  '/search',
  '/search/',
  '/page/',
  '/feed',
  '/rss',
  '/atom',
  '/amp/',
  '/wp-json',
  '/xmlrpc.php',
  '/wp-admin',
  '/wp-login.php',
  '/cdn-cgi/',
  '/print/',
  '\\?output=print',
  '/attachment/',
  '/forum/',
  '/forums/',
  '/community/',
  '/discussions/',
  '/discussion/',
  '/thread/',
  '/threads/',
  '/topic/',
  '/topics/',
  '/question/',
  '/questions/',
  '/viewtopic.php',
  '/member/',
  '/members/',
  '/profile/',
];

/**
 * Maximum concurrent embedding operations to prevent resource exhaustion.
 *
 * This limit controls parallelism when processing multiple documents/URLs
 * through the embedding pipeline. The value balances throughput against
 * memory and network resource consumption.
 *
 * Used by:
 * - EmbedPipeline service (batch embedding orchestration)
 * - extract command (structured data embedding)
 * - search command (search result embedding)
 */
export const MAX_CONCURRENT_EMBEDS = 10;
