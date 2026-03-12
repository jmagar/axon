import { Bot, FolderOpen, MessageSquareText } from 'lucide-react'

export type RailMode = 'sessions' | 'files' | 'assistant'

export type AxonPermissionValue = (typeof AXON_PERMISSION_OPTIONS)[number]['value']

/** Shape of a single entry in {@link RAIL_MODES}. */
export interface RailModeItem {
  id: RailMode
  label: string
  icon: typeof MessageSquareText
}

export const RAIL_MODES: ReadonlyArray<RailModeItem> = [
  { id: 'sessions', label: 'Sessions', icon: MessageSquareText },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'assistant', label: 'Assistant', icon: Bot },
]

export const AXON_PERMISSION_OPTIONS = [
  { value: 'plan', label: 'Plan' },
  { value: 'accept-edits', label: 'Accept edits' },
  { value: 'bypass-permissions', label: 'Bypass' },
] as const
