# Local CI — runs every gate on your machine. GitHub carries CD only
# (web-pwa-deploy.yml deploys to Pages; it re-runs the web build checks).
#
# The desktop Python engine, its pytest suite, and the cross-engine parity/
# metamorphic/corpus-soak harnesses were REMOVED (fully deprecated — web is
# the single engine). Their final evidence is frozen in
# docs/validation/CORPUS_SOAK.md and docs/perf/BASELINE.md; the removal
# commit message names the last ref that still carries them. The browser remains
# the product surface; product-owned Rust/WASM is now the selected computation,
# scheduling, evidence, artifact, and semantic-view authority.
#
# Quick start:
#   make ci      # rust tests + every security scanner
#   make all     # ci + web checks + browser e2e smoke + deploy artifact
#   make help    # list every target

MATCHER := rust/chronicle_app_usage_matcher/Cargo.toml
CHRONO_KERNEL := rust/chronicle_chrono_kernel_wasm/Cargo.toml
SEMANTIC_RUNTIME := rust/chronicle_preprocessing_semantic_adapter/Cargo.toml
PRODUCT_RUNTIME := rust/chronicle_preprocessing_runtime_wasm/Cargo.toml
SEMANTIC_INDEX := rust/chronicle_semantic_index_wasm/Cargo.toml

.PHONY: help ci all security web \
        rust \
        semgrep ast-grep cargo-audit cargo-deny trivy gitleaks \
        typecheck web-test contract boundary combinatorial gate-truth \
        mutation mutation-web mutation-rust coverage coverage-rust coverage-all \
        knip profile profile-current profile-many e2e deploy-artifact dependency-evidence \
        bench-regression

help:
	@echo 'Local CI (GitHub Actions carries CD only):'
	@echo ''
	@echo '  make ci        rust tests + all security scanners'
	@echo '  make all       ci + web checks + e2e smoke + deploy artifact'
	@echo '  make security  semgrep ast-grep cargo-audit cargo-deny trivy gitleaks'
	@echo '  make web       typecheck + unit tests + contract + boundary checks'
	@echo ''
	@echo '  Individual:  rust semgrep ast-grep cargo-audit cargo-deny trivy gitleaks'
	@echo '               typecheck web-test contract boundary e2e gate-truth mutation'
	@echo '               mutation-web mutation-rust coverage coverage-rust coverage-all'
	@echo '               knip profile profile-current profile-many combinatorial deploy-artifact dependency-evidence'
	@echo '               bench-regression (criterion matcher benches vs benchmarks/baseline.json; local-only)'

# ---------- aggregates ----------
ci: rust security

# Run each phase as its own sequential sub-make rather than as prerequisites
# of one invocation. With prerequisites, `web`'s two esbuild-spawning recipes
# (web-test + contract) run in the same make process as `e2e`, and under
# concurrent load make can intermittently finish `web` and then exit 0
# WITHOUT running the goals that follow it — a silent false-green. Isolating
# each phase in its own `$(MAKE)` invocation removes that condition; each
# line is exit-checked, so a failed or skipped phase aborts before the final
# success line below. Do not collapse this back to `all: ci web e2e ...`.
all:
	@echo "── make all: 1/4 ci ──────────────────────────────"
	$(MAKE) --no-print-directory ci
	@echo "── make all: 2/4 web ─────────────────────────────"
	$(MAKE) --no-print-directory web
	@echo "── make all: 3/4 e2e ─────────────────────────────"
	$(MAKE) --no-print-directory e2e
	@echo "── make all: 4/4 deploy-artifact ─────────────────"
	$(MAKE) --no-print-directory deploy-artifact
	@echo "✓ make all: ci + web + e2e + deploy-artifact all completed"

security: semgrep ast-grep cargo-audit cargo-deny trivy gitleaks

web: typecheck web-test contract boundary

