/**
 * E2E tests for version command
 */

import { describe, expect, it } from 'vitest';
import { runCLISuccess } from './helpers';

describe('E2E: version command', () => {
  it('should display version with --version flag', async () => {
    const result = await runCLISuccess(['--version']);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should display version with -V flag', async () => {
    const result = await runCLISuccess(['-V']);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should display version with version command', async () => {
    const result = await runCLISuccess(['version']);
    expect(result.stdout).toMatch(/version.*\d+\.\d+\.\d+/i);
  });

  it('should display version with auth status when --auth-status flag is used', async () => {
    const result = await runCLISuccess(['version', '--auth-status']);
    expect(result.stdout).toMatch(/version.*\d+\.\d+\.\d+/i);
    expect(result.stdout).toMatch(/authenticated/i);
  });

  it('should display version and auth status with combined --version --auth-status', async () => {
    const result = await runCLISuccess(['--version', '--auth-status']);
    expect(result.stdout).toMatch(/version.*\d+\.\d+\.\d+/i);
    expect(result.stdout).toMatch(/authenticated/i);
  });
});

describe('E2E: help command', () => {
  it('should display help with --help flag', async () => {
    const result = await runCLISuccess(['--help']);
    expect(result.stdout).toContain('CLI tool for Firecrawl');
    expect(result.stdout).toContain('scrape');
    expect(result.stdout).toContain('crawl');
    expect(result.stdout).toContain('map');
    expect(result.stdout).toContain('search');
    expect(result.stdout).toContain('extract');
  });

  it('should display scrape command help', async () => {
    const result = await runCLISuccess(['scrape', '--help']);
    expect(result.stdout).toContain('Scrape a URL');
    expect(result.stdout).toContain('--format');
    expect(result.stdout).toContain('--output');
    expect(result.stdout).toContain('--screenshot');
  });

  it('should display crawl command help', async () => {
    const result = await runCLISuccess(['crawl', '--help']);
    expect(result.stdout).toContain('Crawl a website');
    expect(result.stdout).toContain('--wait');
    expect(result.stdout).toContain('--limit');
    expect(result.stdout).toContain('--max-depth');
  });

  it('should display map command help', async () => {
    const result = await runCLISuccess(['map', '--help']);
    expect(result.stdout).toContain('Map URLs');
    expect(result.stdout).toContain('--limit');
    expect(result.stdout).toContain('--search');
    expect(result.stdout).toContain('--sitemap');
  });

  it('should display search command help', async () => {
    const result = await runCLISuccess(['search', '--help']);
    expect(result.stdout).toContain('Search the web');
    expect(result.stdout).toContain('--limit');
    expect(result.stdout).toContain('--sources');
    expect(result.stdout).toContain('--scrape');
  });

  it('should display extract command help', async () => {
    const result = await runCLISuccess(['extract', '--help']);
    expect(result.stdout).toContain('Extract structured data');
    expect(result.stdout).toContain('--prompt');
    expect(result.stdout).toContain('--schema');
  });

  it('should display embed command help', async () => {
    const result = await runCLISuccess(['embed', '--help']);
    expect(result.stdout).toContain('Embed content');
    expect(result.stdout).toContain('--collection');
    expect(result.stdout).toContain('--no-chunk');
  });

  it('should display query command help', async () => {
    const result = await runCLISuccess(['query', '--help']);
    expect(result.stdout).toContain('Semantic search');
    expect(result.stdout).toContain('--limit');
    expect(result.stdout).toContain('--domain');
    expect(result.stdout).toContain('--group');
  });

  it('should display retrieve command help', async () => {
    const result = await runCLISuccess(['retrieve', '--help']);
    expect(result.stdout).toContain('Retrieve full document');
    expect(result.stdout).toContain('--collection');
  });

  it('should display config command help', async () => {
    const result = await runCLISuccess(['config', '--help']);
    expect(result.stdout).toContain('Configure Firecrawl');
    expect(result.stdout).toContain('--api-key');
  });

  it('should display login command help', async () => {
    const result = await runCLISuccess(['login', '--help']);
    expect(result.stdout).toContain('Login to Firecrawl');
  });

  it('should display logout command help', async () => {
    const result = await runCLISuccess(['logout', '--help']);
    expect(result.stdout).toContain('Logout and clear');
  });
});
