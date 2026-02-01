/**
 * Crawl command module
 *
 * Provides crawling functionality with async job management,
 * status checking, and optional auto-embedding.
 *
 * Exports:
 * - createCrawlCommand: CLI command definition
 * - handleCrawlCommand: Command execution handler
 * - executeCrawl: Core crawl execution
 * - executeCrawlCancel: Cancel a crawl job
 * - executeCrawlErrors: Get errors for a crawl job
 */

export { createCrawlCommand, handleCrawlCommand } from './command';
export { executeCrawl } from './execute';
export { executeCrawlCancel, executeCrawlErrors } from './status';
