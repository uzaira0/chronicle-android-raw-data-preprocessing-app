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

# Put rustup's shims ahead of whatever rustc is first on the interactive PATH.
# Homebrew installs a real rustc at /opt/homebrew/bin/rustc — same version, but
# its sysroot carries no wasm32-unknown-unknown. It is not a rustup shim, so it
# ignores rust-toolchain.toml. Native `cargo test` passes on it and only the
# WASM build fails, with "wasm32-unknown-unknown target not found in sysroot",
# which is why this stayed hidden until `make dependency-evidence` ran.
ifneq ($(wildcard $(HOME)/.cargo/bin/cargo),)
export PATH := $(HOME)/.cargo/bin:$(PATH)
endif

MATCHER := rust/chronicle_app_usage_matcher/Cargo.toml
CHRONO_KERNEL := rust/chronicle_chrono_kernel_wasm/Cargo.toml
SEMANTIC_RUNTIME := rust/chronicle_preprocessing_semantic_adapter/Cargo.toml
PRODUCT_RUNTIME := rust/chronicle_preprocessing_runtime_wasm/Cargo.toml
SEMANTIC_INDEX := rust/chronicle_semantic_index_wasm/Cargo.toml
LOCAL_SEM_PROF_BIN := $(HOME)/semantic-profile-toolchain/target/debug/semprof
SEM_PROF_BIN ?= $(if $(wildcard $(LOCAL_SEM_PROF_BIN)),$(LOCAL_SEM_PROF_BIN),semprof)

.PHONY: help check upgrade-check pin-figures wasm-fresh ci all security web \
        rust \
        semgrep semgrep-packs ast-grep cargo-audit cargo-deny trivy gitleaks \
        shellcheck actionlint udeps \
        typecheck web-test contract boundary authority-boundary axis-completeness \
        semantic-federation published-figures b03-b05-proof \
        print-sem-prof-bin \
        combinatorial gate-truth \
        mutation mutation-web mutation-rust coverage coverage-rust coverage-all \
        knip profile profile-current profile-many e2e deploy-artifact dependency-evidence \
        bench-regression fuzz-sanity

help:
	@echo 'Local CI (GitHub Actions carries CD only):'
	@echo ''
	@echo '  make check     PR gate: only the phases the diff vs origin/main touches'
	@echo '  make all       pre-deploy gate: ci + web + e2e (all browsers) + deploy artifact'
	@echo '  make ci        rust tests + all security scanners + unused Cargo dependencies'
	@echo '  make pin-figures  rewrite drifted published figures from their producers'
	@echo '  make security  semgrep semgrep-packs ast-grep shellcheck actionlint'
	@echo '                 cargo-audit cargo-deny trivy gitleaks'
	@echo '  make web       typecheck + unit tests + contract + boundary checks'
	@echo ''
	@echo '  Individual:  rust semgrep semgrep-packs ast-grep shellcheck actionlint udeps'
	@echo '               cargo-audit cargo-deny trivy gitleaks'
	@echo '               typecheck web-test contract boundary e2e gate-truth mutation'
	@echo '               mutation-web mutation-rust coverage coverage-rust coverage-all'
	@echo '               published-figures (documents vs their producing artifacts) b03-b05-proof'
	@echo '               authority-boundary (no parallel TS/test-support semantic authority)'
	@echo '               axis-completeness (an implemented delivery axis must reach contract + kernel)'
	@echo '               knip profile profile-current profile-many combinatorial deploy-artifact dependency-evidence'
	@echo '               bench-regression (criterion matcher benches vs benchmarks/baseline.json; local-only)'
	@echo '               fuzz-sanity (bounded matcher, runtime ingestion + archive-journal cargo-fuzz targets; local-only)'

# ---------- aggregates ----------
ci: rust security udeps

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
	$(MAKE) --no-print-directory upgrade-check
	$(MAKE) --no-print-directory wasm-fresh
	@echo "✓ make all: ci + web + e2e + deploy-artifact all completed"

# What users do on a deploy: process every option case on the live production
# build, then on this checkout's web/dist in the same browser storage. Any file
# the new build refuses over a saved run fails the gate (2026-10-09 outage).
upgrade-check:
	cd web && npm exec -- node scripts/run-clean-env.mjs vite-node scripts/check_upgrade_from_live.mts

# Change-scoped PR gate. `make all` stays the pre-deploy gate.
check:
	scripts/check-scoped.sh

# Rewrite drifted published figures (sizes, counts) from their producers.
# Needs web/dist, so it builds the app from the committed WASM first.
pin-figures:
	cd web && npm run build:app
	scripts/generate-sbom.sh
	python3 scripts/check_published_figures.py --group all --fix

