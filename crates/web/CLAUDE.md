# crates/web — WebSocket Bridge (Legacy UI Host)

## Current Role

`crates/web` is no longer the primary frontend application.

- `crates/web/static` was the initial Axon UI implementation.
- The active frontend is now the Next.js app in `apps/web`.
- `crates/web` now serves as the Axon WebSocket server and CLI execution bridge used by the current app architecture.

## Source of Truth

For branding, theme, layout, and frontend UX decisions, use:

- `apps/web` as the source of truth.

Treat `crates/web/static` as legacy UI assets unless explicitly requested for maintenance or migration support.

## Directory Intent

- `crates/web.rs`: Axum server wiring and routes
- `crates/web/execute.rs`: subprocess execution + output streaming
- `crates/web/docker_stats.rs`: container stats streaming
- `crates/web/static/*`: legacy static frontend implementation

## Agent Guidance

When asked to review or polish the frontend visual system, audit and update `apps/web` first.
Only modify `crates/web/static` when the task explicitly targets legacy UI behavior or fallback compatibility.
