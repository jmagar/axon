#!/usr/bin/env python3
"""PostToolUse hook: warn when a CLI command file has no matching docs/commands/*.md.

Reads the edited file path from stdin JSON (Claude Code hook protocol).
Fires only when editing/writing files in crates/cli/commands/.
Skips infrastructure files (mod.rs, common.rs, probe.rs, ingest_common.rs).
Exits 0 always (warning only). Prints nothing if doc exists.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
COMMANDS_DIR = REPO_ROOT / "crates" / "cli" / "commands"
DOCS_DIR = REPO_ROOT / "docs" / "commands"

# Infrastructure files that don't need their own command doc
SKIP_STEMS = {"mod", "common", "probe", "ingest_common", "crawl"}


def main() -> int:
    try:
        data = json.load(sys.stdin)
        file_path: str = data.get("tool_input", {}).get("file_path", "")
    except (json.JSONDecodeError, KeyError):
        return 0

    if not file_path.endswith(".rs"):
        return 0

    path = Path(file_path).resolve()

    # Only fire for files directly in crates/cli/commands/ (not subdirs)
    try:
        rel = path.relative_to(COMMANDS_DIR)
    except ValueError:
        return 0

    if len(rel.parts) != 1:
        return 0  # subdirectory (e.g. crawl/)

    stem = path.stem
    if stem in SKIP_STEMS:
        return 0

    doc_path = DOCS_DIR / f"{stem}.md"
    if not doc_path.exists():
        print(f"[docs] crates/cli/commands/{stem}.rs has no docs/commands/{stem}.md — add one before merging")

    return 0  # warning only, never block


if __name__ == "__main__":
    raise SystemExit(main())