# The committed WASM packages must be exactly what the Rust sources build.
# Builds are path-independent (PR #36), so any drift is a stale commit.
wasm-fresh:
	cd web && npm run build:wasm
	git diff --exit-code --stat -- web/src/wasm web/third-party/rust-wasm-crates.txt

security: semgrep semgrep-packs ast-grep shellcheck actionlint cargo-audit cargo-deny trivy gitleaks

WEB_TARGETS := typecheck web-test contract boundary authority-boundary axis-completeness semantic-federation published-figures b03-b05-proof
web: $(WEB_TARGETS)

print-web-targets:
	@echo $(WEB_TARGETS)

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
	# The semantic index links the kernel without incremental-v2; lint that build too.
	cargo clippy --locked --manifest-path $(CHRONO_KERNEL) --all-targets -- -D warnings
	cargo clippy --locked --manifest-path $(SEMANTIC_RUNTIME) --all-targets -- -D warnings
	cargo clippy --locked --manifest-path $(PRODUCT_RUNTIME) --all-targets -- -D warnings
	cargo clippy --locked --manifest-path $(SEMANTIC_INDEX) --all-targets -- -D warnings

# ---------- security scanners ----------
semgrep:
	semgrep --config .semgrep/chronicle-security.yml --error .

# Semgrep registry packs p/github-actions (.github/) and p/rust (rust/), with
# the accepted findings and their reasons in .semgrep/registry-pack-ignores.json.
# Fetches the packs from the registry, so it needs network access.
semgrep-packs:
	scripts/check-semgrep-packs.sh

# Every shell script git knows or would add (tracked + untracked, not ignored):
# scripts/, .semantic-federation/scripts/, test oracles.
shellcheck:
	git ls-files -z --cached --others --exclude-standard '*.sh' | xargs -0 shellcheck

# Workflow syntax and expressions, and (through shellcheck) their run: blocks.
actionlint:
	actionlint

# Unused Cargo dependencies in the five product crates (nightly cargo-udeps).
udeps:
	scripts/check-udeps.sh

# scan = enforce the rules; test = meta-tests proving each rule still catches
# its pinned bug shape (.ast-grep/rule-tests, snapshots committed).
ast-grep:
	sg scan
	sg test

cargo-audit:
	cd rust/chronicle_app_usage_matcher && cargo audit
	cd rust/chronicle_chrono_kernel_wasm && cargo audit
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

# The browser's WASM-boundary validator is generated from the Rust
# serialization model (RuntimeManifest / ReviewRuntimeManifest and the types
# they embed) by the runtime crate's `boundary_model` example. This fails when
# web/src/lib/generatedRuntimeBoundary.ts no longer matches those Rust types;
# regenerate with `cd web && npm run generate:boundary`. Needs cargo, like the
# WASM build the rest of the web gate already depends on.
boundary:
	cd web && npm run check:boundary

semantic-federation:
	$(MAKE) -C .semantic-federation check SEM_PROF_BIN=$(SEM_PROF_BIN)

# `semprof` is not on PATH; only this Makefile knows where it is. Anything that
# tells a reader to run a `.semantic-federation` target by hand must forward the
# binary, so expose the resolved path rather than making each caller guess.
# check-artifacts-in-sync.py prints a command that uses this target.
print-sem-prof-bin:
	@echo $(SEM_PROF_BIN)

# Every number copied out of a generated artifact into a document is a claim.
# This re-reads each registered figure's producing artifact and fails on
# disagreement. Register a figure whenever prose quotes a generated number;
# an unregistered figure is an unverified claim (see scripts/check_published_figures.py).
#
# Only the `committed` group runs here, because `make web` runs before anything
# builds web/dist. The `deploy` group is checked by `deploy-artifact`, after the
# build that produces its artifacts.
published-figures:
	python3 scripts/check_published_figures.py --group committed

# Recompute the B03-B05 synthetic engineering proof in memory against the
# checked-in authoritative runtime and require byte-identical committed JSON
# and Markdown reports. Report generation is an explicit post-reseal action;
# this gate never writes or silently accepts a stale runtime identity.
b03-b05-proof:
	cd web && npm run check:b03-b05-proof-report

# Process control 1 — the unpoliced zone. check_no_typescript_authority.mts skips
# web/src/testSupport/ when it hunts for reintroduced TypeScript authority, and that
# is precisely where 5,273 lines of parallel B06 semantic authority accumulated with
# no gate reading them. The same script now also caps test-support module size and
# option/branch-semantics density; this target runs it on its own so the failure is
# attributable rather than buried in the contract chain.
authority-boundary:
	cd web && npm run check:authority-boundary

