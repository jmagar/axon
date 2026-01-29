/**
 * Tests for job utility functions
 */

import { describe, expect, it } from 'vitest';
import { isJobId, isValidUrl } from '../../utils/job';

describe('isJobId', () => {
  it('should return true for valid UUID v4 format', () => {
    expect(isJobId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isJobId('123e4567-e89b-42d3-a456-426614174000')).toBe(true); // Fixed: version digit must be 4
    expect(isJobId('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isJobId('ffffffff-ffff-4fff-8fff-ffffffffffff')).toBe(true);
  });

  it('should return false for invalid UUID formats', () => {
    expect(isJobId('not-a-uuid')).toBe(false);
    expect(isJobId('550e8400-e29b-41d4-a716')).toBe(false);
    expect(isJobId('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
    expect(isJobId('')).toBe(false);
  });

  it('should return false for URLs', () => {
    expect(isJobId('https://example.com')).toBe(false);
    expect(isJobId('http://example.com/page')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(isJobId('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    expect(isJobId('550e8400-E29b-41d4-A716-446655440000')).toBe(true);
  });

  it('should return true for UUID v7 format', () => {
    // UUID v7 has version 7 in the third group — used by self-hosted Firecrawl
    expect(isJobId('019bfe41-f924-77db-8041-13f0d170c87e')).toBe(true);
    expect(isJobId('019bfe41-f924-7aaa-bbbb-cccccccccccc')).toBe(true);
  });

  it('should return true for other UUID versions (v1, v5, v6)', () => {
    // UUID v1
    expect(isJobId('550e8400-e29b-11d4-a716-446655440000')).toBe(true);
    // UUID v5-like
    expect(isJobId('550e8400-e29b-51d4-a716-446655440000')).toBe(true);
  });
});

describe('isValidUrl', () => {
  it('should return true for valid HTTP URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('https://example.com/path')).toBe(true);
    expect(isValidUrl('https://example.com/path?query=value')).toBe(true);
    expect(isValidUrl('https://example.com:8080/path')).toBe(true);
  });

  it('should return false for invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('example.com')).toBe(false);
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl('ftp://example.com')).toBe(true); // Still valid URL
  });

  it('should handle edge cases', () => {
    expect(isValidUrl('http://')).toBe(false);
    expect(isValidUrl('https://')).toBe(false);
  });
});
