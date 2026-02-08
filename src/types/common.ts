/**
 * Shared command result envelope used across command type definitions.
 */
export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
