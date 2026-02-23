#!/usr/bin/env python3
"""PostToolUse hook: warn when Justfile or lefthook.yml is edited without the other.

Reads the edited file path from stdin JSON (Claude Code hook protocol).
Fires when either Justfile or lefthook.yml is edited.
Checks whether the counterpart file has also been modified in the current
git working tree (staged or unstaged). If not, prints a reminder.

Exits 0 always (reminder only — never blocks).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

PAIRS = {
    "Justfile": "lefthook.yml",
    "lefthook.yml": "Justfile",
}


def is_modified(filename: str) -> bool:
    """Return True if the file has any git modification (staged or unstaged)."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", filename],
            capture_output=True, text=True, timeout=5,
            cwd=REPO_ROOT,
        )
        return bool(result.stdout.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return True  # can't check → assume fine


def main() -> int:
    try:
        data = json.load(sys.stdin)
        file_path: str = data.get("tool_input", {}).get("file_path", "")
    except (json.JSONDecodeError, KeyError):
        return 0

    basename = Path(file_path).name
    counterpart = PAIRS.get(basename)
    if not counterpart:
        return 0

    if not is_modified(counterpart):
        print(
            f"[sync] Edited {basename} but {counterpart} is unchanged — "
            f"both define the pre-commit check sequence. Does {counterpart} need updating too?"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
