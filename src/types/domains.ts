/**
 * Domains command types
 */
import type { CommandResult } from './common';

export interface DomainInfo {
  domain: string;
  urlCount: number;
  vectorCount: number;
  lastUpdated: string;
}

export interface DomainsOptions {
  limit?: number;
  collection?: string;
  output?: string;
  json?: boolean;
}

export type DomainsResult = CommandResult<{
  domains: DomainInfo[];
  totalDomains: number;
  totalUrls: number;
  totalVectors: number;
}>;
