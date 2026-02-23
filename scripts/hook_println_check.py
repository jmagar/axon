#!/usr/bin/env python3
"""PostToolUse hook: warn if println!/eprintln! appear in internal library code.

Reads the edited file path from stdin JSON (Claude Code hook protocol).
Legitimate output layers (ui.rs, help.rs, logging.rs, commands/) are skipped.
Only flags accidental println! in internal logic: jobs/, crawl/, ingest/, core/http,
core/content, vector/ops internals — places where log_info/log_warn should be used.

Exits 0 always (warning only). Prints nothing if clean.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# These are legitimate output/UI layers — println! is expected here
SKIP_PATHS = {
    "crates/core/ui.rs",
    "crates/core/logging.rs",
    "crates/core/config/help.rs",
    "crates/cli/commands/",
    "crates/vector/ops/commands/",
    "crates/vector/ops_v2/commands/",
    "crates/vector/ops/qdrant/commands",
    "crates/vector/ops_v2/qdrant/commands",
    "main.rs",
    "mod.rs",
}

# Internal crates where println! is a regression
INTERNAL_PATHS = {
    "crates/jobs/",
    "crates/crawl/",
    "crates/ingest/",
    "crates/core/http",
    "crates/core/content",
    "crates/core/health",
    "crates/vector/ops/tei",
    "crates/vector/ops_v2/tei",
    "crates/vector/ops/qdrant/client",
    "crates/vector/ops_v2/qdrant/client",
}


def is_skip_path(file_path: str) -> bool:
    return any(p in file_path for p in SKIP_PATHS)


def is_internal_path(file_path: str) -> bool:
    return any(p in file_path for p in INTERNAL_PATHS)


def find_bare_printlns(text: str) -> list[tuple[int, str]]:
    """Find println!/eprintln! lines outside #[cfg(test)] blocks."""
    lines = text.splitlines()
    in_test_block = False
    depth = 0
    test_start_depth = 0
    hits: list[tuple[int, str]] = []

    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()
        if re.search(r"#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]", stripped):
            in_test_block = True
            test_start_depth = depth
        depth += stripped.count("{") - stripped.count("}")
        if in_test_block and depth < test_start_depth:
            in_test_block = False
        if not in_test_block:
            if re.search(r"\b(println|eprintln)!", line):
                hits.append((lineno, line.rstrip()))

    return hits


def main() -> int:
    try:
        data = json.load(sys.stdin)
        file_path: str = data.get("tool_input", {}).get("file_path", "")
    except (json.JSONDecodeError, KeyError):
        return 0

    if not file_path.endswith(".rs"):
        return 0
    if is_skip_path(file_path):
        return 0
    if not is_internal_path(file_path):
        return 0

    path = Path(file_path)
    if not path.exists():
        return 0

    text = path.read_text(encoding="utf-8", errors="ignore")
    hits = find_bare_printlns(text)

    if hits:
        print(f"[println] {file_path}: bare println!/eprintln! in internal code — use log_info()/log_warn() instead:")
        for lineno, line in hits[:5]:
            print(f"  line {lineno}: {line.strip()}")
        if len(hits) > 5:
            print(f"  ... and {len(hits) - 5} more")

    return 0  # warning only, never block


if __name__ == "__main__":
    raise SystemExit(main())
