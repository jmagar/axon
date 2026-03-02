#!/usr/bin/env python3
"""Generate docs/MCP-TOOL-SCHEMA.md from crates/mcp/schema.rs.

Parses the Rust source for struct/enum definitions and produces a markdown
document that stays in sync with the actual wire contract. Run with --check
in CI to detect drift.

Exit codes:
    0 — success (or --check passed)
    1 — --check detected a diff
    2 — parse error or missing source file
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class FieldDef:
    """A single struct field parsed from Rust source."""

    name: str
    rust_type: str

    @property
    def is_optional(self) -> bool:
        return self.rust_type.startswith("Option<")

    @property
    def inner_type(self) -> str:
        """Unwrap Option<T> -> T, otherwise return raw type."""
        m = re.match(r"Option<(.+)>", self.rust_type)
        return m.group(1) if m else self.rust_type

    @property
    def display_type(self) -> str:
        """Human-readable type for docs."""
        inner = self.inner_type
        type_map: dict[str, str] = {
            "String": "string",
            "bool": "bool",
            "u32": "u32",
            "u64": "u64",
            "i64": "i64",
            "usize": "usize",
            "Vec<String>": "string[]",
            "Value": "any",
        }
        return type_map.get(inner, inner)


@dataclass
class StructDef:
    """A parsed Rust struct."""

    name: str
    fields: list[FieldDef] = field(default_factory=list)

    @property
    def has_subaction(self) -> bool:
        return any(f.name == "subaction" for f in self.fields)

    @property
    def subaction_enum_name(self) -> str | None:
        for f in self.fields:
            if f.name == "subaction":
                return f.inner_type
        return None

    def optional_fields(self) -> list[FieldDef]:
        return [f for f in self.fields if f.is_optional]

    def required_fields(self) -> list[FieldDef]:
        return [f for f in self.fields if not f.is_optional and f.name != "subaction"]


@dataclass
class EnumDef:
    """A parsed Rust enum."""

    name: str
    variants: list[str] = field(default_factory=list)

    def snake_variants(self) -> list[str]:
        """Convert PascalCase variants to snake_case (matching serde rename_all)."""
        result: list[str] = []
        for v in self.variants:
            snake = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", v).lower()
            result.append(snake)
        return result


# ---------------------------------------------------------------------------
# Action name mapping (serde tag values from AxonRequest enum)
# ---------------------------------------------------------------------------

# Maps AxonRequest variant → action name (snake_case from serde rename_all).
# Also maps Request struct name → action name for struct lookups.
VARIANT_TO_ACTION: dict[str, str] = {
    "Status": "status",
    "Crawl": "crawl",
    "Extract": "extract",
    "Embed": "embed",
    "Ingest": "ingest",
    "Query": "query",
    "Retrieve": "retrieve",
    "Search": "search",
    "Map": "map",
    "Doctor": "doctor",
    "Domains": "domains",
    "Sources": "sources",
    "Stats": "stats",
    "Help": "help",
    "Artifacts": "artifacts",
    "Scrape": "scrape",
    "Research": "research",
    "Ask": "ask",
    "Screenshot": "screenshot",
    "Refresh": "refresh",
}

STRUCT_TO_ACTION: dict[str, str] = {
    f"{k}Request": v for k, v in VARIANT_TO_ACTION.items()
}

# Lifecycle families get special documentation treatment.
LIFECYCLE_FAMILIES: set[str] = {"crawl", "extract", "embed", "ingest", "refresh"}

# Actions listed under "Direct Actions" — no subaction required.
# Determined by struct NOT having a subaction field. Artifacts has subaction
# but is a utility, not a lifecycle family. We auto-detect from parsed data.

# Crawl-specific field descriptions (hardcoded — not derivable from types).
CRAWL_FIELD_DESCRIPTIONS: dict[str, tuple[str, str]] = {
    # field_name: (default, description)
    "urls": ("--", "Seed URLs (required, non-empty array)"),
    "max_pages": ("0 (uncapped)", "Page limit"),
    "max_depth": ("5", "Max crawl depth"),
    "include_subdomains": ("true", "Include subdomains"),
    "respect_robots": ("false", "Honour robots.txt"),
    "discover_sitemaps": ("true", "Run sitemap backfill after crawl"),
    "sitemap_since_days": (
        "0",
        "Only backfill sitemap URLs with `<lastmod>` within last N days (0 = no filter)",
    ),
    "render_mode": ("`auto_switch`", "`http`, `chrome`, `auto_switch`"),
    "delay_ms": ("0", "Per-request delay ms"),
}

# Runtime env vars — not in schema.rs, hardcoded here.
RUNTIME_ENV_VARS: list[str] = [
    "AXON_PG_URL",
    "AXON_REDIS_URL",
    "AXON_AMQP_URL",
    "QDRANT_URL",
    "TEI_URL",
    "OPENAI_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "TAVILY_API_KEY",
]


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def parse_schema(source: str) -> tuple[dict[str, StructDef], dict[str, EnumDef]]:
    """Parse struct and enum definitions from Rust source."""
    structs: dict[str, StructDef] = {}
    enums: dict[str, EnumDef] = {}

    # Parse structs
    struct_pattern = re.compile(r"pub\s+struct\s+(\w+)\s*\{([^}]*)\}", re.DOTALL)
    field_pattern = re.compile(r"pub\s+(\w+)\s*:\s*([^,\n]+)")

    for m in struct_pattern.finditer(source):
        name = m.group(1)
        body = m.group(2)
        fields: list[FieldDef] = []
        for fm in field_pattern.finditer(body):
            fname = fm.group(1)
            ftype = fm.group(2).strip().rstrip(",").strip()
            fields.append(FieldDef(name=fname, rust_type=ftype))
        structs[name] = StructDef(name=name, fields=fields)

    # Parse enums
    enum_pattern = re.compile(r"pub\s+enum\s+(\w+)\s*\{([^}]*)\}", re.DOTALL)
    variant_pattern = re.compile(r"(\w+)(?:\s*\(|\s*,|\s*$)")

    for m in enum_pattern.finditer(source):
        name = m.group(1)
        body = m.group(2)
        variants: list[str] = []
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("//") or line.startswith("#"):
                continue
            vm = re.match(r"(\w+)", line)
            if vm:
                v = vm.group(1)
                # Skip serde attribute keywords that leak through
                if v in {"pub", "fn", "let", "use", "mod", "impl", "type"}:
                    continue
                variants.append(v)
        enums[name] = EnumDef(name=name, variants=variants)

    return structs, enums


def validate_parsed(
    structs: dict[str, StructDef],
    enums: dict[str, EnumDef],
) -> list[str]:
    """Return a list of validation errors (empty = OK)."""
    errors: list[str] = []

    # Every action struct must exist
    for struct_name, action in STRUCT_TO_ACTION.items():
        if struct_name not in structs:
            errors.append(f"Missing struct {struct_name} for action '{action}'")

    # Every subaction enum referenced by a *request* struct must exist
    for struct_name in STRUCT_TO_ACTION:
        sdef = structs.get(struct_name)
        if not sdef:
            continue
        enum_name = sdef.subaction_enum_name
        if enum_name and enum_name not in enums:
            errors.append(
                f"Struct {struct_name} references enum {enum_name} but it was not found"
            )

    # AxonRequest enum must exist
    if "AxonRequest" not in enums:
        errors.append("Missing AxonRequest enum")

    return errors


# ---------------------------------------------------------------------------
# Markdown generator
# ---------------------------------------------------------------------------


def generate_markdown(
    structs: dict[str, StructDef],
    enums: dict[str, EnumDef],
) -> str:
    """Produce the full MCP-TOOL-SCHEMA.md content."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines: list[str] = []

    def emit(text: str = "") -> None:
        lines.append(text)

    # ── Header ────────────────────────────────────────────────────
    emit("# Axon MCP Tool Schema (Source of Truth)")
    emit(f"Last Modified: {today}")
    emit()
    emit(
        "<!-- AUTO-GENERATED by scripts/generate_mcp_schema_doc.py — do not edit manually -->"
    )
    emit()

    # ── Contract ──────────────────────────────────────────────────
    emit("## Contract")
    emit("- MCP server binary: `axon-mcp`")
    emit("- Tool count: `1`")
    emit("- Tool name: `axon`")
    emit("- Primary route field: `action`")
    emit("- Canonical route form: `action` + optional `subaction`")
    emit(
        "- Response control field: `response_mode` (`path|inline|both`, default `path`)"
    )
    emit()
    emit("Code references:")
    emit("- `crates/mcp/schema.rs`")
    emit("- `crates/mcp/server.rs`")
    emit()

    # ── Success envelope ──────────────────────────────────────────
    emit("## Canonical Success Envelope")
    emit("```json")
    emit("{")
    emit('  "ok": true,')
    emit('  "action": "<resolved action>",')
    emit('  "subaction": "<resolved subaction>",')
    emit('  "data": { "...": "..." }')
    emit("}")
    emit("```")
    emit()

    # ── Parser rules ──────────────────────────────────────────────
    emit("## Parser Rules")
    emit("Incoming request map is parsed strictly with serde:")
    emit()
    emit("- `action` is required and must match canonical schema names")
    emit(
        "- `subaction` is required for lifecycle families "
        "(`crawl|extract|embed|ingest|refresh|artifacts`)"
    )
    emit("- No fallback fields (`command`, `op`, `operation`)")
    emit("- No token normalization or case folding")
    emit("- No action alias remapping")
    emit()

    # ── Preferred client actions ──────────────────────────────────
    # Classify actions
    lifecycle_actions: list[str] = []
    direct_actions: list[str] = []
    for struct_name, action in sorted(STRUCT_TO_ACTION.items(), key=lambda x: x[1]):
        sdef = structs.get(struct_name)
        if sdef and sdef.has_subaction:
            lifecycle_actions.append(action)
        else:
            direct_actions.append(action)

    emit("## Preferred Client Actions")
    emit("Use CLI-identical top-level actions:")

    # Group for readability
    lifecycle_str = ", ".join(f"`{a}`" for a in sorted(lifecycle_actions))
    direct_str = ", ".join(f"`{a}`" for a in sorted(direct_actions))
    emit(f"- Lifecycle families: {lifecycle_str}")
    emit(f"- Direct actions: {direct_str}")
    emit()
    emit(
        "For lifecycle management (`status|cancel|list|cleanup|clear|recover`), "
        "use canonical families with `subaction`. "
        "`refresh` also supports `schedule` subaction with `schedule_subaction` param "
        "(`list`, `create`, `delete`, `enable`, `disable`):"
    )
    emit()
    emit("```json")
    emit('{ "action": "ingest", "subaction": "status", "job_id": "..." }')
    emit("```")
    emit()

    # ── Response policy ───────────────────────────────────────────
    emit("## Response Policy (Context-Safe Defaults)")
    emit("- Default is artifact-first (`response_mode=path`).")
    emit("- Heavy operations write result artifacts to `.cache/axon-mcp/`.")
    emit("- Tool response returns compact metadata only by default:")
    emit("  - `path`, `bytes`, `line_count`, `sha256`, `preview`, `preview_truncated`")
    emit("- Inline modes are capped/truncated and always include artifact pointers.")
    emit()

    # ── Direct actions ────────────────────────────────────────────
    emit("## Direct Actions")
    emit("These actions do not require `subaction`:")
    emit()
    emit("| Action | Required Fields | Optional Fields |")
    emit("|--------|----------------|-----------------|")
    for action in sorted(direct_actions):
        struct_name = _action_to_struct(action)
        sdef = structs.get(struct_name)
        if not sdef:
            continue
        required = [f for f in sdef.required_fields()]
        optional = [f for f in sdef.optional_fields()]
        req_str = ", ".join(f"`{f.name}` ({f.display_type})" for f in required) or "--"
        opt_str = ", ".join(f"`{f.name}`" for f in optional) or "--"
        emit(f"| `{action}` | {req_str} | {opt_str} |")
    emit()

    # ── Crawl start parameters ────────────────────────────────────
    emit("## Crawl Start Parameters")
    emit(
        'Optional fields accepted on `{ "action": "crawl", "subaction": "start", ... }`:'
    )
    emit()
    emit("| Field | Type | Default | Description |")
    emit("|-------|------|---------|-------------|")
    crawl_struct = structs.get("CrawlRequest")
    if crawl_struct:
        for f in crawl_struct.optional_fields():
            if f.name in ("job_id", "limit", "offset", "response_mode"):
                continue  # Common lifecycle fields, not crawl-specific
            desc_info = CRAWL_FIELD_DESCRIPTIONS.get(f.name)
            default = desc_info[0] if desc_info else "--"
            desc = desc_info[1] if desc_info else ""
            emit(f"| `{f.name}` | {f.display_type} | {default} | {desc} |")
    emit()

    # ── Refresh start parameters ──────────────────────────────────
    emit("## Refresh Start Parameters")
    emit("`refresh` accepts either form:")
    emit("- `url` (string) -- single URL refresh")
    emit("- `urls` (string[]) -- batch URL refresh")
    emit()
    emit(
        "For scheduled refreshes: "
        '`{ "action": "refresh", "subaction": "schedule", '
        '"schedule_subaction": "list|create|delete|enable|disable", '
        '"schedule_name": "..." }`'
    )
    emit()

    # ── Lifecycle action families ─────────────────────────────────
    emit("## Lifecycle Action Families")

    for action in sorted(lifecycle_actions):
        struct_name = _action_to_struct(action)
        sdef = structs.get(struct_name)
        if not sdef:
            continue
        enum_name = sdef.subaction_enum_name
        edef = enums.get(enum_name, None) if enum_name else None
        subactions = "|".join(edef.snake_variants()) if edef else "?"

        # Determine start requirements
        start_fields = _start_requirement_summary(action, sdef)
        emit(f"- `{action}`: `{subactions}` -- {start_fields}")

    emit()

    # ── Ingest source types ───────────────────────────────────────
    emit("## Ingest Source Types")
    ingest_enum = enums.get("IngestSourceType")
    if ingest_enum:
        emit()
        emit("| Source Type | Description |")
        emit("|------------|-------------|")
        source_descriptions: dict[str, str] = {
            "github": "Ingest GitHub repo (code, issues, PRs, wiki)",
            "reddit": "Ingest subreddit posts/comments",
            "youtube": "Ingest YouTube video transcript via yt-dlp",
            "sessions": "Ingest AI session exports (Claude/Codex/Gemini)",
        }
        for v in ingest_enum.snake_variants():
            desc = source_descriptions.get(v, "")
            emit(f"| `{v}` | {desc} |")
    emit()

    # ── Sessions ingest options ───────────────────────────────────
    sessions_struct = structs.get("SessionsIngestOptions")
    if sessions_struct:
        emit("### Sessions Ingest Options")
        emit(
            "When `source_type` is `sessions`, the optional `sessions` object accepts:"
        )
        emit()
        emit("| Field | Type | Description |")
        emit("|-------|------|-------------|")
        for f in sessions_struct.fields:
            emit(f"| `{f.name}` | {f.display_type} | -- |")
        emit()

    # ── Artifacts subactions ──────────────────────────────────────
    emit("## Artifacts Subactions")
    artifacts_enum = enums.get("ArtifactsSubaction")
    artifacts_struct = structs.get("ArtifactsRequest")
    if artifacts_enum:
        emit(f"Subactions: `{'|'.join(artifacts_enum.snake_variants())}`")
        emit()
    if artifacts_struct:
        emit("`artifacts` fields:")
        emit("- `path` (required)")
        emit("- `pattern` (required for `grep`)")
        emit("- `limit` and `offset` for paginated inspection")
    emit()

    # ── Enum values ───────────────────────────────────────────────
    emit("## Enum Values")
    emit()
    # Document user-facing enums (not AxonRequest or subaction enums)
    user_enums = [
        "ResponseMode",
        "McpRenderMode",
        "SearchTimeRange",
        "IngestSourceType",
    ]
    for enum_name in user_enums:
        edef = enums.get(enum_name)
        if not edef:
            continue
        emit(f"### `{enum_name}`")
        emit(f"Values: `{'|'.join(edef.snake_variants())}`")
        emit()

    # ── Pagination ────────────────────────────────────────────────
    emit("## Pagination Defaults")
    emit(
        "List/search style endpoints default to low limits and accept `limit` + `offset`."
    )
    emit()

    # ── MCP resources ─────────────────────────────────────────────
    emit("## MCP Resources")
    emit("Implemented resource(s):")
    emit("- `axon://schema/mcp-tool`")
    emit()

    # ── Runtime dependencies ──────────────────────────────────────
    emit("## Runtime Dependencies")
    emit("No MCP-specific env namespace. Server reads existing Axon stack vars:")
    for var in RUNTIME_ENV_VARS:
        emit(f"- `{var}`")
    emit()

    # ── Error semantics ───────────────────────────────────────────
    emit("## Error Semantics")
    emit("- Input or shape failures -> MCP `invalid_params`")
    emit("- Runtime failures -> MCP `internal_error`")
    emit()

    return "\n".join(lines)