# ---------- Rust tests ----------
# The matcher core is a library dependency of the production Rust/WASM runtime;
# its tests run feature-free so no libpython is required on PATH.
rust:
	cargo test --locked --manifest-path $(MATCHER) --no-default-features
	cargo test --locked --manifest-path $(CHRONO_KERNEL) --features incremental-v2
	rustup run stable cargo check --locked --manifest-path $(CHRONO_KERNEL) --target wasm32-unknown-unknown --features incremental-v2
	cargo test --locked --manifest-path $(SEMANTIC_RUNTIME)
	rustup run stable cargo check --locked --manifest-path $(SEMANTIC_RUNTIME) --target wasm32-unknown-unknown --features wasm
	cargo test --locked --manifest-path $(PRODUCT_RUNTIME)
	rustup run stable cargo check --locked --manifest-path $(PRODUCT_RUNTIME) --target wasm32-unknown-unknown
	cargo test --locked --manifest-path $(SEMANTIC_INDEX)
	rustup run stable cargo check --locked --manifest-path $(SEMANTIC_INDEX) --target wasm32-unknown-unknown
	cargo clippy --locked --manifest-path $(CHRONO_KERNEL) --all-targets --features incremental-v2 -- -D warnings
	cargo clippy --locked --manifest-path $(SEMANTIC_RUNTIME) --all-targets -- -D warnings
	cargo clippy --locked --manifest-path $(PRODUCT_RUNTIME) --all-targets -- -D warnings
	cargo clippy --locked --manifest-path $(SEMANTIC_INDEX) --all-targets -- -D warnings

# ---------- security scanners ----------
semgrep:
	semgrep --config .semgrep/chronicle-security.yml --error .

# scan = enforce the rules; test = meta-tests proving each rule still catches
# its pinned bug shape (.ast-grep/rule-tests, snapshots committed).
ast-grep:
	sg scan
	sg test

cargo-audit:
	cd rust/chronicle_app_usage_matcher && cargo audit
	cd rust/chronicle_preprocessing_semantic_adapter && cargo audit
	cd rust/chronicle_preprocessing_runtime_wasm && cargo audit
	cd rust/chronicle_semantic_index_wasm && cargo audit

# Policy complements cargo-audit: exact source allowlists, license closure,
# and the one documented unmaintained transitive exception are checked for
# every Rust crate that carries semantic or computational authority.
cargo-deny:
	cd rust/chronicle_app_usage_matcher && cargo deny check --config ../deny.toml
	cd rust/chronicle_chrono_kernel_wasm && cargo deny check --config ../deny.toml
	cd rust/chronicle_preprocessing_semantic_adapter && cargo deny check --config ../deny.toml
	cd rust/chronicle_preprocessing_runtime_wasm && cargo deny check --config ../deny.toml
	cd rust/chronicle_semantic_index_wasm && cargo deny check --config ../deny.toml

trivy:
	trivy fs .

gitleaks:
	gitleaks git -c .gitleaks.toml .

# ---------- web checks (mirror web-pwa-deploy.yml's build-job gates) ----------
typecheck:
	cd web && npm run typecheck

web-test:
	cd web && npm run test

contract:
	cd web && npm run check:contract

# The browser's WASM-boundary validator is generated from the Rust
# serialization model (RuntimeManifest / ReviewRuntimeManifest and the types
# they embed) by the runtime crate's `boundary_model` example. This fails when
# web/src/lib/generatedRuntimeBoundary.ts no longer matches those Rust types;
# regenerate with `cd web && npm run generate:boundary`. Needs cargo, like the
# WASM build the rest of the web gate already depends on.
boundary:
	cd web && npm run check:boundary

# Combinatorial coverage: regenerates the PICT/ACTS models from the Rust-backed
# contract, executes the generated t=2/t=3 arrays through Rust/WASM, and checks
# their coverage with the built-in verifier. PICT and NIST CCM are optional
# independent generation/measurement checks.
combinatorial:
	scripts/run_combinatorial_coverage.sh

# Detector-truth: seed a defect into each generate-or-check artifact and
# assert the drift gate FIRES (restores on exit, interrupt-safe).
gate-truth:
	scripts/run_gate_truth_checks.sh

# Regenerate the six implementation-bound dependency ledgers using a temporary
# test-only runtime, then rebuild the normal fail-closed WASM package.
dependency-evidence:
	cd web && npm run refresh:dependency-evidence

