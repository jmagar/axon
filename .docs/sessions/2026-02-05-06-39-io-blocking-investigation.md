**Date:** 06:39:14 | 02/05/2026  
**Project:** cli-firecrawl  
**Topic:** IO blocking investigation (sync filesystem operations)

## Scope
Investigated sync filesystem usage and call paths to determine hot-path impact.

## Findings
### Hot-path candidates
- `src/utils/embed-queue.ts`: extensive sync FS (`readFileSync`, `writeFileSync`, `readdirSync`, `mkdirSync`, `chmodSync`, `unlinkSync`). Used by `src/utils/background-embedder.ts` in polling loops (`getPendingJobs`, `getStalePendingJobs`, `updateEmbedJob`). This is a likely hot path.
- `src/utils/job-history.ts`: sync FS for job history reads/writes. Called by several commands (crawl/batch/extract/status) but not in background loop.
- `src/utils/output.ts`: sync FS for output writing and path validation (`existsSync`, `mkdirSync`, `writeFileSync`, `realpathSync`). Called by most commands; frequency depends on user command usage.

### Lower-frequency paths
- `src/utils/settings.ts`: sync FS for settings load/save; called by `commands/config` and `commands/crawl/options`.
- `src/utils/credentials.ts`: sync FS for credentials load/save; called by container factories and auth/config commands.
- `src/commands/embed.ts`: sync file read for input file.

## Call Path Notes
- Background embedder polling interval is 10s; each poll triggers full queue scan (`readdirSync` + `readFileSync` per job file).
- Output writes are per-command but could involve large payloads (e.g., crawl output), meaning blocking write duration scales with content size.

## Preliminary Conclusion
- The embed queue is the most likely IO blocking hotspot due to periodic scans in a long-running daemon.
- Other sync FS usage is per-command and likely acceptable unless heavy output sizes or high command frequency.

## Next Step
Need user decision on scope: only hot-path fixes (embed-queue + job-history) or full async refactor (settings/credentials/output/commands).