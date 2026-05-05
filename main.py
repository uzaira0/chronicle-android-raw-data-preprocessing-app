"""
Main entry point for the Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
SRC_DIR = ROOT_DIR / "src"
sys.path.insert(0, str(SRC_DIR))

from chronicle_preprocessing_app.gui import main  # noqa: E402

if __name__ == "__main__":
    main()
