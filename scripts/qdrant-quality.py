#!/usr/bin/env python3
"""Compatibility entrypoint for Qdrant quality checks."""

from pathlib import Path
import runpy
import sys

script = Path(__file__).with_name("check_qdrant_quality.py")
if not script.exists():
    print(f"error: expected target script not found: {script}", file=sys.stderr)
    sys.exit(1)

runpy.run_path(str(script), run_name="__main__")
