/**
 * Delete command types
 * Defines interfaces for vector deletion operations
 */
import type { CommandResult } from './common';

export interface DeleteOptions {
  url?: string;
  domain?: string;
  all?: boolean;
  yes?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
}

export type DeleteResult = CommandResult<{
  deleted: number;
  target: string;
  targetType: 'url' | 'domain' | 'all';
}>;
