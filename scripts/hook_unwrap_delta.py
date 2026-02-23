#!/usr/bin/env python3
"""PostToolUse hook: warn if unwrap() count increased in an edited Rust file.

Reads the edited file path from stdin JSON (Claude Code hook protocol).
Compares unwrap() count in the current working tree vs the last git commit.
Exits 0 always (warning only — never blocks). Prints nothing if count is stable or decreased.

Skips test modules (#[cfg(test)]) and the file itself if it's in an allowlist.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

# Files where unwrap() is acceptable (e.g. legitimate LazyLock statics, parse-time panics)
ALLOWLIST: set[str] = set()

# Only warn for these crate paths — skip output/ui/help layers which use unwrap for display
WARN_PATHS = {"crates/core/http", "crates/core/content", "crates/jobs", "crates/crawl", "crates/ingest", "crates/vector/ops"}


def count_unwraps(text: str) -> int:
    """Count unwrap() calls outside #[cfg(test)] blocks."""
    # Strip cfg(test) mod blocks (simple heuristic: track brace depth after marker)
    lines = text.splitlines()
    in_test_block = False
    depth = 0
    test_start_depth = 0
    count = 0

    for line in lines:
        stripped = line.strip()
        if re.search(r"#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]", stripped):
            in_test_block = True
            test_start_depth = depth
        depth += stripped.count("{") - stripped.count("}")
        if in_test_block and depth <= test_start_depth and "{" in stripped:
            # entered the block
            pass
        if in_test_block and depth < test_start_depth:
            in_test_block = False
        if not in_test_block:
            count += len(re.findall(r"\.unwrap\(\)", line))

    return count


def git_file_content(path: str) -> str | None:
    """Get file content from HEAD."""
    try:
        result = subprocess.run(
            ["git", "show", f"HEAD:{path}"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout if result.returncode == 0 else None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def in_warn_path(file_path: str) -> bool:
    return any(file_path.startswith(p) or f"/{p}/" in file_path for p in WARN_PATHS)


def main() -> int:
    try:
        data = json.load(sys.stdin)
        file_path: str = data.get("tool_input", {}).get("file_path", "")
    except (json.JSONDecodeError, KeyError):
        return 0

    if not file_path.endswith(".rs"):
        return 0
    if not in_warn_path(file_path):
        return 0
    if any(p in file_path for p in ALLOWLIST):
        return 0

    path = Path(file_path)
    if not path.exists():
        return 0

    current_text = path.read_text(encoding="utf-8", errors="ignore")
    current_count = count_unwraps(current_text)

    # Normalize to repo-relative path for git show
    try:
        repo_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5
        ).stdout.strip()
        rel_path = str(path.resolve().relative_to(repo_root))
    except (ValueError, subprocess.TimeoutExpired, FileNotFoundError):
        return 0

    old_text = git_file_content(rel_path)
    if old_text is None:
        # New file — just report the count if non-zero
        if current_count > 0:
            print(f"[unwrap] {rel_path}: {current_count} unwrap() call(s) in new file — consider using ? or expect()")
        return 0

    old_count = count_unwraps(old_text)
    delta = current_count - old_count

    if delta > 0:
        print(f"[unwrap] {rel_path}: +{delta} unwrap() (now {current_count}, was {old_count}) — consider ? or expect(\"reason\")")

    return 0  # warning only, never block


if __name__ == "__main__":
    raise SystemExit(main())