# Mutation-score browser-owned transport/storage/view code and the Rust
# preprocessing authority. This is intentionally local-only and slow.
mutation: mutation-web mutation-rust

mutation-web:
	cd web && ENGINE_PBT_RUNS=10 ./node_modules/.bin/stryker run

# Every scored viable mutant must be caught. The adapter's cfg(wasm)-only
# transport facades are excluded because native cargo-mutants cannot execute
# them; their delegates are unit-tested and compiled exports are exercised E2E.
mutation-rust:
	cargo mutants --locked --manifest-path $(CHRONO_KERNEL) --features incremental-v2
	cargo mutants --locked --manifest-path $(PRODUCT_RUNTIME)
	cargo mutants --locked --manifest-path $(MATCHER) --no-default-features

# Criterion bench-regression gate for the matcher core. Wall clock carries no
# deterministic evidence authority (same policy as profile), so this stays
# OUTSIDE ci/all — run it locally when touching the matcher hot path. Fails on
# a >25% mean regression vs the committed benchmarks/baseline.json; recapture
# with scripts/check_bench_regression.py --write-baseline after a justified
# performance change.
bench-regression:
	CRITERION_HOME=$(CURDIR)/benchmarks/criterion cargo bench --locked --manifest-path $(MATCHER) --no-default-features --bench matcher_bench
	python3 scripts/check_bench_regression.py

# Measure the deployed worker -> authoritative Rust/WASM -> OPFS -> rendered
# result path. The deterministic evidence ledger intentionally carries no wall
# clock authority, so profiling stays outside the artifact closure.
profile:
	@test -n "$(CSV)" || (echo "usage: make profile CSV=/path/to/raw.csv" >&2; exit 2)
	cd web && npm run build && npm run benchmark:browser -- --raw "$(CSV)"

# Reproduce the current 55-step native timing matrix, cold-run Hyperfine
# distribution, peak RSS, flamegraph, Samply profile, and metadata-generator
# cProfile. Override PROFILE_ROWS or PROFILE_RUNS when doing a quick diagnostic.
profile-current:
	PROFILE_ROWS="$${PROFILE_ROWS:-60624}" PROFILE_RUNS="$${PROFILE_RUNS:-5}" scripts/profile_current_performance.sh

# Real browser batch test. Start `npm run preview` in web/ first. The fixture is
# duplicated under unique browser filenames without writing hundreds of copies.
profile-many:
	@test -n "$(CSV)" || (echo "usage: make profile-many CSV=/path/to/100k.csv FILES=100 WORKERS=4" >&2; exit 2)
	cd web && npm run benchmark:many-files -- http://127.0.0.1:4173/ "$${FILES:-100}" "$${WORKERS:-4}" "$${TIMEOUT_MS:-1800000}" "$(CSV)"

# Vitest v8 line/branch coverage with ratcheted floors (vitest.config.ts).
coverage:
	cd web && npm run test:coverage

# Rust stable does not yet expose stable branch instrumentation. Region coverage
# is gated alongside line/function coverage, and mutation-rust supplies the
# stronger behavioral oracle for decisions, scheduling, storage, and exports.
coverage-rust:
	cd rust/chronicle_chrono_kernel_wasm && cargo llvm-cov --features incremental-v2
	cd rust/chronicle_preprocessing_runtime_wasm && cargo llvm-cov
	cd rust/chronicle_app_usage_matcher && cargo llvm-cov --no-default-features

coverage-all: coverage coverage-rust

# Dead-export sweep (report-only; not a gate until the report is clean).
knip:
	cd web && bunx knip --no-exit-code

e2e:
	cd web && npm run test:e2e:smoke

# ---------- deploy artifact validation (CSP meta + _headers + PWA files) ----------
# Builds the production bundle, then verifies dist carries the CSP <meta> fallback,
# _headers, sw.js, manifest.webmanifest and .vite/manifest.json, and that the
# _headers CSP matches the index.html meta CSP. Owns its build (the check reads
# web/dist), restoring the validation that the deleted deploy workflow used to run.
deploy-artifact:
	cd web && npm run build && npm run check:deploy-artifact
