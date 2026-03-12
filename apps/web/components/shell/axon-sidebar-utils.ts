export function formatLastMessageTime(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function formatSessionSubtitle(repo?: string, project?: string, branch?: string): string {
  const location = repo?.trim() || project?.trim() || ''
  const branchText = branch?.trim() || ''
  if (location && branchText) return `${location} • ${branchText}`
  if (location) return location
  if (branchText) return branchText
  return ''
}

function sanitizePreviewForTitle(text: string): string {
  return text
    .replace(/^<system-handoff>[\s\S]*?<\/system-handoff>\s*/i, '')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatSessionTitle(preview?: string, project?: string): string {
  const raw = sanitizePreviewForTitle(preview?.trim() || '')
  if (raw && raw.toLowerCase() !== 'axon' && raw.toLowerCase() !== 'local command caveat') {
    if (raw.startsWith('rollout-')) return 'Rollout session'
    if (raw.startsWith('<local-command-caveat>')) return 'Local command caveat'
    if (raw.length > 72) return `${raw.slice(0, 69)}…`
    return raw
  }
  const fallback = (project?.trim() || 'Untitled session').replace(/\s+/g, ' ')
  if (fallback.startsWith('rollout-')) return 'Rollout session'
  if (fallback.startsWith('<local-command-caveat>')) return 'Local command caveat'
  if (fallback.length > 72) return `${fallback.slice(0, 69)}…`
  return fallback
}
