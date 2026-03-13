#!/usr/bin/env python3
"""Enforce architectural dependency direction for the services layer.

Rules:
  1. lib.rs must NOT import from crates::vector::ops (use CLI commands → services)
  2. crates/services/*.rs must NOT import from crates::cli::commands (services never depend on CLI)
  3. crates/mcp/server/handlers_*.rs must NOT import from crates::vector::ops or crates::cli::commands

Exit 0 if clean, 1 if violations found.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

RULES: list[tuple[str, list[str], str]] = [
    # (glob pattern, forbidden import prefixes, description)
    (
        "lib.rs",
        ["crate::crates::vector::ops::run_"],
        "lib.rs must route through CLI commands, not vector::ops::run_*_native()",
    ),
    (
        "crates/services/**/*.rs",
        ["crate::crates::cli::commands"],
        "services must never import from CLI layer",
    ),
    (
        "crates/mcp/server/handlers_*.rs",
        ["crate::crates::vector::ops", "crate::crates::cli::commands"],
        "MCP handlers must only import from services, not vector::ops or CLI",
    ),
]

USE_RE = re.compile(r"^\s*use\s+(.+?);", re.MULTILINE)


def check_file(path: Path, forbidden: list[str], desc: str) -> list[str]:
    """Return list of violation messages for a single file."""
    violations = []
    text = path.read_text(errors="replace")
    for m in USE_RE.finditer(text):
        import_path = m.group(1).strip()
        for prefix in forbidden:
            if prefix in import_path:
                lineno = text[: m.start()].count("\n") + 1
                rel = path.relative_to(REPO)
                violations.append(f"  {rel}:{lineno}: `{import_path}` — {desc}")
    return violations


def main() -> int:
    all_violations: list[str] = []
    for glob_pat, forbidden, desc in RULES:
        # Handle single file vs glob
        if "*" in glob_pat or "**" in glob_pat:
            files = list(REPO.rglob(glob_pat.replace("**/", "")))
            # Filter to match the glob more precisely
            if glob_pat.startswith("crates/services/"):
                files = [f for f in REPO.glob(glob_pat)]
            elif glob_pat.startswith("crates/mcp/"):
                files = [f for f in REPO.glob(glob_pat)]
        else:
            candidate = REPO / glob_pat
            files = [candidate] if candidate.exists() else []

        for path in files:
            if not path.is_file():
                continue
            all_violations.extend(check_file(path, forbidden, desc))

    if all_violations:
        print("Services layer dependency violations found:\n")
        for v in all_violations:
            print(v)
        print(f"\n{len(all_violations)} violation(s) total.")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
