'use client'

import { Cpu, Network, Shield, Zap } from 'lucide-react'
import type { PulseSettings } from '@/hooks/use-pulse-settings'
import { getAcpModelConfigOption } from '@/lib/pulse/acp-config'
import type {
  AcpConfigOption,
  PulseAgent,
  PulseModel,
  PulsePermissionLevel,
} from '@/lib/pulse/types'
import { McpSection } from './mcp-section'
import { GLASS_SELECT, SectionDivider, SectionHeader, ToggleRow } from './settings-components'
import { KEYBOARD_SHORTCUTS, PERMISSION_OPTIONS } from './settings-data'

interface SettingsSectionsProps {
  pulseAgent: PulseAgent
  pulseModel: PulseModel
  acpConfigOptions: AcpConfigOption[]
  setPulseModel: (v: PulseModel) => void
  pulsePermissionLevel: PulsePermissionLevel
  setPulsePermissionLevel: (v: PulsePermissionLevel) => void
  settings: PulseSettings
  updateSettings: (patch: Partial<PulseSettings>) => void
}

export function SettingsSections({
  pulseAgent: _pulseAgent,
  pulseModel,
  acpConfigOptions,
  setPulseModel,
  pulsePermissionLevel,
  setPulsePermissionLevel,
  settings,
  updateSettings,
}: SettingsSectionsProps) {
  const acpModelOptions =
    getAcpModelConfigOption(acpConfigOptions)
      ?.options.map((option) => ({
        id: option.value,
        label: option.name,
        sub: option.description ?? '',
      }))
      .filter((o) => o.id) ?? []
  const modelOptions: Array<{ id: string; label: string; sub: string; badge?: string }> =
    acpModelOptions.length > 0
      ? acpModelOptions
      : [{ id: 'default', label: 'Default', sub: 'Loading models...' }]
  const selectedModel = modelOptions.find((option) => option.id === pulseModel) ?? modelOptions[0]
  const selectedPermission =
    PERMISSION_OPTIONS.find((o) => o.id === pulsePermissionLevel) ?? PERMISSION_OPTIONS[0]

  return (
    <>
      {/* Model */}
      <section id="settings-section-model" className="scroll-mt-20">
        <div className="border-l-2 border-l-[var(--border-accent)] pl-3">
          <SectionHeader
            icon={Cpu}
            label="Model"
            description="The Claude model used for all Pulse chat sessions. Passed as --model to the Claude CLI."
          />
        </div>
        <select
          value={pulseModel}
          onChange={(e) => setPulseModel(e.target.value as PulseModel)}
          className={GLASS_SELECT}
          style={{ backdropFilter: 'blur(4px)' }}
        >
          {modelOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
              {opt.badge ? ` (${opt.badge})` : ''} — {opt.sub}
            </option>
          ))}
        </select>
        {selectedModel && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-dim)]">
            {selectedModel.sub}
            {selectedModel.badge && (
              <span className="ml-1.5 rounded-full border border-[rgba(175,215,255,0.2)] bg-[rgba(175,215,255,0.07)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[rgba(175,215,255,0.5)]">
                {selectedModel.badge}
              </span>
            )}
          </p>
        )}
      </section>

      <SectionDivider />

      {/* Permission Mode */}
      <section id="settings-section-permission" className="scroll-mt-20">
        <div className="border-l-2 border-l-[var(--border-accent)] pl-3">
          <SectionHeader
            icon={Shield}
            label="Permission Mode"
            description="Controls how Claude interacts with your filesystem and shell. Passed as --permission-mode to the Claude CLI."
          />
        </div>
        <select
          value={pulsePermissionLevel}
          onChange={(e) => setPulsePermissionLevel(e.target.value as PulsePermissionLevel)}
          className={GLASS_SELECT}
          style={{ backdropFilter: 'blur(4px)' }}
        >
          {PERMISSION_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label} — {opt.sub}
            </option>
          ))}
        </select>
        {selectedPermission && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-dim)]">
            {selectedPermission.sub}
          </p>
        )}

        <div className="mt-5">
          <ToggleRow
            id="settings-auto-approve-permissions"
            label="Auto-approve tool permissions"
            description="When enabled, ACP permission requests are auto-approved after a brief delay. Disable to manually approve or reject each tool invocation."
            checked={settings.autoApprovePermissions}
            onChange={(v) => updateSettings({ autoApprovePermissions: v })}
          />
        </div>
      </section>

      <SectionDivider />

      {/* MCP Servers */}
      <section id="settings-section-mcp" className="scroll-mt-20">
        <div className="border-l-2 border-l-[var(--border-accent)] pl-3">
          <SectionHeader
            icon={Network}
            label="MCP Servers"
            description="Model Context Protocol servers that extend Claude's capabilities with external tools, APIs, and data sources."
          />
        </div>
        <McpSection />
      </section>

      <SectionDivider />

      {/* Keyboard Shortcuts */}
      <section id="settings-section-shortcuts" className="scroll-mt-20">
        <div className="border-l-2 border-l-[var(--border-accent)] pl-3">
          <SectionHeader
            icon={Zap}
            label="Keyboard Shortcuts"
            description="Global shortcuts available throughout the Pulse workspace and omnibox."
          />
        </div>
        <div
          className="overflow-hidden rounded-xl border border-[var(--border-subtle)]"
          style={{ background: 'rgba(10,18,35,0.58)', backdropFilter: 'blur(8px)' }}
        >
          {KEYBOARD_SHORTCUTS.map(({ keys, desc }, idx) => (
            <div
              key={desc}
              className={`flex items-center justify-between px-4 py-3 ${
                idx < KEYBOARD_SHORTCUTS.length - 1 ? 'border-b border-[var(--border-subtle)]' : ''
              }`}
            >
              <span className="text-[12px] text-[var(--text-dim)]">{desc}</span>
              <div className="flex items-center gap-1">
                {keys.map((k, ki) => (
                  <span key={k} className="flex items-center gap-1">
                    {ki > 0 && <span className="text-[10px] text-[var(--text-dim)]">+</span>}
                    <kbd className="rounded border border-[var(--border-subtle)] bg-[rgba(10,18,35,0.6)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-dim)]">
                      {k}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom breathing room */}
      <div className="h-16" />
    </>
  )
}
