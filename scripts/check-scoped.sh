#!/usr/bin/env bash
# PR gate (`make check`): run only the phases that the change against
# origin/main can affect. `make all` stays the pre-deploy gate (every crate,
# every scanner, Chromium + Firefox, the WASM rebuild check).
#
#   web/ change   -> web checks + Chromium smoke e2e on the committed WASM
#   rust/ change  -> Rust tests + committed WASM must equal a fresh build
#   lockfiles     -> dependency scanners
#   .github/      -> actionlint + semgrep p/github-actions
#   rust/         -> semgrep p/rust; *.rs/Cargo.* also cargo-udeps (nightly)
#   rust/*/fuzz/  -> fuzz harnesses compile + harness unit tests (not the
#                    Rust suite or WASM rebuild: no product build reads them)
#   *.sh          -> shellcheck on every tracked shell script
#   web/ TS, .ast-grep/ -> ast-grep scan + rule tests
#   always        -> gitleaks, published figures (drift is rewritten, not failed)
#
# It verifies; it never regenerates evidence. A Rust change to the pipeline
# still needs `make dependency-evidence` first — a stale certificate fails the
# Rust tests by name.
set -euo pipefail
cd "$(dirname "$0")/.."

base=${CHECK_BASE:-origin/main}
changed=$({
  git diff --name-only "$base"...HEAD
  git diff --name-only HEAD
  git ls-files --others --exclude-standard
} | sort -u)
if [[ -z "$changed" ]]; then
  echo "check: nothing changed against $base"
  exit 0
fi
has() { grep -qE "$1" <<<"$changed"; }
t0=$(date +%s); tstep=$t0; last=""
step() {
  local now; now=$(date +%s)
  [[ -n "$last" ]] && echo "   (${last}: $((now - tstep))s)"
  last=$1; tstep=$now
  [[ -n "$1" ]] && echo "── check: $1"
  return 0
}

rust_changed=0; web_changed=0
# The cargo-fuzz crates (rust/<crate>/fuzz/) are separate manifests that no
# product crate or WASM build reads, so a change confined to them gets the fuzz
# phase below, not the Rust test suite and WASM rebuild.
product_changed=$(grep -vE '^rust/[^/]+/fuzz/' <<<"$changed" || true)
grep -qE '^(rust/|web/src/wasm/|web/scripts/(build_wasm|wasm_build_flags)\.mjs$)' <<<"$product_changed" && rust_changed=1
has '^web/' && web_changed=1

step "gitleaks"
make --no-print-directory gitleaks

if has '(^|/)(Cargo\.lock|package-lock\.json|bun\.lock)$'; then
  step "dependency scanners (a lockfile changed)"
  make --no-print-directory cargo-audit cargo-deny trivy
fi

if has '^(web/package(-lock)?\.json|web/\.node-version|scripts/check-npm-lockfile\.sh)$'; then
  step "npm lockfile against the deploy runner's npm"
  scripts/check-npm-lockfile.sh
fi

# Static analysis, each tool only when files it reads changed (launch audit
# 2026-10-03, analysis S13). Editing a gate's own script or config re-runs it.
packs=()
has '^\.github/' && packs+=(github-actions)
has '^rust/' && packs+=(rust)
has '^(\.semgrep/registry-pack-ignores\.json|scripts/check-semgrep-packs\.sh)$' && packs=(github-actions rust)
if (( ${#packs[@]} )); then
  step "semgrep registry packs: ${packs[*]}"
  scripts/check-semgrep-packs.sh "${packs[@]}"
fi
if has '^\.github/'; then
  step "actionlint (a workflow changed)"
  make --no-print-directory actionlint
fi
if has '\.sh$'; then
  step "shellcheck (a shell script changed)"
  make --no-print-directory shellcheck
fi
if has '^(\.ast-grep/|sgconfig\.yml$|web/src/|web/scripts/|web/e2e/)'; then
  step "ast-grep rules + rule tests"
  sg scan --report-style short
  sg test
fi
if has '^(rust/.*(Cargo\.toml|Cargo\.lock|\.rs)$|scripts/check-udeps\.sh$)'; then
  step "unused Cargo dependencies (cargo-udeps, nightly)"
  make --no-print-directory udeps
fi
# Fuzz harnesses: every target compiles, and the harness unit tests (which pin
# that generated inputs get past request admission) pass. The libFuzzer runs
# themselves stay in `make fuzz-sanity`.
# A product Rust change runs it too: the harnesses depend on the product crates
# by path, so an API change or a new required option key breaks them, and
# nothing else in make check / make all compiles them.
if has '^rust/[^/]+/fuzz/' || (( rust_changed )); then
  step "fuzz harnesses compile + harness tests (Rust changed)"
  for manifest in rust/*/fuzz/Cargo.toml; do
    rustup run nightly cargo check --locked --quiet --manifest-path "$manifest" --bins
    if [[ -f "$(dirname "$manifest")/src/lib.rs" ]]; then
      rustup run nightly cargo test --locked --quiet --manifest-path "$manifest" --lib
    fi
  done
fi

if (( rust_changed )); then
  step "rust tests"
  make --no-print-directory rust
  step "committed WASM equals a fresh build"
  make --no-print-directory wasm-fresh
fi

# Rewritten before `make web`, whose published-figures check is strict.
step "committed figures (drift rewritten)"
python3 scripts/check_published_figures.py --group committed --fix

if (( rust_changed || web_changed )); then
  # Independent sub-checks run side by side, each its own make process with its
  # own log and exit code, so a failure cannot be swallowed (the false-green the
  # Makefile's `all` comment describes came from one shared make invocation).
  step "web checks (parallel)"
  logs="$PWD/.check-web"; rm -rf "$logs"; mkdir "$logs"
  declare -A pids
  for target in $(make -s print-web-targets); do
    ( s=$(date +%s); rc=0; make --no-print-directory "$target" > "$logs/$target.log" 2>&1 || rc=$?
      echo "   web: $target exit=$rc $(( $(date +%s) - s ))s"; exit $rc ) &
    pids[$target]=$!
  done
  failed=()
  for target in "${!pids[@]}"; do wait "${pids[$target]}" || failed+=("$target"); done
  for target in "${failed[@]}"; do echo "── FAILED web: $target"; tail -40 "$logs/$target.log"; done
  (( ${#failed[@]} == 0 )) || exit 1
  rm -rf "$logs"
  step "app build (once, committed WASM, no second typecheck)"
  (cd web && npm run build:vite)
  scripts/generate-sbom.sh
  step "deploy figures (drift rewritten) + deploy artifact"
  python3 scripts/check_published_figures.py --group deploy --fix
  (cd web && npm run check:deploy-artifact)
  step "smoke e2e (chromium, serving that build)"
  PLAYWRIGHT_PREBUILT=1 make --no-print-directory e2e E2E_ARGS=--project=chromium
fi
step ""

git diff --quiet -- docs || echo "check: published figures were rewritten — commit them with the change"
echo "✓ check: passed in $(( $(date +%s) - t0 ))s ($(wc -l <<<"$changed") changed files against $base)"
