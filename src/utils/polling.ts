/**
 * Generic polling with progress tracking, timeout, and terminal UX
 */

/**
 * Configuration for polling with progress
 */
export interface PollingConfig<T> {
  /** Unique job identifier */
  jobId: string;
  /** Function to fetch current status */
  statusFetcher: (jobId: string) => Promise<T>;
  /** Polling interval in milliseconds */
  pollInterval: number;
  /** Optional timeout in milliseconds */
  timeout?: number;
  /** Whether to show progress in terminal */
  showProgress?: boolean;
  /** Function to determine if polling is complete */
  isComplete: (status: T) => boolean;
  /** Function to format progress text for display */
  formatProgress: (status: T) => string;
}

/**
 * Poll for status with progress tracking and timeout
 *
 * @param config - Polling configuration
 * @returns Final status when complete
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * const result = await pollWithProgress({
 *   jobId: 'job-123',
 *   statusFetcher: async (id) => app.getCrawlStatus(id),
 *   pollInterval: 5000,
 *   timeout: 60000,
 *   showProgress: true,
 *   isComplete: (status) => status.status === 'completed',
 *   formatProgress: (status) => `Progress: ${status.completed}/${status.total}`,
 * });
 * ```
 */
export async function pollWithProgress<T>(
  config: PollingConfig<T>
): Promise<T> {
  const {
    jobId,
    statusFetcher,
    pollInterval,
    timeout,
    showProgress,
    isComplete,
    formatProgress,
  } = config;

  // Validate timeout
  if (timeout !== undefined && timeout <= 0) {
    throw new Error('Timeout must be a positive number');
  }

  const startTime = Date.now();
  let isFirstPoll = true;

  while (true) {
    // Skip delay on first poll to avoid unnecessary waiting
    if (!isFirstPoll) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    isFirstPoll = false;

    // Check timeout BEFORE making the API call
    if (timeout && Date.now() - startTime > timeout) {
      if (showProgress) {
        process.stderr.write('\n');
      }
      throw new Error(
        `Timeout after ${timeout / 1000} seconds. Job still in progress.`
      );
    }

    // Fetch status with error handling
    let status: T;
    try {
      status = await statusFetcher(jobId);
    } catch (error) {
      if (showProgress) {
        process.stderr.write('\n');
      }
      throw new Error(
        `Failed to fetch status: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Show progress if enabled
    if (showProgress) {
      const progressText = formatProgress(status);
      process.stderr.write(`\r${progressText}`);
    }

    // Check completion
    if (isComplete(status)) {
      if (showProgress) {
        process.stderr.write('\n');
      }
      return status;
    }
  }
}
