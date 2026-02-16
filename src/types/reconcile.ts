import type { ReconciliationDomainStatus } from '../utils/crawl-reconciliation';
import type { CommandResult } from './common';

export interface ReconcileStatusOptions {
  domain?: string;
  output?: string;
  json?: boolean;
  pretty?: boolean;
}

export interface ReconcileRunOptions {
  domain: string;
  apply?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
  pretty?: boolean;
  now?: Date;
}

export interface ReconcileResetOptions {
  domain?: string;
  yes?: boolean;
  output?: string;
  json?: boolean;
  pretty?: boolean;
}

export interface ReconcileStatusData {
  domains: ReconciliationDomainStatus[];
  totalDomains: number;
  totalTrackedUrls: number;
  totalMissingUrls: number;
  totalEligibleForDeleteNow: number;
}

export interface ReconcileRunData {
  domain: string;
  sourceUrl: string;
  seenUrls: number;
  apply: boolean;
  trackedBefore: number;
  trackedAfter: number;
  candidateDeletes: number;
  deletedCount: number;
  deletedUrls: string[];
}

export interface ReconcileResetData {
  domain?: string;
  removedDomains: number;
  removedUrls: number;
}

export type ReconcileStatusResult = CommandResult<ReconcileStatusData>;
export type ReconcileRunResult = CommandResult<ReconcileRunData>;
export type ReconcileResetResult = CommandResult<ReconcileResetData>;
