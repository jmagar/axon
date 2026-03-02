#!/usr/bin/env python3
"""Dataclasses for qdrant quality checks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class DuplicateGroup:
    url: str
    count: int
    ids: list[Any]


@dataclass
class DataQualityIssues:
    missing_url: int = 0
    missing_content: int = 0
    empty_content: int = 0
    missing_chunk_index: int = 0

    @property
    def total(self) -> int:
        return (
            self.missing_url
            + self.missing_content
            + self.empty_content
            + self.missing_chunk_index
        )


@dataclass
class ExcludeViolationStats:
    matched_points: int
    matched_urls: int
    matched_ids: list[Any]
    top_urls: list[tuple[str, int, str]]


@dataclass
class NormalizedExcludePrefixes:
    prefixes: list[str]
    disable_defaults: bool
