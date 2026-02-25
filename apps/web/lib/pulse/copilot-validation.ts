import { z } from 'zod'

export const CopilotRequestSchema = z.object({
  prompt: z.string().min(1),
  system: z.string().optional(),
  model: z.string().optional(),
})

export interface CopilotValidationResult {
  valid: boolean
  error?: string
}

export function validateCopilotRequest(body: unknown): CopilotValidationResult {
  const result = CopilotRequestSchema.safeParse(body)
  if (result.success) {
    return { valid: true }
  }
  const firstIssue = result.error.issues[0]
  return {
    valid: false,
    error: firstIssue
      ? `${firstIssue.path.join('.') || 'request'}: ${firstIssue.message}`
      : 'Invalid request',
  }
}
