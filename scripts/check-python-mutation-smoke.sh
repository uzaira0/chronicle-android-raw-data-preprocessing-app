#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$ROOT_DIR/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

SCRATCH_BASE="$ROOT_DIR/.mutation-scratch"
mkdir -p "$SCRATCH_BASE"
TMP_DIR="$(mktemp -d "$SCRATCH_BASE/run.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"
git ls-files -co --exclude-standard -z | rsync -a --files-from=- --from0 ./ "$TMP_DIR"/

"$PYTHON" - <<'PY' "$TMP_DIR"
from pathlib import Path
import sys

root = Path(sys.argv[1])
target = root / "src/chronicle_preprocessing_app/core/preprocessing/timestamp_preprocessor.py"
text = target.read_text(encoding="utf-8")
original = "value = str(timestamp).strip()"
mutated = "value = str(timestamp)"
if original not in text:
    raise SystemExit(f"Expected mutation target not found in {target}")
target.write_text(text.replace(original, mutated, 1), encoding="utf-8")
PY

set +e
PYTHONPATH="$TMP_DIR/src" "$PYTHON" -m pytest "$TMP_DIR/tests/test_timestamp_properties.py" -q \
  >"$TMP_DIR/mutation.out" 2>&1
status=$?
set -e

if [ "$status" -eq 0 ]; then
  cat "$TMP_DIR/mutation.out" >&2
  echo "Timestamp whitespace mutant survived; property test did not catch the regression." >&2
  exit 1
fi

echo "Timestamp whitespace mutant killed by tests."
