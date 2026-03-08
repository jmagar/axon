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
}

export type RebootPermissionValue = (typeof REBOOT_PERMISSION_OPTIONS)[number]['value']

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

export const SESSION_ITEMS: SessionItem[] = [
  {
    id: 'auth-flow',
    title: 'Implement auth flow',
    repo: 'axon-web',
    branch: 'main',
    agent: 'Cortex',
    lastMessageAt: '2:35 PM',
    hasUnread: true,
  },
  {
    id: 'sidebar-layout',
    title: 'Fix sidebar layout',
    repo: 'axon-web',
    branch: 'feature/sidebar',
    agent: 'Codex',
    lastMessageAt: '11:48 AM',
  },
  {
    id: 'terminal-drawer',
    title: 'Add terminal drawer',
    repo: 'axon-web',
    branch: 'feature/terminal',
    agent: 'Claude',
    lastMessageAt: 'Yesterday 8:14 PM',
    hasUnread: true,
  },
  {
    id: 'hooks-refactor',
    title: 'Refactor hooks',
    repo: 'axon-core',
    branch: 'main',
    agent: 'Gemini',
    lastMessageAt: 'Mar 5 4:22 PM',
  },
]

export const PAGE_ITEMS = [
  { href: '/', label: 'Conversations', icon: MessageSquareText, group: 'primary' },
  { href: '/reboot', label: 'Reboot', icon: Sparkles, group: 'primary' },
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

export const INITIAL_MESSAGES: Record<string, MessageItem[]> = {
  'auth-flow': [
    {
      id: 'm1',
      role: 'user',
      content:
        'I need to implement a secure authentication flow for the Axon web app. We should use Supabase for auth.',
    },
    {
      id: 'm2',
      role: 'assistant',
      content:
        "I'll keep this scoped. We add the client, auth state, protected routes, and the social providers. The important part for this shell is that files stay visible while the session moves.",
      reasoning:
        'The shell should stop acting like site navigation. The left pane owns context selection, the center owns the active exchange, and the right pane stays ready for artifact focus.',
      steps: [
        { label: 'Analyzing project structure', status: 'complete' },
        {
          label: 'Identified auth integration points',
          description: 'Supabase client, OAuth providers, session middleware',
          status: 'complete',
        },
        {
          label: 'Planning route protection strategy',
          description: 'Middleware-based guards with redirect to /login',
          status: 'complete',
        },
        { label: 'Generated auth scaffolding', status: 'complete' },
      ],
      files: ['lib/supabase.ts', 'lib/auth.ts'],
    },
    {
      id: 'm3',
      role: 'assistant',
      content:
        'The layout now stays stable: session list left, active chat center, working file right. No route change required when a file becomes active.',
      reasoning:
        'This keeps velocity high. You can move from planning to file work without losing the session thread or replacing the full screen with a different page.',
      steps: [
        { label: 'Reviewed current shell layout', status: 'complete' },
        {
          label: 'Mapped pane lifecycle to session state',
          description: 'Sidebar, chat, and editor are independent — no coupled route transitions',
          status: 'complete',
        },
        { label: 'Updated grid template columns', status: 'complete' },
      ],
      files: ['apps/web/components/reboot/reboot-shell.tsx'],
    },
  ],
  'sidebar-layout': [
    {
      id: 'm4',
      role: 'user',
      content: 'The sidebar is carrying too much navigation. I want the left side to be focused.',
    },
    {
      id: 'm5',
      role: 'assistant',
      content:
        'Then the left panel becomes a context rail, not a site map. A dropdown selects the mode and the panel body changes without growing the chrome.',
      reasoning:
        'A compact mode switcher lets one narrow rail host multiple responsibilities without restoring the current oversized sidebar.',
      steps: [
        { label: 'Audited current sidebar responsibilities', status: 'complete' },
        {
          label: 'Designed rail mode switcher',
          description: 'Sessions, files, pages, agents — one dropdown, one body',
          status: 'complete',
        },
        { label: 'Refactored sidebar to context rail', status: 'complete' },
      ],
      files: ['apps/web/components/pulse/sidebar/pulse-sidebar.tsx'],
    },
  ],
  'terminal-drawer': [
    {
      id: 'm6',
      role: 'assistant',
      content:
        'The terminal remains a bottom drawer. It should support the workflow, not compete with the three primary panes.',
      reasoning:
        'The terminal is auxiliary. It should be reachable instantly, but it should not steal one of the three permanent columns.',
      files: ['apps/web/components/reboot/reboot-terminal-pane.tsx'],
    },
  ],
  'hooks-refactor': [
    {
      id: 'm7',
      role: 'assistant',
      content:
        'Once the shell is right, the hooks can own behavior instead of compensating for layout churn.',
      reasoning:
        'Right now the shell is the contract. Once that stabilizes, behavior hooks can focus on state instead of layout recovery.',
      files: ['apps/web/hooks/use-pulse-workspace.ts'],
    },
  ],
}

export const EDITOR_FILES: Record<string, string> = {
  'lib/supabase.ts': `import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
`,
  'lib/auth.ts': `import { supabase } from './supabase'

export async function signInWithGithub() {
  return supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: \`\${window.location.origin}/auth/callback\` },
  })
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: \`\${window.location.origin}/auth/callback\` },
  })
}
`,
  'apps/web/components/reboot/reboot-shell.tsx': `## Reboot shell

- left rail is mode-driven
- center pane is the active workflow
- right pane is the real Plate editor
- bottom pane is the live terminal
`,
  'apps/web/components/pulse/sidebar/pulse-sidebar.tsx': `## Sidebar migration

The large permanent sidebar is no longer the model for reboot.
Navigation should happen inside the left rail dropdown and its contextual body.
`,
  'apps/web/components/reboot/reboot-terminal-pane.tsx': `## Terminal pane

The reboot shell uses the live shell session and the real terminal emulator.
The bottom pane can collapse without disturbing the three primary panes.
`,
  'apps/web/hooks/use-pulse-workspace.ts': `## Workspace behavior

Once the shell geometry is stable, this hook can focus on behavior and persistence.
`,
}

export const REBOOT_FALLBACK_MODEL_OPTIONS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
] as const

export const REBOOT_PERMISSION_OPTIONS = [
  { value: 'plan', label: 'Plan' },
  { value: 'accept-edits', label: 'Accept edits' },
  { value: 'bypass-permissions', label: 'Bypass' },
] as const
