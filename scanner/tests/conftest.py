"""Shared pytest fixtures for the asv-scanner test suite."""

import os
import sys
from pathlib import Path

# Make `app` importable from the repo root regardless of cwd.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Dev manifest secret by default so verify tests run without env setup.
os.environ.setdefault("MANIFEST_SECRET", "dev-manifest-secret")
os.environ.setdefault("APP_MODE", "dev")
