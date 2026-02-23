#!/usr/bin/env python3
"""Audit docker-compose.yaml image tags for staleness.

Analogous to `cargo audit` for Cargo.toml: after editing docker-compose.yaml,
this checks whether any pinned image tags are outdated relative to what's
currently published on Docker Hub.

An "outdated" tag means a newer tag matching the same version pattern exists
(e.g., pinned to postgres:17-alpine but 17.3-alpine is available). It does NOT
flag major version bumps — only patch/minor updates within the same channel.

Exits 0 if all images are current, 1 if any are outdated, 2 on setup error.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml required — pip install pyyaml", file=sys.stderr)
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parents[1]
COMPOSE_FILE = REPO_ROOT / "docker-compose.yaml"

# How many tags to fetch from Docker Hub per image (sorted by last updated)
TAG_FETCH_LIMIT = 50
TIMEOUT = 10  # seconds per HTTP request


@dataclass
class ImageRef:
    service: str
    raw: str          # e.g. "postgres:17-alpine"
    registry: str     # "docker.io" or custom
    repo: str         # e.g. "library/postgres" or "qdrant/qdrant"
    tag: str          # e.g. "17-alpine"


def parse_image(service: str, raw: str) -> ImageRef:
    """Parse a Docker image string into its components."""
    # Strip registry prefix if present (e.g. ghcr.io/, quay.io/)
    registry = "docker.io"
    image = raw
    if "/" in raw and ("." in raw.split("/")[0] or ":" in raw.split("/")[0]):
        registry = raw.split("/")[0]
        image = raw[len(registry) + 1:]

    if ":" in image:
        repo_part, tag = image.rsplit(":", 1)
    else:
        repo_part, tag = image, "latest"

    # Docker Hub official images have no slash — normalize to library/<name>
    if "/" not in repo_part:
        repo_part = f"library/{repo_part}"

    return ImageRef(service=service, raw=raw, registry=registry, repo=repo_part, tag=tag)


def hub_tags(image: ImageRef) -> list[str]:
    """Fetch recent tags from Docker Hub for an image repo."""
    if image.registry != "docker.io":
        return []  # Only Docker Hub supported

    url = (
        f"https://hub.docker.com/v2/repositories/{image.repo}/tags"
        f"?page_size={TAG_FETCH_LIMIT}&ordering=last_updated"
    )
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read())
        return [t["name"] for t in data.get("results", [])]
    except (urllib.error.URLError, json.JSONDecodeError, KeyError) as exc:
        print(f"  [warn] could not fetch tags for {image.repo}: {exc}", file=sys.stderr)
        return []


def tag_channel(tag: str) -> str | None:
    """Extract the 'channel' from a tag for comparison purposes.

    Examples:
      "17-alpine"      -> "17-alpine"   (major + suffix)
      "8.2-alpine"     -> "8-alpine"    (normalise minor for redis-style tags)
      "v1.13.1"        -> "v1"
      "4.0-management" -> "4-management"
      "latest"         -> None          (unpinned, skip)
    """
    if tag in ("latest", "stable", "edge", "nightly"):
        return None

    # Strip leading 'v'
    clean = tag.lstrip("v")

    # Split on first non-numeric, non-dot separator
    # e.g. "17-alpine" -> major="17", suffix="-alpine"
    #      "8.2-alpine" -> major="8", rest=".2-alpine" -> suffix="-alpine"
    m = re.match(r"^(\d+)(?:\.(\d+))?(.*)$", clean)
    if not m:
        return None

    major = m.group(1)
    suffix = m.group(3)  # e.g. "-alpine", "-management", ""

    return f"{major}{suffix}"


def find_newer(image: ImageRef, available: list[str]) -> list[str]:
    """Return tags from available that are newer than the pinned tag.

    'Newer' means: same channel (major + suffix), but a higher minor/patch
    version number embedded in the tag.
    """
    channel = tag_channel(image.tag)
    if channel is None:
        return []  # Can't compare unpinned tags

    # Extract numeric version from pinned tag
    pinned_clean = image.tag.lstrip("v")
    pinned_m = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?", pinned_clean)
    if not pinned_m:
        return []

    pinned_parts = tuple(
        int(x) for x in [pinned_m.group(1), pinned_m.group(2) or "0", pinned_m.group(3) or "0"]
    )
    pinned_suffix = re.sub(r"^\d+(\.\d+)*", "", pinned_clean)  # e.g. "-alpine"

    newer = []
    for tag in available:
        if tag == image.tag:
            continue
        tag_clean = tag.lstrip("v")
        tag_m = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?", tag_clean)
        if not tag_m:
            continue
        tag_parts = tuple(
            int(x) for x in [tag_m.group(1), tag_m.group(2) or "0", tag_m.group(3) or "0"]
        )
        tag_suffix = re.sub(r"^\d+(\.\d+)*", "", tag_clean)

        # Same major + same suffix (channel match), higher version
        if (
            tag_parts[0] == pinned_parts[0]
            and tag_suffix == pinned_suffix
            and tag_parts > pinned_parts
        ):
            newer.append(tag)

    return newer


def extract_images(compose_path: Path) -> list[ImageRef]:
    """Parse docker-compose.yaml and return all pinned image refs."""
    data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    services = data.get("services", {})
    images = []
    for svc_name, svc in services.items():
        raw = svc.get("image")
        if raw:
            images.append(parse_image(svc_name, raw))
    return images


def main() -> int:
    if not COMPOSE_FILE.exists():
        print(f"ERROR: {COMPOSE_FILE} not found", file=sys.stderr)
        return 2

    images = extract_images(COMPOSE_FILE)
    if not images:
        print("No image: entries found in docker-compose.yaml.")
        return 0

    print(f"Checking {len(images)} image(s) against Docker Hub...\n")

    outdated: list[tuple[ImageRef, list[str]]] = []
    skipped: list[ImageRef] = []

    for img in images:
        if img.registry != "docker.io":
            print(f"  {img.service}: {img.raw} — skipped (non-Docker Hub registry)")
            skipped.append(img)
            continue

        available = hub_tags(img)
        if not available:
            print(f"  {img.service}: {img.raw} — could not fetch tags (offline?)")
            continue

        newer = find_newer(img, available)
        if newer:
            print(f"  {img.service}: {img.raw} — OUTDATED (newer: {', '.join(newer[:3])})")
            outdated.append((img, newer))
        else:
            print(f"  {img.service}: {img.raw} — OK")

    print()
    if outdated:
        print(f"Found {len(outdated)} outdated image(s):")
        for img, newer in outdated:
            print(f"  {img.service}: {img.raw!r} → consider {newer[0]!r}")
        print("\nUpdate the image tags in docker-compose.yaml and rebuild.")
        return 1

    print("All images are current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
