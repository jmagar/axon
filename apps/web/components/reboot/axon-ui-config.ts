import { Bot, FolderOpen, MessageSquareText, PanelLeft } from 'lucide-react'

export type RailMode = 'sessions' | 'files' | 'pages' | 'agents'

export type AxonPermissionValue = (typeof AXON_PERMISSION_OPTIONS)[number]['value']

export const RAIL_MODES: Array<{
  id: RailMode
  label: string
  icon: typeof MessageSquareText
}> = [
  { id: 'sessions', label: 'Sessions', icon: MessageSquareText },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'pages', label: 'Pages', icon: PanelLeft },
  { id: 'agents', label: 'Agents', icon: Bot },
]

export const AXON_PERMISSION_OPTIONS = [
  { value: 'plan', label: 'Plan' },
  { value: 'accept-edits', label: 'Accept edits' },
  { value: 'bypass-permissions', label: 'Bypass' },
] as const
