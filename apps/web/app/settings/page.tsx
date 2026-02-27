'use client'

import {
  ArrowLeft,
  Brain,
  Cpu,
  Gauge,
  Info,
  RotateCcw,
  Shield,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DEFAULT_PULSE_SETTINGS, usePulseSettings } from '@/hooks/use-pulse-settings'
import { useWsMessages } from '@/hooks/use-ws-messages'
import type { PulseModel, PulsePermissionLevel } from '@/lib/pulse/types'

// ── Option data ───────────────────────────────────────────────────────────────

const MODEL_OPTIONS: { id: PulseModel; label: string; sub: string; badge?: string }[] = [
  {
    id: 'sonnet',
    label: 'Claude Sonnet 4.6',
    sub: 'Balanced intelligence and speed',
    badge: 'Default',
  },
  { id: 'opus', label: 'Claude Opus 4.6', sub: 'Most capable — best for complex tasks' },
  { id: 'haiku', label: 'Claude Haiku 4.5', sub: 'Fastest response — most efficient' },
]

const PERMISSION_OPTIONS: {
  id: PulsePermissionLevel
  label: string
  sub: string
  icon: React.ComponentType<{ className?: string }>
  accentColor: string
}[] = [
  {
    id: 'plan',
    label: 'Plan',
    sub: 'Read-only analysis — no file changes or commands executed',
    icon: Shield,
    accentColor: 'rgba(175,215,255,0.7)',
  },
  {
    id: 'accept-edits',
    label: 'Accept Edits',
    sub: 'Claude proposes changes; you confirm each edit before it applies',
    icon: ShieldCheck,
    accentColor: 'rgba(255,135,175,0.7)',
  },
  {
    id: 'bypass-permissions',
    label: 'Bypass Permissions',
    sub: 'Apply all changes directly without confirmation prompts',
    icon: ShieldOff,
    accentColor: 'rgba(255,175,100,0.7)',
  },
]

const EFFORT_OPTIONS: {
  id: 'low' | 'medium' | 'high'
  label: string
  hint: string
  sub: string
}[] = [
  { id: 'low', label: 'Low', hint: 'Fastest', sub: 'Quick answers, minimal reasoning' },
  { id: 'medium', label: 'Medium', hint: 'Balanced', sub: 'Default thinking budget' },
  { id: 'high', label: 'High', hint: 'Thorough', sub: 'Extended reasoning, deepest analysis' },
]

const FALLBACK_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Disabled (no fallback)' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
]

const KEYBOARD_SHORTCUTS = [
  { keys: ['/', 'Ctrl+K'], desc: 'Focus the omnibox' },
  { keys: ['Alt', '1'], desc: 'Switch to Sonnet' },
  { keys: ['Alt', '2'], desc: 'Switch to Opus' },
  { keys: ['Alt', '3'], desc: 'Switch to Haiku' },
  { keys: ['Alt', 'Shift', '1'], desc: 'Plan permission mode' },
  { keys: ['Alt', 'Shift', '2'], desc: 'Accept Edits mode' },
  { keys: ['Alt', 'Shift', '3'], desc: 'Bypass Permissions mode' },
]

const NAV_SECTIONS = [
  { id: 'model', label: 'Model', icon: Cpu },
  { id: 'permission', label: 'Permission Mode', icon: Shield },
  { id: 'effort', label: 'Reasoning Effort', icon: Brain },
  { id: 'limits', label: 'Limits', icon: Gauge },
  { id: 'instructions', label: 'Custom Instructions', icon: Sparkles },
  { id: 'tools', label: 'Tools & Permissions', icon: Wrench },
  { id: 'session', label: 'Session Behavior', icon: Terminal },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Zap },
]

