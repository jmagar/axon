/**
 * Zod schemas for runtime validation of stored data
 *
 * These schemas provide type-safe validation for:
 * - User credentials (API keys, URLs)
 * - User settings (exclude paths, preferences)
 *
 * All schemas use .strict() mode to reject unknown fields and prevent injection attacks.
 */

import { z } from 'zod';

/**
 * Schema for stored credentials file (~/.firecrawl/credentials.json by default)
 *
 * Example:
 * ```json
 * {
 *   "apiKey": "fc-abc123",
 *   "apiUrl": "https://api.firecrawl.dev"
 * }
 * ```
 */
export const StoredCredentialsSchema = z
  .object({
    apiKey: z.string().optional(),
    apiUrl: z.string().url().optional(),
  })
  .strict();

/**
 * Schema for user settings file (~/.firecrawl/settings.json by default)
 *
 * Example:
 * ```json
 * {
 *   "defaultExcludePaths": ["node_modules/**", ".git/**"],
 *   "defaultExcludeExtensions": [".pkg", ".exe", ".dmg"]
 * }
 * ```
 */
export const UserSettingsSchema = z
  .object({
    defaultExcludePaths: z.array(z.string()).optional(),
    defaultExcludeExtensions: z.array(z.string()).optional(),
  })
  .strict();

// Export TypeScript types inferred from schemas
export type StoredCredentials = z.infer<typeof StoredCredentialsSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
