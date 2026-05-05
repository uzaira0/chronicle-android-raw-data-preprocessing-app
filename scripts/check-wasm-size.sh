#!/usr/bin/env bash
# WASM binary size guard — fails if any .wasm exceeds its ceiling.
# Ceilings are set at ~20% above current sizes to catch unintended bloat.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_DIR="$REPO_ROOT/web/src/wasm"

FAIL=0

check_wasm() {
  local path="$1"
  local ceiling_bytes="$2"
  local label="$3"

  if [ ! -f "$path" ]; then
    echo "SKIP: $label — file not found at $path"
    return 0
  fi

  local actual
  actual=$(wc -c < "$path" | tr -d ' ')
  local actual_kb=$(( actual / 1024 ))
  local ceiling_kb=$(( ceiling_bytes / 1024 ))

  if [ "$actual" -gt "$ceiling_bytes" ]; then
    echo "FAIL: $label is ${actual_kb}KB — exceeds ceiling of ${ceiling_kb}KB" >&2
    FAIL=1
  else
    echo "PASS: $label is ${actual_kb}KB / ${ceiling_kb}KB ceiling"
  fi
}

echo "=== WASM binary size check ==="

# chronicle_app_usage_wasm — core matching algorithm (small, pure Rust)
# Current: ~30KB, ceiling: 50KB
check_wasm \
  "$WASM_DIR/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm_bg.wasm" \
  51200 \
  "chronicle_app_usage_wasm"

# chronicle_chrono_kernel_wasm — date/timezone kernels
# Current: ~1.2MB, ceiling: 1.5MB
check_wasm \
  "$WASM_DIR/chronicle_chrono_kernel_wasm/pkg/chronicle_chrono_kernel_wasm_bg.wasm" \
  1572864 \
  "chronicle_chrono_kernel_wasm"

# chronicle_polars_kernels_wasm — Polars-based data kernels (largest)
# Current: ~9.1MB, ceiling: 11MB
check_wasm \
  "$WASM_DIR/chronicle_polars_kernels_wasm/pkg/chronicle_polars_kernels_wasm_bg.wasm" \
  11534336 \
  "chronicle_polars_kernels_wasm"

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "WASM size check FAILED." >&2
  echo "If this is an intentional size increase, update the ceilings in scripts/check-wasm-size.sh." >&2
  exit 1
fi

echo
echo "All WASM binaries within size ceilings."
