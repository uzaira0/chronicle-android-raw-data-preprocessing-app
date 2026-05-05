#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON="${PYTHON:-$ROOT_DIR/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

"$PYTHON" -m pytest tests -q \
  --ignore=tests/benchmarks \
  --cov=chronicle_preprocessing_app.core.config \
  --cov=chronicle_preprocessing_app.core.dataframe_provider \
  --cov=chronicle_preprocessing_app.core.preprocessing.app_filter_preprocessor \
  --cov=chronicle_preprocessing_app.core.preprocessing.column_preprocessor \
  --cov=chronicle_preprocessing_app.core.preprocessing.screen_usage_preprocessor \
  --cov=chronicle_preprocessing_app.core.preprocessing.study_date_provider \
  --cov=chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor \
  --cov=chronicle_preprocessing_app.core.preprocessing.timezone_preprocessor \
  --cov=chronicle_preprocessing_app.utils.file_utils \
  --cov-report=term-missing \
  --cov-fail-under=90
