# RAG Pipeline Blockers Fix Session

**Date**: 2026-02-02
**Branch**: `feat/phase-3-legacy-cleanup`
**Duration**: ~30 minutes

## Session Overview

Reviewed the RAG (Retrieval-Augmented Generation) embedding pipeline for blockers that could cause jobs to get stuck or fail silently. Identified 4 issues and fixed all of them using parallel agents.

## Timeline

1. **Initial Analysis** - Reviewed pipeline configuration and CI workflow
2. **Pipeline Deep Dive** - Read embed-queue.ts, background-embedder.ts, embedpipeline.ts, embeddings.ts, qdrant.ts
3. **Blocker Identification** - Found 4 issues ranging from critical to low severity
4. **Parallel Fix Dispatch** - Launched 4 agents to fix issues concurrently
5. **Verification** - Ran tests (610 passing), identified bug in DI container
6. **DI Container Fix** - Fixed EmbedPipeline.batchEmbed to track failures properly
7. **Final Verification** - All 610 tests passing, TypeScript compiles clean

## Key Findings

### Critical: Stuck Processing Jobs
- **Location**: `src/utils/embed-queue.ts:151-159`, `src/utils/background-embedder.ts:61`
- **Issue**: `getPendingJobs()` only returns jobs with `status === 'pending'`, but `markJobProcessing()` sets status to `'processing'` before work starts. If daemon crashes mid-processing, jobs are orphaned forever.
- **Impact**: Queue appears empty but work is stuck

### High: Silent Config Failures
- **Location**: `src/utils/background-embedder.ts:69-73`
- **Issue**: Missing TEI_URL/QDRANT_URL throws error but jobs just fail 3 times with no clear message about what's wrong
- **Impact**: Users don't know why embedding isn't working

### High: Swallowed Batch Errors
- **Location**: `src/utils/embedpipeline.ts:158-160`
- **Issue**: `batchEmbed()` catches and ignores individual embedding errors
- **Impact**: 50% failures look like success to caller

### Low: Webhook Fallback Unclear
- **Location**: `src/utils/background-embedder.ts:304-308`
- **Issue**: When webhook not configured, only logs to stderr
- **Impact**: Users don't realize jobs use slow polling (10 min default)

### Additional Bug Found
- **Location**: `src/container/services/EmbedPipeline.ts:174`
- **Issue**: `batchEmbed()` called `this.autoEmbed()` which catches all errors, so `result.failed` never incremented
- **Fix**: Split into `autoEmbedInternal()` (throws) and `autoEmbed()` (catches), batchEmbed calls internal version

## Technical Decisions

1. **Stuck Job Recovery**: Added `getStuckProcessingJobs(maxProcessingMs)` that finds jobs in `processing` state longer than threshold (default 5 min), then resets them to `pending`

2. **Config Error Handling**: Added `markJobConfigError()` that immediately fails job (sets retries=maxRetries) and logs clear instructions for setting TEI_URL/QDRANT_URL

3. **BatchEmbedResult**: Changed `batchEmbed()` return type from `Promise<void>` to `Promise<BatchEmbedResult>` with `{ succeeded, failed, errors[] }`

4. **Status Endpoint**: Added `/status` HTTP endpoint that returns queue stats JSON for monitoring

5. **Prominent Warnings**: Multi-line warning when webhook not configured explaining polling behavior

## Files Modified

| File | Purpose |
|------|---------|
| `src/utils/embed-queue.ts` | Added `getStuckProcessingJobs()`, `markJobConfigError()`, `getQueueStats()` |
| `src/utils/background-embedder.ts` | Stuck job recovery, config error messages, partial failure logging, `/status` endpoint |
| `src/utils/embedpipeline.ts` | Split `autoEmbed`/`autoEmbedInternal`, `BatchEmbedResult` type, failure tracking |
| `src/container/services/EmbedPipeline.ts` | Same refactor for DI container version |
| `src/container/types.ts` | Updated `IEmbedPipeline.batchEmbed` return type |
| `src/__tests__/utils/embed-queue.test.ts` | Tests for new queue functions |
| `src/__tests__/utils/background-embedder.test.ts` | Tests for stuck job recovery |
| `src/__tests__/utils/embedpipeline.test.ts` | Tests for BatchEmbedResult |
| `src/__tests__/utils/webhook-status.test.ts` | New test file for /status endpoint |

## Commands Executed

```bash
# Verify lint (38 warnings, exit 0 - non-blocking)
pnpm lint

# Run full test suite
pnpm test  # 610 tests, 39 files, all passing

# Type check
pnpm type-check  # Clean compilation
```

## Test Results

- **Before**: 592 tests passing
- **After**: 610 tests passing (+18 new tests)
- **TypeScript**: Compiles without errors
- **Lint**: 38 warnings (style, non-blocking)

## Architecture Changes

### Queue State Machine (Updated)
```
pending ──▶ processing ──▶ completed
    │            │
    │            ▼
    │         (crash)
    │            │
    ◀────────────┘  (recovered by getStuckProcessingJobs)
    │
    ▼
  failed (after maxRetries or config error)
```

### New HTTP Endpoints
- `GET /health` - Returns `{"status":"ok","service":"embedder-daemon"}`
- `GET /status` - Returns queue stats and config status

## Next Steps

1. Consider adding Prometheus metrics export from `/status` endpoint
2. Add alerting when jobs stay in `failed` state
3. Consider dead letter queue for permanently failed jobs
4. Add job priority levels for time-sensitive embeds

## Related Files (for context)

- `src/embedder-daemon.ts` - Entry point for daemon process
- `src/utils/embedder-webhook.ts` - Webhook configuration
- `src/utils/chunker.ts` - Markdown-aware text chunking
- `src/utils/embeddings.ts` - TEI client with batching
- `src/utils/qdrant.ts` - Qdrant vector DB client
