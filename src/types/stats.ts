/**
 * Stats command types
 */
import type { CommandResult } from './common';

export interface DomainStats {
  domain: string;
  vectorCount: number;
  sourceCount: number;
}

export interface SourceCommandStats {
  command: string;
  vectorCount: number;
}

export interface StatsData {
  collection: string;
  status: string;
  vectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  dimension: number;
  distance: string;
  byDomain: DomainStats[];
  bySourceCommand: SourceCommandStats[];
}

export interface StatsOptions {
  verbose?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
}

export type StatsResult = CommandResult<StatsData>;
