#!/usr/bin/env bash
# Runs the Python↔WASM deterministic parity check.
# Requires WASM to have been built (web/src/wasm/chronicle_app_usage_wasm/pkg/).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Ensure web dependencies are installed
if [ ! -d "$REPO_ROOT/web/node_modules" ]; then
  echo "Installing web dependencies..."
  npm ci --prefix "$REPO_ROOT/web"
fi

# Require WASM to be pre-built — do not silently skip
WASM_JS="$REPO_ROOT/web/src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js"
if [ ! -f "$WASM_JS" ]; then
  echo "WASM not built. Run: cd web && npm run build:wasm" >&2
  exit 1
fi

# Detect stale WASM: fail if any Rust source is newer than the built binary
STALE=$(find "$REPO_ROOT/rust" \( -name "*.rs" -o -name "Cargo.toml" \) -newer "$WASM_JS" -not -path "*/target/*" 2>/dev/null | head -5)
if [ -n "$STALE" ]; then
  echo "WASM binary is stale — these Rust sources are newer than the built pkg:" >&2
  echo "$STALE" | sed 's|^|  |' >&2
  echo "Run: cd web && npm run build:wasm" >&2
  exit 1
fi

PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

"$PYTHON" "$REPO_ROOT/scripts/run_deterministic_web_parity.py" "$@"
