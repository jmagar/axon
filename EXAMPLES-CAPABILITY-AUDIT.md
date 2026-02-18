# Axon CLI Examples Capability Audit

Date: 2026-02-18
Source: Agent `019c6e1d-a382-7c93-a363-08f78fed0227`

## Goal
Identify high-value functionality from `examples/` to port into `examples/axon_cli`.

## High Priority
1. Recursive sitemap + robots discovery with scoped filtering
- Sources: `examples/spider_to_axon_poc.rs`, `examples/sitemap.rs`, `examples/sitemap_only.rs`
- Why: higher coverage with better noise control.
- Complexity: M
- Fit: `examples/axon_cli/crawl.rs`, `examples/axon_cli/commands/map.rs`, `examples/axon_cli/commands/crawl.rs`.

2. Chrome runtime resilience + anti-bot controls
- Sources: `examples/chrome_remote.rs`, `examples/chrome_remote_tls.rs`, `examples/anti_bots.rs`, `examples/concurrent_profiles.rs`
- Why: reliability on JS-heavy/guarded targets.
- Complexity: L
- Fit: `examples/axon_cli/config.rs`, new `examples/axon_cli/chrome_runtime.rs`, `examples/axon_cli/crawl.rs`.

3. Cache-aware fast path for repeat crawls
- Sources: `examples/cache_remote_skip_browser.rs`, `examples/cache_chrome_hybrid.rs`, `examples/cache.rs`
- Why: major latency and cost reduction for recurring ingestion.
- Complexity: M
- Fit: crawl/scrape config + crawl runtime.

4. Deterministic-first extraction, LLM fallback second
- Sources: `examples/thc_intel.rs`, `examples/crawl_extract.rs`, `examples/axon_cli/remote_extract.rs`
- Why: better extraction quality with lower token spend.
- Complexity: L
- Fit: extraction strategy stages in `remote_extract.rs`.

## Medium Priority
1. Optional WebDriver backend fallback
- Sources: `examples/webdriver.rs`, `examples/webdriver_remote.rs`, `examples/webdriver_screenshot.rs`
- Complexity: M

2. Mid-crawl queue injection hooks
- Sources: `examples/queue.rs`, `examples/callback.rs`
- Complexity: M

3. Extraction observability (tokens/cost/quality)
- Sources: `examples/content_pipeline.rs`, `examples/remote_multimodal_benchmark.rs`, `examples/concurrent_ai_extraction.rs`
- Complexity: S

4. Audit/diff workflows
- Sources: `examples/sitemap_quality_audit.rs`, `examples/change_detection.rs`
- Complexity: M

## Low Priority
- URL glob seed expansion (`examples/url_glob*.rs`)
- Built-in cron scheduling (`examples/cron.rs`)
- Screenshot/event diagnostics (`examples/chrome_screenshot*.rs`)

## Do Not Port Now (Risky/Experimental)
- CAPTCHA/solver-heavy anti-bot flows (`examples/not_a_robot*.rs`)
- Provider-coupled dual-model orchestration (`examples/remote_multimodal_dual*.rs`)
- Arbitrary browser automation from prompts (`examples/chrome_web_automation.rs`, `examples/openai*.rs`)
- Domain-specific THC pipeline as-is (`examples/thc_intel.rs`): port pattern, not domain-specific code.

## Quick Wins (<1 day)
1. Add extraction token/cost metrics.
2. Add path-prefix exclusion for crawl/map/backfill.
3. Add remote Chrome connection/proxy/UA flags.
4. Add cache toggles (`--cache`, `--cache-skip-browser`).

## Strategic Set (>1 day)
1. Chrome bootstrap manager + WebDriver fallback.
2. Deterministic-first extraction engine with pluggable domain parsers.
3. Audit/diff command suite with persisted reports.
4. Rule-driven mid-crawl queue injection framework.

## Recommendation
Implement quick wins immediately, then execute strategic items as a phased roadmap behind feature flags.
