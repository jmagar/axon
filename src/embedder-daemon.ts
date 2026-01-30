/**
 * Embedder daemon entry point
 *
 * Runs as a background process to handle async embedding jobs.
 */

import { config as loadDotenv } from 'dotenv';
import { startEmbedderDaemon } from './utils/background-embedder';
import { initializeConfig } from './utils/config';

// Load environment variables
loadDotenv();

// Initialize config
initializeConfig();

// Start daemon
startEmbedderDaemon().catch((error) => {
  console.error('[Embedder] Fatal error:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.error('[Embedder] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[Embedder] Received SIGINT, shutting down gracefully');
  process.exit(0);
});
