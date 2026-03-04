#!/usr/bin/env python3
"""Console styling and help rendering for qdrant quality CLI."""

from __future__ import annotations

import os

COLORS_ENABLED = os.getenv("AXON_NO_COLOR") is None and os.getenv("CORTEX_NO_COLOR") is None


def _style(text: str, *, fg_256: int | None = None, bold: bool = False, dim: bool = False) -> str:
    if not COLORS_ENABLED:
        return text
    codes: list[str] = []
    if bold:
        codes.append("1")
    if dim:
        codes.append("2")
    if fg_256 is not None:
        codes.append(f"38;5;{fg_256}")
    if not codes:
        return text
    return f"\x1b[{';'.join(codes)}m{text}\x1b[0m"


def primary(text: str) -> str:
    return _style(text, fg_256=211, bold=True)


def accent(text: str) -> str:
    return _style(text, fg_256=153)


def muted(text: str) -> str:
    return _style(text, dim=True)


def status_text(status: str) -> str:
    s = (status or "").lower()
    if s in {"completed", "green", "ok"}:
        return _style(status, fg_256=2)
    if s in {"failed", "error", "red"}:
        return _style(status, fg_256=1)
    if s in {"pending", "running", "processing", "scraping", "yellow"}:
        return _style(status, fg_256=3)
    return _style(status, fg_256=6)


def render_help_text() -> str:
    return "\n".join(
        [
            primary("Qdrant Quality"),
            primary("Usage"),
            f"  {accent('python3 scripts/qdrant-quality.py')} {muted('<command> [options]')}",
            "",
            primary("Commands"),
            f"  {accent('help')}                   {muted('Show this help')}",
            f"  {accent('health')}                 {muted('Show cluster and collection health stats')}",
            f"  {accent('aliases')}                {muted('Audit aliases and flag dangling targets')}",
            f"  {accent('payload-schema')}         {muted('Audit payload field presence and types')}",
            f"  {accent('domain-breakdown')}       {muted('Show top domains by points and duplicate rates')}",
            f"  {accent('stale-data')}             {muted('Check age of points using timestamps')}",
            f"  {accent('strict-exclude-sync')}    {muted('Compare script/Rust default exclude prefixes')}",
            f"  {accent('check')}                  {muted('Audit one collection (quality, duplicates, exclusions)')}",
            f"  {accent('check-all')}              {muted('Audit all collections')}",
            f"  {accent('delete-duplicates')}      {muted('Delete duplicate points in one collection')}",
            f"  {accent('delete-excluded')}        {muted('Delete points matching exclude path prefixes in one collection')}",
            f"  {accent('delete-duplicates-all')}  {muted('Delete duplicate points in all collections')}",
            f"  {accent('delete-excluded-all')}    {muted('Delete exclude-path matches in all collections')}",
            "",
            primary("Global Options"),
            f"  {accent('--url <url>')}                    {muted('Qdrant base URL (default: env/.env QDRANT_URL)')}",
            f"  {accent('--exclude-path-prefix <value>')}  {muted("Repeat or comma-separate; use 'none' to disable defaults")}",
            f"  {accent('--dry-run')}                      {muted('Preview delete actions without deleting')}",
            f"  {accent('--json')}                         {muted('Emit machine-readable JSON output')}",
            f"  {accent('--sample <n>')}                   {muted('Limit scan to first N points for quick checks')}",
            f"  {accent('--yes')}                          {muted('Skip confirmation prompt for destructive commands')}",
            f"  {accent('--help')}                         {muted('Show this help')}",
            "",
            primary("Examples"),
            f"  {accent('python3 scripts/qdrant-quality.py health')}",
            f"  {accent('python3 scripts/qdrant-quality.py check --collection cortex')}",
            f"  {accent('python3 scripts/qdrant-quality.py check-all')}",
            f"  {accent('python3 scripts/qdrant-quality.py delete-duplicates --collection cortex')}",
            f"  {accent('python3 scripts/qdrant-quality.py delete-excluded --collection cortex')}",
            f"  {accent('python3 scripts/qdrant-quality.py check --exclude-path-prefix /fr,/de')}",
            f"  {accent('python3 scripts/qdrant-quality.py check --exclude-path-prefix none')}",
            f"  {accent('python3 scripts/qdrant-quality.py aliases --json')}",
            f"  {accent('python3 scripts/qdrant-quality.py delete-duplicates --collection cortex --dry-run')}",
            f"  {accent('python3 scripts/qdrant-quality.py domain-breakdown --collection firecrawl --top 20 --sample 50000')}",
            f"  {accent('python3 scripts/qdrant-quality.py stale-data --collection cortex --days 30 --json')}",
        ]
    )
