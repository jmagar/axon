#!/usr/bin/env python3
"""PostToolUse hook: remind to update CHANGELOG.md when editing production crates.

Reads the edited file path from stdin JSON (Claude Code hook protocol).
Fires only for files under crates/ that are not test-only.
Checks whether CHANGELOG.md has any unstaged/staged modifications in the
current git working tree. If not modified, prints a single reminder line.

Exits 0 always (reminder only — never blocks).
Low noise: only prints when CHANGELOG.md is untouched.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHANGELOG = REPO_ROOT / "CHANGELOG.md"

# Paths under crates/ that don't warrant a changelog entry
SKIP_SUFFIXES = {"_test.rs", "/tests.rs"}
SKIP_STEMS = {"mod"}  # bare mod.rs re-exports only


def changelog_is_modified() -> bool:
    """Return True if CHANGELOG.md has any git modification (staged or unstaged)."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "CHANGELOG.md"],
            capture_output=True, text=True, timeout=5,
            cwd=REPO_ROOT,
        )
        return bool(result.stdout.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return True  # can't check → assume fine, don't spam


def main() -> int:
    try:
        data = json.load(sys.stdin)
        file_path: str = data.get("tool_input", {}).get("file_path", "")
    except (json.JSONDecodeError, KeyError):
        return 0

    if not file_path.endswith(".rs"):
        return 0

    # Only fire for production crates/ code
    if "crates/" not in file_path:
        return 0
    if any(file_path.endswith(s) for s in SKIP_SUFFIXES):
        return 0

    path = Path(file_path)
    if path.stem in SKIP_STEMS:
        return 0

    # Skip pure test files (no non-test code)
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
        non_test_lines = [
            l for l in text.splitlines()
            if l.strip() and not l.strip().startswith("//")
        ]
        # Heuristic: if the only pub items are test modules, skip
        if "#[cfg(test)]" in text and len(non_test_lines) < 10:
            return 0
    except OSError:
        return 0

    if not changelog_is_modified():
        print(f"[changelog] CHANGELOG.md unchanged — remember to add an entry under [Unreleased] for this change")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
