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

export type RailMode = 'sessions' | 'files' | 'pages' | 'agents'

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
  { id: 'pages', label: 'Pages', icon: PanelLeft },
  { id: 'agents', label: 'Agents', icon: Bot },
]

export const AXON_PERMISSION_OPTIONS = [
  { value: 'plan', label: 'Plan' },
  { value: 'accept-edits', label: 'Accept edits' },
  { value: 'bypass-permissions', label: 'Bypass' },
] as const

/** Shape of a single entry in {@link PAGE_ITEMS}. */
export interface PageItem {
  href: string
  label: string
  icon: typeof MessageSquareText
  group: 'primary' | 'footer'
}

export const PAGE_ITEMS: ReadonlyArray<PageItem> = [
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
]

/** Shape of a single entry in {@link AGENT_ITEMS}. */
export interface AgentItem {
  name: string
  detail: string
  status: string
}

export const AGENT_ITEMS: ReadonlyArray<AgentItem> = [
  { name: 'Cortex', detail: 'Primary workflow assistant', status: 'active' },
  { name: 'Codex', detail: 'Implementation and review lane', status: 'ready' },
  { name: 'Claude', detail: 'Planning and synthesis lane', status: 'ready' },
  { name: 'Gemini', detail: 'Research and cross-check lane', status: 'ready' },
]
