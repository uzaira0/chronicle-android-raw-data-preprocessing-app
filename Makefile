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
SEM_PROF_BIN ?= semprof

.PHONY: help ci all security web \
        rust \
        semgrep ast-grep cargo-audit cargo-deny trivy gitleaks \
        typecheck web-test contract semantic-federation combinatorial gate-truth \
        mutation mutation-web mutation-rust coverage coverage-rust coverage-all \
        knip profile e2e deploy-artifact

help:
	@echo 'Local CI (GitHub Actions carries CD only):'
	@echo ''
	@echo '  make ci        rust tests + all security scanners'
	@echo '  make all       ci + web checks + e2e smoke + deploy artifact'
	@echo '  make security  semgrep ast-grep cargo-audit cargo-deny trivy gitleaks'
	@echo '  make web       typecheck + unit tests + contract check'
	@echo ''
	@echo '  Individual:  rust semgrep ast-grep cargo-audit cargo-deny trivy gitleaks'
	@echo '               typecheck web-test contract e2e gate-truth mutation'
	@echo '               mutation-web mutation-rust coverage coverage-rust coverage-all'
	@echo '               knip profile combinatorial deploy-artifact'

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

web: typecheck web-test contract semantic-federation

# ---------- Rust tests ----------
# The matcher core is a library dependency of the web WASM crates
# (chronicle_app_usage_wasm, chronicle_chrono_kernel_wasm); its tests run
# feature-free so no libpython is required on PATH.
rust:
	cargo test --manifest-path $(MATCHER) --no-default-features
	cargo test --manifest-path $(CHRONO_KERNEL)
	rustup run stable cargo check --manifest-path $(CHRONO_KERNEL) --target wasm32-unknown-unknown
	cargo test --manifest-path $(SEMANTIC_RUNTIME)
	rustup run stable cargo check --manifest-path $(SEMANTIC_RUNTIME) --target wasm32-unknown-unknown --features wasm
	cargo test --manifest-path $(PRODUCT_RUNTIME)
	rustup run stable cargo check --manifest-path $(PRODUCT_RUNTIME) --target wasm32-unknown-unknown
	cargo test --manifest-path $(SEMANTIC_INDEX)
	rustup run stable cargo check --manifest-path $(SEMANTIC_INDEX) --target wasm32-unknown-unknown
	cargo clippy --manifest-path $(CHRONO_KERNEL) --all-targets -- -D warnings
	cargo clippy --manifest-path $(SEMANTIC_RUNTIME) --all-targets -- -D warnings
	cargo clippy --manifest-path $(PRODUCT_RUNTIME) --all-targets -- -D warnings
	cargo clippy --manifest-path $(SEMANTIC_INDEX) --all-targets -- -D warnings

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
	$(MAKE) -C .semantic-federation quality-rust-supply-chain

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

semantic-federation:
	$(MAKE) -C .semantic-federation check SEM_PROF_BIN=$(SEM_PROF_BIN)

# Combinatorial coverage: regenerates the PICT/ACTS models from the contract
# SSOT, generates t=2/t=3 covering arrays (executed by
# coveringArrayValidation.test.ts), and measures test-suite coverage with
# an exact built-in verifier. PICT regenerates arrays and NIST CCM cross-checks
# the measurement when available; neither is a workstation-specific prerequisite.
combinatorial:
	scripts/run_combinatorial_coverage.sh

# Detector-truth: seed a defect into each generate-or-check artifact and
# assert the drift gate FIRES (restores on exit, interrupt-safe).
gate-truth:
	scripts/run_gate_truth_checks.sh

# Mutation-score both the TypeScript oracle/UI boundary and the production Rust
# authority. This is intentionally local-only and slow; run before release.
mutation: mutation-web mutation-rust

mutation-web:
	cd web && ENGINE_PBT_RUNS=10 ./node_modules/.bin/stryker run

# Every scored viable mutant must be caught. The adapter's cfg(wasm)-only
# transport facades are excluded because native cargo-mutants cannot execute
# them; their delegates are unit-tested and compiled exports are exercised E2E.
mutation-rust:
	$(MAKE) -C .semantic-federation quality-rust-mutation

# Per-step performance table straight from the ExecutionLedger (the ledger is
# the profiler). Point it at one or more raw Chronicle CSVs.
profile:
	cd web && bunx vite-node scripts/profile_steps.mts $(CSV)

# Vitest v8 line/branch coverage with ratcheted floors (vitest.config.ts).
coverage:
	cd web && npm run test:coverage

# Rust stable does not yet expose stable branch instrumentation. Region coverage
# is gated alongside line/function coverage, and mutation-rust supplies the
# stronger behavioral oracle for decisions, scheduling, storage, and exports.
coverage-rust:
	$(MAKE) -C .semantic-federation quality-rust-coverage

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