// ── Reusable sub-components ───────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description?: string
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[rgba(255,135,175,0.18)] bg-[rgba(255,135,175,0.07)]">
          <Icon className="size-3.5 text-[var(--axon-accent-pink)]" />
        </div>
        <h2 className="text-sm font-semibold text-[var(--axon-text-primary)]">{label}</h2>
      </div>
      {description && (
        <p className="mt-1.5 pl-[2.375rem] text-[12px] leading-relaxed text-[var(--axon-text-dim)]">
          {description}
        </p>
      )}
    </div>
  )
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--axon-text-dim)]">{children}</p>
  )
}

function SectionDivider() {
  return <div className="my-8 h-px bg-[rgba(255,135,175,0.07)]" />
}

function ToggleRow({
  id,
  label,
  description,
  cliFlag,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  cliFlag: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-[rgba(255,135,175,0.1)] bg-[rgba(10,18,35,0.38)] px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--axon-text-secondary)]">{label}</p>
        <p className="mt-0.5 text-[11px] text-[var(--axon-text-dim)]">
          {description}{' '}
          <code className="rounded bg-[rgba(175,215,255,0.07)] px-1 py-0.5 font-mono text-[10px] text-[var(--axon-text-muted)]">
            {cliFlag}
          </code>
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(175,215,255,0.5)]"
        style={{ background: checked ? 'var(--axon-accent-pink)' : 'rgba(255,135,175,0.15)' }}
        aria-label={label}
      >
        <span
          className="inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
    </div>
  )
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  mono,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg border border-[rgba(255,135,175,0.15)] bg-[rgba(10,18,35,0.5)] px-3 py-2.5 text-[13px] text-[var(--axon-text-secondary)] outline-none placeholder:text-[var(--axon-text-subtle)] focus:border-[rgba(175,215,255,0.35)] focus:bg-[rgba(10,18,35,0.7)] ${mono ? 'font-mono' : ''}`}
    />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const { pulseModel, pulsePermissionLevel, setPulseModel, setPulsePermissionLevel } =
    useWsMessages()
  const { settings, updateSettings } = usePulseSettings()
  const [activeSection, setActiveSection] = useState('model')

  function handleReset() {
    updateSettings(DEFAULT_PULSE_SETTINGS)
    setPulseModel('sonnet')
    setPulsePermissionLevel('accept-edits')
  }

  function scrollTo(id: string) {
    setActiveSection(id)
    const el = document.getElementById(`settings-section-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{
        background:
          'radial-gradient(ellipse at 14% 10%, rgba(175,215,255,0.08), transparent 34%), radial-gradient(ellipse at 82% 16%, rgba(255,135,175,0.07), transparent 38%), linear-gradient(180deg,#02040b 0%,#030712 60%,#040a14 100%)',
      }}
    >
      {/* Top bar */}
      <header
        className="sticky top-0 z-30 flex h-13 shrink-0 items-center gap-3 border-b px-4"
        style={{
          borderColor: 'rgba(255,135,175,0.1)',
          background: 'rgba(3,7,18,0.9)',
          backdropFilter: 'blur(16px)',
          height: '3.25rem',
        }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--axon-text-dim)] transition-colors hover:bg-[rgba(255,135,175,0.08)] hover:text-[var(--axon-text-secondary)]"
          aria-label="Go back"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
        <div className="h-4 w-px bg-[rgba(255,135,175,0.12)]" />
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-3.5 text-[var(--axon-accent-pink)]" />
          <h1 className="text-[14px] font-semibold text-[var(--axon-text-primary)]">Settings</h1>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-[var(--axon-text-dim)] transition-colors hover:bg-[rgba(255,135,175,0.08)] hover:text-[var(--axon-accent-pink-strong)]"
          title="Reset all settings to defaults"
        >
          <RotateCcw className="size-3" />
          Reset to defaults
        </button>
      </header>

      {/* Body */}
      <div className="flex flex-1">
        {/* Sidebar nav — hidden below lg breakpoint */}
        <nav
          className="sticky hidden h-[calc(100vh-3.25rem)] w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-3 lg:flex"
          style={{
            top: '3.25rem',
            borderColor: 'rgba(255,135,175,0.08)',
            background: 'rgba(3,7,18,0.55)',
          }}
        >
          <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--axon-text-dim)]">
            Configuration
          </p>
          {NAV_SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollTo(id)}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-all duration-150 ${
                activeSection === id
                  ? 'bg-[rgba(255,135,175,0.1)] text-[var(--axon-accent-pink-strong)]'
                  : 'text-[var(--axon-text-muted)] hover:bg-[rgba(255,135,175,0.06)] hover:text-[var(--axon-text-secondary)]'
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </button>
          ))}

          <div className="mt-auto pt-4">
            <button
              type="button"
              onClick={handleReset}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium text-[var(--axon-text-dim)] transition-colors hover:bg-[rgba(255,135,175,0.08)] hover:text-[var(--axon-accent-pink-strong)]"
            >
              <RotateCcw className="size-3 shrink-0" />
              Reset all to defaults
            </button>
          </div>
        </nav>

        {/* Main content column */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6">
            {/* ── Model ─────────────────────────────────────────────── */}
            <section id="settings-section-model" className="scroll-mt-20">
              <SectionHeader
                icon={Cpu}
                label="Model"
                description="The Claude model used for all Pulse chat sessions. Passed as --model to the Claude CLI."
              />
              <div className="space-y-2">
                {MODEL_OPTIONS.map((opt) => {
                  const active = pulseModel === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPulseModel(opt.id)}
                      className={`w-full rounded-xl border px-4 py-3.5 text-left transition-all duration-150 ${
                        active
                          ? 'border-[rgba(175,215,255,0.35)] bg-[rgba(175,215,255,0.07)] shadow-[0_0_16px_rgba(175,215,255,0.05)]'
                          : 'border-[rgba(255,135,175,0.1)] bg-[rgba(10,18,35,0.35)] hover:border-[rgba(255,135,175,0.2)] hover:bg-[rgba(10,18,35,0.55)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[13px] font-medium ${
                              active
                                ? 'text-[var(--axon-accent-blue)]'
                                : 'text-[var(--axon-text-secondary)]'
                            }`}
                          >
                            {opt.label}
                          </span>
                          {opt.badge && (
                            <span className="rounded-full border border-[rgba(175,215,255,0.2)] bg-[rgba(175,215,255,0.07)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[rgba(175,215,255,0.5)]">
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        {active && (
                          <span className="size-1.5 rounded-full bg-[var(--axon-accent-blue)] shadow-[0_0_8px_rgba(175,215,255,0.6)]" />
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--axon-text-dim)]">{opt.sub}</p>
                    </button>
                  )
                })}
              </div>
            </section>

            <SectionDivider />

            {/* ── Permission Mode ───────────────────────────────────── */}
            <section id="settings-section-permission" className="scroll-mt-20">
              <SectionHeader
                icon={Shield}
                label="Permission Mode"
                description="Controls how Claude interacts with your filesystem and shell. Passed as --permission-mode to the Claude CLI."
              />
              <div className="space-y-2">
                {PERMISSION_OPTIONS.map((opt) => {
                  const active = pulsePermissionLevel === opt.id
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPulsePermissionLevel(opt.id)}
                      className={`w-full rounded-xl border px-4 py-3.5 text-left transition-all duration-150 ${
                        active
                          ? 'border-[rgba(255,135,175,0.3)] bg-[rgba(255,135,175,0.07)] shadow-[0_0_16px_rgba(255,135,175,0.05)]'
                          : 'border-[rgba(255,135,175,0.1)] bg-[rgba(10,18,35,0.35)] hover:border-[rgba(255,135,175,0.2)] hover:bg-[rgba(10,18,35,0.55)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span
                            style={{ color: active ? opt.accentColor : 'var(--axon-text-dim)' }}
                          >
                            <Icon className="size-3.5 shrink-0" />
                          </span>
                          <span
                            className={`text-[13px] font-medium ${
                              active
                                ? 'text-[var(--axon-accent-pink-strong)]'
                                : 'text-[var(--axon-text-secondary)]'
                            }`}
                          >
                            {opt.label}
                          </span>
                        </div>
                        {active && (
                          <span
                            className="size-1.5 rounded-full"
                            style={{
                              background: opt.accentColor,
                              boxShadow: `0 0 8px ${opt.accentColor}`,
                            }}
                          />
                        )}
                      </div>
                      <p className="mt-0.5 pl-6 text-[11px] text-[var(--axon-text-dim)]">
                        {opt.sub}
                      </p>
                    </button>
                  )
                })}
              </div>
            </section>

            <SectionDivider />

            {/* ── Reasoning Effort ──────────────────────────────────── */}
            <section id="settings-section-effort" className="scroll-mt-20">
              <SectionHeader
                icon={Brain}
                label="Reasoning Effort"
                description="Controls how much thinking budget Claude uses per response. Passed as --effort to the Claude CLI."
              />
              <div className="grid grid-cols-3 gap-2">
                {EFFORT_OPTIONS.map((opt) => {
                  const active = settings.effort === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateSettings({ effort: opt.id })}
                      className={`flex flex-col rounded-xl border px-3 py-3.5 text-left transition-all duration-150 ${
                        active
                          ? 'border-[rgba(175,215,255,0.35)] bg-[rgba(175,215,255,0.07)] shadow-[0_0_14px_rgba(175,215,255,0.05)]'
                          : 'border-[rgba(255,135,175,0.1)] bg-[rgba(10,18,35,0.35)] hover:border-[rgba(255,135,175,0.2)] hover:bg-[rgba(10,18,35,0.55)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[13px] font-medium ${
                            active
                              ? 'text-[var(--axon-accent-blue)]'
                              : 'text-[var(--axon-text-secondary)]'
                          }`}
                        >
                          {opt.label}
                        </span>
                        <span
                          className={`text-[10px] ${active ? 'text-[var(--axon-accent-blue)]' : 'text-[var(--axon-text-dim)]'}`}
                        >
                          {opt.hint}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-[var(--axon-text-dim)]">
                        {opt.sub}
                      </p>
                    </button>
                  )
                })}
              </div>
            </section>

            <SectionDivider />

            {/* ── Limits ───────────────────────────────────────────── */}
            <section id="settings-section-limits" className="scroll-mt-20">
              <SectionHeader
                icon={Gauge}
                label="Limits"
                description="Hard caps on agentic run length and API spend. 0 means unlimited (CLI default)."
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="settings-max-turns"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--axon-text-dim)]"
                  >
                    Max turns
                    <code className="ml-1.5 normal-case tracking-normal text-[var(--axon-text-subtle)]">
                      --max-turns
                    </code>
                  </label>
                  <input
                    id="settings-max-turns"
                    type="number"
                    min={0}
                    max={200}
                    value={settings.maxTurns}
                    onChange={(e) =>
                      updateSettings({
                        maxTurns: Math.max(0, Math.min(200, Number(e.target.value))),
                      })
                    }
                    className="w-full rounded-lg border border-[rgba(255,135,175,0.15)] bg-[rgba(10,18,35,0.5)] px-3 py-2.5 text-[13px] text-[var(--axon-text-secondary)] outline-none placeholder:text-[var(--axon-text-subtle)] focus:border-[rgba(175,215,255,0.35)] focus:bg-[rgba(10,18,35,0.7)]"
                    placeholder="0 (unlimited)"
                  />
                  <FieldHint>
                    Maximum agentic loop iterations. Exits with an error when reached.
                  </FieldHint>
                </div>
                <div>
                  <label
                    htmlFor="settings-max-budget"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--axon-text-dim)]"
                  >
                    Max budget USD
                    <code className="ml-1.5 normal-case tracking-normal text-[var(--axon-text-subtle)]">
                      --max-budget-usd
                    </code>
                  </label>
                  <input
                    id="settings-max-budget"
                    type="number"
                    min={0}
                    max={1000}
                    step={0.5}
                    value={settings.maxBudgetUsd}
                    onChange={(e) =>
                      updateSettings({
                        maxBudgetUsd: Math.max(0, Math.min(1000, Number(e.target.value))),
                      })
                    }
                    className="w-full rounded-lg border border-[rgba(255,135,175,0.15)] bg-[rgba(10,18,35,0.5)] px-3 py-2.5 text-[13px] text-[var(--axon-text-secondary)] outline-none placeholder:text-[var(--axon-text-subtle)] focus:border-[rgba(175,215,255,0.35)] focus:bg-[rgba(10,18,35,0.7)]"
                    placeholder="0 (unlimited)"
                  />
                  <FieldHint>Stop before this dollar threshold is exceeded.</FieldHint>
                </div>
              </div>
            </section>

            <SectionDivider />

            {/* ── Custom Instructions ──────────────────────────────── */}
            <section id="settings-section-instructions" className="scroll-mt-20">
              <SectionHeader
                icon={Sparkles}
                label="Custom Instructions"
                description="Appended to the system prompt on every Pulse request via --append-system-prompt. Adds rules without replacing Claude's built-in behavior."
              />
              <textarea
                id="settings-append-system-prompt"
                value={settings.appendSystemPrompt}
                onChange={(e) => updateSettings({ appendSystemPrompt: e.target.value })}
                placeholder="e.g. Always respond in bullet points. Prefer TypeScript. Be concise."
                rows={5}
                maxLength={4000}
                className="w-full resize-none rounded-lg border border-[rgba(255,135,175,0.15)] bg-[rgba(10,18,35,0.5)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--axon-text-secondary)] outline-none placeholder:text-[var(--axon-text-subtle)] focus:border-[rgba(255,135,175,0.3)] focus:bg-[rgba(10,18,35,0.7)]"
              />
              <div className="mt-1.5 flex justify-between text-[10px] text-[var(--axon-text-subtle)]">
                <span>Applied to every Pulse chat request</span>
                <span>{settings.appendSystemPrompt.length} / 4000</span>
              </div>
            </section>

            <SectionDivider />

            {/* ── Tools & Permissions ──────────────────────────────── */}
            <section id="settings-section-tools" className="scroll-mt-20">
              <SectionHeader
                icon={Wrench}
                label="Tools & Permissions"
                description="Fine-grained control over which tools Claude can use. Supports permission rule syntax (e.g. Bash(git log *), Read, Edit)."
              />
              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="settings-allowed-tools"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--axon-text-dim)]"
                  >
                    Allowed tools
                    <code className="ml-1.5 normal-case tracking-normal text-[var(--axon-text-subtle)]">
                      --allowedTools
                    </code>
                  </label>
                  <TextInput
                    id="settings-allowed-tools"
                    value={settings.allowedTools}
                    onChange={(v) => updateSettings({ allowedTools: v })}
                    placeholder="e.g. Bash(git log *),Read,Edit"
                    mono
                  />
                  <FieldHint>
                    Comma-separated tools that execute without prompting for permission. Leave blank
                    for defaults.
                  </FieldHint>
                </div>
                <div>
                  <label
                    htmlFor="settings-disallowed-tools"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--axon-text-dim)]"
                  >
                    Disallowed tools
                    <code className="ml-1.5 normal-case tracking-normal text-[var(--axon-text-subtle)]">
                      --disallowedTools
                    </code>
                  </label>
                  <TextInput
                    id="settings-disallowed-tools"
                    value={settings.disallowedTools}
                    onChange={(v) => updateSettings({ disallowedTools: v })}
                    placeholder="e.g. Bash,Edit"
                    mono
                  />
                  <FieldHint>
                    Comma-separated tools removed from Claude's context entirely. Takes priority
                    over allowed tools.
                  </FieldHint>
                </div>

                <div className="flex items-start gap-2.5 rounded-lg border border-[rgba(175,215,255,0.1)] bg-[rgba(10,18,35,0.38)] px-3.5 py-3">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-[var(--axon-accent-pink)]" />
                  <p className="text-[11px] leading-relaxed text-[var(--axon-text-dim)]">
                    Pulse always runs with{' '}
                    <code className="rounded bg-[rgba(175,215,255,0.07)] px-1 py-0.5 font-mono text-[10px] text-[var(--axon-text-muted)]">
                      --dangerously-skip-permissions
                    </code>{' '}
                    because there is no TTY in the container environment. These tool filters layer
                    on top and do not restore the interactive permission prompt.
                  </p>
                </div>
              </div>
            </section>

            <SectionDivider />

            {/* ── Session Behavior ─────────────────────────────────── */}
            <section id="settings-section-session" className="scroll-mt-20">
              <SectionHeader
                icon={Terminal}
                label="Session Behavior"
                description="Control how the Claude CLI manages sessions and handles built-in commands during each chat."
              />
              <div className="space-y-3">
                <ToggleRow
                  id="settings-disable-slash-commands"
                  label="Disable slash commands"
                  description="Disables all skills and slash commands for each session."
                  cliFlag="--disable-slash-commands"
                  checked={settings.disableSlashCommands}
                  onChange={(v) => updateSettings({ disableSlashCommands: v })}
                />
                <ToggleRow
                  id="settings-no-session-persistence"
                  label="Disable session persistence"
                  description="Sessions are not saved to disk and cannot be resumed."
                  cliFlag="--no-session-persistence"
                  checked={settings.noSessionPersistence}
                  onChange={(v) => updateSettings({ noSessionPersistence: v })}
                />
                <div>
                  <label
                    htmlFor="settings-fallback-model"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--axon-text-dim)]"
                  >
                    Fallback model
                    <code className="ml-1.5 normal-case tracking-normal text-[var(--axon-text-subtle)]">
                      --fallback-model
                    </code>
                  </label>
                  <select
                    id="settings-fallback-model"
                    value={settings.fallbackModel}
                    onChange={(e) => updateSettings({ fallbackModel: e.target.value })}
                    className="w-full rounded-lg border border-[rgba(255,135,175,0.15)] bg-[rgba(10,18,35,0.5)] px-3 py-2.5 text-[13px] text-[var(--axon-text-secondary)] outline-none focus:border-[rgba(175,215,255,0.35)] focus:bg-[rgba(10,18,35,0.7)]"
                  >
                    {FALLBACK_MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <FieldHint>
                    Automatically falls back to this model when the primary model is overloaded.
                  </FieldHint>
                </div>
              </div>
            </section>

            <SectionDivider />

            {/* ── Keyboard Shortcuts ───────────────────────────────── */}
            <section id="settings-section-shortcuts" className="scroll-mt-20">
              <SectionHeader
                icon={Zap}
                label="Keyboard Shortcuts"
                description="Global shortcuts available throughout the Pulse workspace and omnibox."
              />
              <div className="overflow-hidden rounded-xl border border-[rgba(255,135,175,0.1)] bg-[rgba(10,18,35,0.35)]">
                {KEYBOARD_SHORTCUTS.map(({ keys, desc }, idx) => (
                  <div
                    key={desc}
                    className={`flex items-center justify-between px-4 py-3 ${
                      idx < KEYBOARD_SHORTCUTS.length - 1
                        ? 'border-b border-[rgba(255,135,175,0.07)]'
                        : ''
                    }`}
                  >
                    <span className="text-[12px] text-[var(--axon-text-dim)]">{desc}</span>
                    <div className="flex items-center gap-1">
                      {keys.map((k, ki) => (
                        <span key={k} className="flex items-center gap-1">
                          {ki > 0 && (
                            <span className="text-[10px] text-[var(--axon-text-dim)]">+</span>
                          )}
                          <kbd className="rounded border border-[rgba(255,135,175,0.16)] bg-[rgba(10,18,35,0.6)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--axon-text-subtle)]">
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
          </div>
        </main>
      </div>
    </div>
  )
}
