import {
  Bot,
  Brain,
  Columns2,
  FilePenLine,
  FolderOpen,
  Layers,
  MessageSquareText,
  Network,
  PanelLeft,
  ScrollText,
  Settings2,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import type { PulseMessageBlock, PulseToolUse } from '@/lib/pulse/types'

export type RailMode = 'sessions' | 'files' | 'pages' | 'agents'

export type SessionItem = {
  id: string
  title: string
  repo: string
  branch: string
  agent: string
  lastMessageAt: string
  hasUnread?: boolean
}

export type ReasoningStep = {
  label: string
  description?: string
  status?: 'complete' | 'active' | 'pending'
}

export type MessageItem = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  steps?: ReasoningStep[]
  files?: string[]
  timestamp?: string
  blocks?: PulseMessageBlock[]
  toolUses?: PulseToolUse[]
}

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

export const PAGE_ITEMS = [
  { href: '/', label: 'Conversations', icon: MessageSquareText, group: 'primary' },
  { href: '/reboot', label: 'Axon', icon: Sparkles, group: 'primary' },
  { href: '/editor', label: 'Editor', icon: FilePenLine, group: 'primary' },
  { href: '/jobs', label: 'Jobs', icon: Layers, group: 'primary' },
  { href: '/logs', label: 'Logs', icon: ScrollText, group: 'primary' },
  { href: '/terminal', label: 'Terminal', icon: TerminalSquare, group: 'primary' },
  { href: '/evaluate', label: 'Evaluate', icon: Columns2, group: 'primary' },
  { href: '/cortex/status', label: 'Cortex', icon: Brain, group: 'primary' },
  { href: '/settings/mcp', label: 'MCP Servers', icon: Network, group: 'primary' },
  { href: '/agents', label: 'Agents', icon: Bot, group: 'footer' },
  { href: '/settings', label: 'Settings', icon: Settings2, group: 'footer' },
] as const

export const AGENT_ITEMS = [
  { name: 'Cortex', detail: 'Primary workflow assistant', status: 'active' },
  { name: 'Codex', detail: 'Implementation and review lane', status: 'ready' },
  { name: 'Claude', detail: 'Planning and synthesis lane', status: 'ready' },
  { name: 'Gemini', detail: 'Research and cross-check lane', status: 'ready' },
] as const

export const AXON_PERMISSION_OPTIONS = [
  { value: 'plan', label: 'Plan' },
  { value: 'accept-edits', label: 'Accept edits' },
  { value: 'bypass-permissions', label: 'Bypass' },
] as const
