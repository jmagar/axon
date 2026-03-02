#!/usr/bin/env python3
"""Entrypoint wrapper for monolith policy checks."""

from __future__ import annotations

from enforce_monoliths_impl import main


if __name__ == '__main__':
    raise SystemExit(main())
