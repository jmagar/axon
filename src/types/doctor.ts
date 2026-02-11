export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export type DoctorOverallStatus = 'ok' | 'degraded' | 'failed';

export interface DoctorCheck {
  category: 'docker' | 'services' | 'directories' | 'ai_cli' | 'config_files';
  name: string;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorSummaryCounts {
  pass: number;
  warn: number;
  fail: number;
}

export interface DoctorReport {
  timestamp: string;
  overallStatus: DoctorOverallStatus;
  summary: DoctorSummaryCounts;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  json?: boolean;
  pretty?: boolean;
  timeout?: number;
}