def _action_to_struct(action: str) -> str:
    """Convert action name back to struct name."""
    for struct_name, act in STRUCT_TO_ACTION.items():
        if act == action:
            return struct_name
    return ""


def _start_requirement_summary(action: str, sdef: StructDef) -> str:
    """Summarize what the 'start' subaction requires."""
    match action:
        case "crawl":
            return "start requires `urls` (array)"
        case "extract":
            return "start requires `urls` (array)"
        case "embed":
            return "start requires `input` (string)"
        case "ingest":
            return "start requires `source_type` + `target`"
        case "refresh":
            return "start accepts `url` or `urls`"
        case "artifacts":
            return "requires `path`; `pattern` for grep"
        case _:
            req = sdef.required_fields()
            if req:
                return "requires " + ", ".join(f"`{f.name}`" for f in req)
            return "no required fields"


# ---------------------------------------------------------------------------
# Repo root detection
# ---------------------------------------------------------------------------


def find_repo_root(start: Path | None = None) -> Path | None:
    """Walk up from start looking for the axon_rust repo root."""
    current = (start or Path.cwd()).resolve()
    for directory in [current, *current.parents]:
        if (directory / ".git").is_dir():
            return directory
        cargo = directory / "Cargo.toml"
        if cargo.is_file() and 'name = "axon"' in cargo.read_text(encoding="utf-8"):
            return directory
    return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate docs/MCP-TOOL-SCHEMA.md from crates/mcp/schema.rs",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Compare generated output against existing file; exit 1 on diff",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print generated markdown to stdout without writing",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Override repo root detection",
    )
    args = parser.parse_args()

    # Resolve paths
    repo_root = args.repo_root or find_repo_root()
    if repo_root is None:
        print("ERROR: Could not find repo root. Pass --repo-root.", file=sys.stderr)
        return 2

    schema_path = repo_root / "crates" / "mcp" / "schema.rs"
    doc_path = repo_root / "docs" / "MCP-TOOL-SCHEMA.md"

    if not schema_path.is_file():
        print(f"ERROR: Schema file not found: {schema_path}", file=sys.stderr)
        return 2

    # Parse
    source = schema_path.read_text(encoding="utf-8")
    structs, enums = parse_schema(source)

    errors = validate_parsed(structs, enums)
    if errors:
        for err in errors:
            print(f"PARSE ERROR: {err}", file=sys.stderr)
        return 2

    # Generate
    generated = generate_markdown(structs, enums)

    # --dry-run: print and exit
    if args.dry_run:
        print(generated)
        return 0

    # --check: compare against existing
    if args.check:
        if not doc_path.is_file():
            print(f"ERROR: Doc file not found for --check: {doc_path}", file=sys.stderr)
            return 1

        existing = doc_path.read_text(encoding="utf-8")
        # Normalize: ignore the date line for comparison (it changes daily)
        existing_normalized = _normalize_for_check(existing)
        generated_normalized = _normalize_for_check(generated)

        if existing_normalized == generated_normalized:
            print(f"OK: {doc_path.relative_to(repo_root)} is up to date")
            return 0

        diff = difflib.unified_diff(
            existing_normalized.splitlines(keepends=True),
            generated_normalized.splitlines(keepends=True),
            fromfile=str(doc_path.relative_to(repo_root)),
            tofile="(generated)",
        )
        print(f"DRIFT DETECTED in {doc_path.relative_to(repo_root)}:")
        sys.stdout.writelines(diff)
        return 1

    # Write
    doc_path.parent.mkdir(parents=True, exist_ok=True)
    doc_path.write_text(generated, encoding="utf-8")
    print(f"Wrote {doc_path.relative_to(repo_root)} ({len(generated)} bytes)")
    return 0


def _normalize_for_check(text: str) -> str:
    """Strip the date line so daily regeneration does not cause false diffs."""
    return re.sub(
        r"^Last Modified: .*$", "Last Modified: <date>", text, flags=re.MULTILINE
    )


if __name__ == "__main__":
    sys.exit(main())
