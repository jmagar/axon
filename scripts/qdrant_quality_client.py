#!/usr/bin/env python3
"""Qdrant API I/O helpers for qdrant quality checks."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


QDRANT_URL = ""


def set_qdrant_url(url: str) -> None:
    global QDRANT_URL
    QDRANT_URL = url.rstrip("/")


def get_qdrant_url() -> str:
    return QDRANT_URL


def qdrant_request(path: str, method: str = "GET", body: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    def should_retry_http(status: int) -> bool:
        return status == 429 or status >= 500

    url = f"{QDRANT_URL}{path}"
    payload = None
    headers = {"Content-Type": "application/json"}

    if body is not None:
        payload = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url=url, data=payload, headers=headers, method=method)
    retries = 3
    backoff_seconds = 0.25
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            last_error = exc
            if attempt < retries and should_retry_http(exc.code):
                time.sleep(backoff_seconds * (attempt + 1))
                continue
            msg = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Qdrant request failed {exc.code} {exc.reason}: {msg}") from exc
        except urllib.error.URLError as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(backoff_seconds * (attempt + 1))
                continue
            raise RuntimeError(f"Qdrant request failed: {exc.reason}") from exc

    raise RuntimeError(f"Qdrant request failed after retries: {last_error}")


def get_cluster_info() -> dict[str, Any]:
    data = qdrant_request("/", timeout=10)
    return {"version": data.get("version", "unknown"), "commit": data.get("commit")}


def list_collections() -> list[str]:
    data = qdrant_request("/collections", timeout=10)
    rows = data.get("result", {}).get("collections", [])
    return [name for row in rows if isinstance(row, dict) and isinstance(name := row.get("name"), str)]


def list_aliases() -> list[dict[str, str]]:
    data = qdrant_request("/aliases", timeout=10)
    result = data.get("result")
    aliases_rows: list[Any]
    if isinstance(result, dict):
        aliases_rows = result.get("aliases", []) or []
    elif isinstance(result, list):
        aliases_rows = result
    else:
        aliases_rows = []

    aliases: list[dict[str, str]] = []
    for row in aliases_rows:
        if not isinstance(row, dict):
            continue
        alias_name = row.get("alias_name")
        collection_name = row.get("collection_name")
        if isinstance(alias_name, str) and isinstance(collection_name, str):
            aliases.append({"alias_name": alias_name, "collection_name": collection_name})
    return aliases


def get_collection_info(collection: str) -> dict[str, Any]:
    data = qdrant_request(f"/collections/{collection}", timeout=10)
    result = data.get("result")
    if not isinstance(result, dict):
        raise RuntimeError(f"No collection info returned for '{collection}'")
    return result


def fetch_all_points(
    collection: str,
    *,
    emit_output: bool = True,
    sample_limit: int | None = None,
) -> list[dict[str, Any]]:
    if emit_output:
        print(f"Fetching points from {QDRANT_URL}/collections/{collection}...", flush=True)
    points: list[dict[str, Any]] = []
    offset: Any | None = None

    while True:
        body: dict[str, Any] = {"limit": 100, "with_payload": True, "with_vector": False}
        if offset is not None:
            body["offset"] = offset

        data = qdrant_request(
            f"/collections/{collection}/points/scroll",
            method="POST",
            body=body,
            timeout=60,
        )

        result = data.get("result", {})
        batch = result.get("points") or []
        if not batch:
            break

        points.extend(batch)
        if sample_limit is not None and sample_limit > 0 and len(points) >= sample_limit:
            points = points[:sample_limit]
            if emit_output:
                sys.stderr.write(f"\rSample limit reached at {len(points)} points\n")
            break
        if emit_output:
            sys.stderr.write(f"\rFetched {len(points)} points...")
            sys.stderr.flush()

        next_offset = result.get("next_page_offset")
        if next_offset is None:
            break
        offset = next_offset

    if emit_output:
        sys.stderr.write(f"\rFetched {len(points)} points total\n")
    return points


def delete_points(collection: str, ids: list[Any], *, emit_output: bool = True) -> None:
    if not ids:
        return

    batch_size = 1000
    deleted = 0
    if emit_output:
        print(f"Deleting {len(ids)} points in batches of {batch_size}...")

    for idx in range(0, len(ids), batch_size):
        batch = ids[idx : idx + batch_size]
        qdrant_request(
            f"/collections/{collection}/points/delete?wait=true",
            method="POST",
            body={"points": batch},
            timeout=60,
        )
        deleted += len(batch)
        if emit_output:
            sys.stderr.write(f"\rDeleted {deleted}/{len(ids)} points...")
            sys.stderr.flush()

    if emit_output:
        sys.stderr.write("\n")
        print(f"Deleted {deleted} points")
