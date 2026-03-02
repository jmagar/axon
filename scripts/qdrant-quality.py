#!/usr/bin/env python3
"""Entrypoint wrapper for qdrant quality checks."""

from __future__ import annotations

import sys

from qdrant_quality_impl import main


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('\nInterrupted', file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001
        print(f'Error: {exc}', file=sys.stderr)
        raise SystemExit(1)
