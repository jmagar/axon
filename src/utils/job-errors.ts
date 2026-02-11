/**
 * Shared error classification helpers for job-related operations.
 *
 * Used by both crawl/status cleanup and the background embedder daemon
 * to identify permanent vs transient job errors.
 */

/**
 * Check if an error message indicates the job no longer exists on the server.
 *
 * @param error - Error message string to classify
 * @returns true if the error indicates a not-found / invalid job
 */
export function isJobNotFoundError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes('job not found') ||
    normalized.includes('invalid job id')
  );
}
