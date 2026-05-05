#!/usr/bin/env bash
# Python dead code detection via vulture.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

cd "$REPO_ROOT"

"$PYTHON" -m vulture \
  src/ \
  .vulture_whitelist.py \
  --min-confidence 80 \
  --ignore-names "current,total,level,cls"
# current/total/level: Protocol abstract method params (body is `...`, always look unused)
# cls: pydantic @field_validator classmethod param, required by decorator but not used in body
