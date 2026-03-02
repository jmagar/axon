import type { LocalDocFile, MentionKind } from '@/lib/omnibox'
import type { ModeCategory, ModeDefinition, ModeId } from '@/lib/ws-protocol'
import type { CommandOptionValues } from '../command-options-panel'

export interface CompletionStatus {
  type: 'done' | 'error'
  text: string
  exitCode?: number
}

export type { CommandOptionValues, LocalDocFile, MentionKind, ModeCategory, ModeDefinition, ModeId }