# Process control 2 — definition of done per axis. An axis whose ledger entry claims
# an implemented status, and which has a docs/paper/b{NN}-*.md, must have its option
# key in the LinkML contract AND read by pipeline_v2.rs. Documents and tests alone
# cannot mark an axis done. Pending and conditional-refusal axes are not gated.
axis-completeness:
	cd web && npm run check:axis-completeness

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
# SEM_PROF_BIN must be forwarded here the same way `semantic-federation` does it.
# Without it, refresh_dependency_evidence.mjs falls back to a bare `semprof` on
# PATH, which is not installed, and the target dies with spawn ENOENT after
# already having rebuilt the evidence WASM.
# Footprint selection: campaigns whose recorded executed-file footprint proves
# nothing they ran changed are inherited instead of re-run (see
# docs/architecture/authority-and-invalidation.md). FULL=1 forces a complete
# re-measure of every campaign.
dependency-evidence:
	cd web && SEM_PROF_BIN=$(SEM_PROF_BIN) FULL=$(FULL) npm run refresh:dependency-evidence

# Mutation-score browser-owned transport/storage/view code and the Rust
# preprocessing authority. This is intentionally local-only and slow.
mutation: mutation-web mutation-rust

mutation-web:
	cd web && ENGINE_PBT_RUNS=10 ./node_modules/.bin/stryker run

# Every scored viable mutant must be caught. The adapter's cfg(wasm)-only
# transport facades are excluded because native cargo-mutants cannot execute
# them; their delegates are unit-tested and compiled exports are exercised E2E.
mutation-rust:
	$(MAKE) -C .semantic-federation quality-rust-mutation

# Criterion bench-regression gate for the matcher core. Wall clock carries no
# deterministic evidence authority (same policy as profile), so this stays
# OUTSIDE ci/all — run it locally when touching the matcher hot path. Fails on
# a >25% mean regression vs the committed benchmarks/baseline.json; recapture
# with scripts/check_bench_regression.py --write-baseline after a justified
# performance change.
bench-regression:
	CRITERION_HOME=$(CURDIR)/benchmarks/criterion cargo bench --locked --manifest-path $(MATCHER) --no-default-features --bench matcher_bench
	python3 scripts/check_bench_regression.py

# Bounded libFuzzer runs (FUZZ_SECONDS each, default 10) over the matcher core,
# raw CSV inspection, structure-aware ExecuteWorkspace ingestion, and the
# evidence-journal CBOR decoder a workspace-archive import reaches. Needs the
# nightly toolchain and cargo-fuzz; stays outside ci/all like bench-regression.
fuzz-sanity:
	scripts/run-fuzz-sanity.sh

# Measure the deployed worker -> authoritative Rust/WASM -> OPFS -> rendered
# result path. The deterministic evidence ledger intentionally carries no wall
# clock authority, so profiling stays outside the artifact closure.
profile:
	@test -n "$(CSV)" || (echo "usage: make profile CSV=/path/to/raw.csv" >&2; exit 2)
	cd web && npm run build && npm run benchmark:browser -- --raw "$(CSV)"

# Reproduce the current query-registry native timing matrix, cold-run Hyperfine
# distribution, peak RSS, Samply profile, and metadata-generator
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
	$(MAKE) -C .semantic-federation quality-rust-coverage

coverage-all: coverage coverage-rust

# Dead-export sweep (report-only; not a gate until the report is clean).
knip:
	cd web && bunx knip --no-exit-code

# Forward optional Playwright selectors without duplicating the smoke command,
# for example: make e2e E2E_ARGS='--project=chromium --project=firefox'.
e2e:
	cd web && npm run test:e2e:smoke $(if $(E2E_ARGS),-- $(E2E_ARGS))

# ---------- deploy artifact validation (CSP meta + _headers + PWA files) ----------
# Builds the production bundle and its CycloneDX SBOM (dist/sbom.cdx.json, syft),
# then verifies dist carries the CSP <meta> fallback, _headers, sw.js,
# manifest.webmanifest, .vite/manifest.json and an SBOM that covers every package
# THIRD-PARTY-NOTICES.txt says ships, and that the _headers CSP matches the
# index.html meta CSP. Owns its build (the check reads web/dist), restoring the
# validation that the deleted deploy workflow used to run.
deploy-artifact:
	cd web && npm run build:app
	scripts/generate-sbom.sh
	cd web && npm run check:deploy-artifact
	python3 scripts/check_published_figures.py --group deploy
