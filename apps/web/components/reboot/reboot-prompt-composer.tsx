'use client'

import {
  FileCode2,
  Paperclip,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  type PromptInputFile,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { McpServersState } from '@/hooks/use-mcp-servers'
import { REBOOT_PERMISSION_OPTIONS, type RebootPermissionValue } from './reboot-mock-data'

const REBOOT_COMPOSER_PANEL_CLASS =
  'border-[rgba(175,215,255,0.14)] bg-[linear-gradient(180deg,rgba(10,18,35,0.92),rgba(5,10,22,0.98))] shadow-[0_14px_40px_rgba(0,0,0,0.34)] backdrop-blur-xl'

function ComposerDropdownTrigger({ children, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className="inline-flex size-7 items-center justify-center rounded border border-[rgba(175,215,255,0.14)] bg-[rgba(255,255,255,0.04)] text-[var(--text-secondary)] transition-colors hover:border-[rgba(175,215,255,0.22)] hover:text-[var(--text-primary)]"
      {...props}
    >
      {children}
    </button>
  )
}

function getPermissionIcon(permissionLevel: string) {
  if (permissionLevel === 'plan') return Shield
  if (permissionLevel === 'bypass-permissions') return ShieldOff
  return ShieldCheck
}

function formatToolSelectionLabel(enabledCount: number, totalCount: number) {
  if (totalCount === 0) return 'No MCP tools'
  if (enabledCount === totalCount) return `Tools \u00b7 All ${totalCount}`
  if (enabledCount === 0) return 'Tools \u00b7 None'
  return `Tools \u00b7 ${enabledCount}/${totalCount}`
}

function RebootAttachmentPill({
  file,
  onRemove,
}: {
  file: PromptInputFile
  onRemove?: () => void
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-[rgba(175,215,255,0.16)] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-xs leading-none text-[var(--text-secondary)]">
      <FileCode2 className="size-3.5 shrink-0 text-[var(--axon-primary)]" />
      <span className="truncate">{file.filename ?? file.url}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 inline-flex size-4 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:text-[var(--text-primary)]"
          aria-label={`Remove ${file.filename ?? file.url}`}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  )
}

export function RebootPromptComposer({
  files,
  onFilesChange,
  onSubmit,
  modelOptions,
  pulseModel,
  pulsePermissionLevel,
  onModelChange,
  onPermissionChange,
  toolsState,
  onToggleMcpServer,
  compact = false,
}: {
  files: PromptInputFile[]
  onFilesChange: (files: PromptInputFile[]) => void
  onSubmit: (message: PromptInputMessage) => void | Promise<void>
  modelOptions: Array<{ value: string; label: string }>
  pulseModel: string
  pulsePermissionLevel: RebootPermissionValue
  onModelChange: (value: string) => void
  onPermissionChange: (value: RebootPermissionValue) => void
  toolsState: McpServersState
  onToggleMcpServer: (serverName: string) => void
  compact?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const PermissionIcon = getPermissionIcon(pulsePermissionLevel)
  const toolLabel = formatToolSelectionLabel(
    toolsState.enabledMcpServers.length,
    toolsState.mcpServers.length,
  )

  function handleFilePick(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? [])
    if (selectedFiles.length === 0) return
    onFilesChange([
      ...files,
      ...selectedFiles.map((file) => ({
        url: `file://${file.name}`,
        filename: file.name,
        mediaType: file.type || undefined,
      })),
    ])
    event.target.value = ''
  }

  return (
    <PromptInput
      onSubmit={onSubmit}
      files={files}
      onFilesChange={onFilesChange}
      className={`w-full rounded-[18px] p-0 ${REBOOT_COMPOSER_PANEL_CLASS}`}
    >
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePick} />
      <div className="px-3 pb-3 pt-3">
        <PromptInputAttachments>
          {files.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <RebootAttachmentPill
                  key={`${file.url}-${index}`}
                  file={file}
                  onRemove={() =>
                    onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))
                  }
                />
              ))}
            </div>
          ) : null}
        </PromptInputAttachments>

        <PromptInputBody className="items-start gap-2">
          <PromptInputTextarea
            className={`${compact ? 'min-h-16 max-h-56' : 'min-h-20 max-h-72'} rounded-[14px] border border-[rgba(175,215,255,0.08)] bg-[rgba(3,7,18,0.38)] px-3 py-2.5 leading-6`}
            placeholder="Keep the current Axon look. Change only the shell."
          />
        </PromptInputBody>

        <PromptInputFooter className="mt-2 flex items-center justify-end gap-2">
          <div className="min-w-0 flex-1" />
          <div className="min-w-0 overflow-hidden">
            <PromptInputTools className="-mx-0.5 flex flex-nowrap items-center gap-2 overflow-x-auto px-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ComposerDropdownTrigger aria-label={toolLabel}>
                    <Wrench className="size-3.5 text-[var(--axon-primary)]" />
                  </ComposerDropdownTrigger>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-72 border-[var(--border-subtle)] bg-[var(--glass-overlay)] text-[var(--text-primary)] backdrop-blur-xl"
                >
                  <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
                    MCP server tools
                  </DropdownMenuLabel>
                  <div className="px-2 pb-2 text-[11px] leading-5 text-[var(--text-dim)]">
                    Granular per-tool toggles can hang off this next. For now this scopes by MCP
                    server.
                  </div>
                  <DropdownMenuSeparator className="bg-[rgba(175,215,255,0.08)]" />
                  {toolsState.mcpServers.length > 0 ? (
                    toolsState.mcpServers.map((serverName) => {
                      const serverStatus = toolsState.mcpStatusByServer[serverName] ?? 'unknown'
                      return (
                        <DropdownMenuCheckboxItem
                          key={serverName}
                          checked={toolsState.enabledMcpServers.includes(serverName)}
                          onCheckedChange={() => onToggleMcpServer(serverName)}
                          className="gap-2 py-2"
                        >
                          <span className="truncate">{serverName}</span>
                          <span
                            className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                              serverStatus === 'online'
                                ? 'bg-[rgba(64,196,128,0.12)] text-[rgba(128,220,160,0.92)]'
                                : serverStatus === 'offline'
                                  ? 'bg-[rgba(255,135,175,0.12)] text-[rgba(255,170,196,0.86)]'
                                  : 'bg-[rgba(175,215,255,0.08)] text-[var(--text-dim)]'
                            }`}
                          >
                            {serverStatus}
                          </span>
                        </DropdownMenuCheckboxItem>
                      )
                    })
                  ) : (
                    <div className="px-2 py-2 text-xs text-[var(--text-dim)]">
                      No MCP servers configured yet.
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ComposerDropdownTrigger
                    aria-label={
                      modelOptions.find((option) => option.value === pulseModel)?.label ??
                      pulseModel
                    }
                  >
                    <Sparkles className="size-3.5 text-[var(--axon-primary)]" />
                  </ComposerDropdownTrigger>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 border-[var(--border-subtle)] bg-[var(--glass-overlay)] text-[var(--text-primary)] backdrop-blur-xl"
                >
                  <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
                    Model
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={pulseModel} onValueChange={onModelChange}>
                    {modelOptions.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ComposerDropdownTrigger
                    aria-label={
                      REBOOT_PERMISSION_OPTIONS.find(
                        (option) => option.value === pulsePermissionLevel,
                      )?.label ?? pulsePermissionLevel
                    }
                  >
                    <PermissionIcon className="size-3.5 text-[var(--axon-secondary-strong)]" />
                  </ComposerDropdownTrigger>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 border-[var(--border-subtle)] bg-[var(--glass-overlay)] text-[var(--text-primary)] backdrop-blur-xl"
                >
                  <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
                    Permission
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={pulsePermissionLevel}
                    onValueChange={(value) => onPermissionChange(value as RebootPermissionValue)}
                  >
                    {REBOOT_PERMISSION_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </PromptInputTools>
          </div>

          <PromptInputButton
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </PromptInputButton>

          <div className="shrink-0">
            <PromptInputSubmit />
          </div>
        </PromptInputFooter>
      </div>
    </PromptInput>
  )
}
