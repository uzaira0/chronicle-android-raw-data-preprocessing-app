# Local CI — runs the gates that used to run on GitHub Actions, on your machine.
#
# Replaces the deleted remote workflows:
#   .github/workflows/ci.yml        (python-tests, rust-tests, semgrep, ast-grep,
#                                    python-security [bandit + pip-audit],
#                                    cargo-audit, trivy)
#   .github/workflows/gitleaks.yml  (secret scan)
# The only workflow that still runs on GitHub is web-pwa-deploy.yml (it deploys
# to GitHub Pages and cannot run locally; it also re-runs the web checks below).
#
# Quick start:
#   make ci      # everything the deleted remote CI ran (tests + every scanner)
#   make all     # ci + web checks + cross-surface parity + browser e2e smoke
#   make help    # list every target
#
# Point PYTHON at the interpreter that has the project deps (polars, etc.):
#   make ci PYTHON=/home/opt/eyes-parity-venv/bin/python

PYTHON  ?= python
MATCHER := rust/chronicle_app_usage_matcher/Cargo.toml

.PHONY: help ci all security web \
        test rust \
        semgrep ast-grep bandit pip-audit cargo-audit trivy gitleaks \
        typecheck web-test contract parity e2e deploy-artifact

help:
	@echo 'Local CI (replaces the deleted GitHub Actions workflows):'
	@echo ''
	@echo '  make ci        tests + all security scanners  (= old ci.yml + gitleaks.yml)'
	@echo '  make all       ci + web checks + parity + e2e smoke'
	@echo '  make security  semgrep ast-grep bandit pip-audit cargo-audit trivy gitleaks'
	@echo '  make web       typecheck + unit tests + contract check'
	@echo ''
	@echo '  Individual:  test rust semgrep ast-grep bandit pip-audit cargo-audit'
	@echo '               trivy gitleaks typecheck web-test contract parity e2e'
	@echo ''
	@echo '  Override the Python interpreter:'
	@echo '    make ci PYTHON=/home/opt/eyes-parity-venv/bin/python'

# ---------- aggregates ----------
ci: test rust security

# Run each phase as its own sequential sub-make rather than as four
# prerequisites of one invocation. With prerequisites, `web`'s two
# esbuild-spawning recipes (web-test + contract) run in the same make process
# as `parity`/`e2e`, and under concurrent load make can intermittently finish
# `web` and then exit 0 WITHOUT running the goals that follow it — a silent
# false-green. Isolating each phase in its own `$(MAKE)` invocation removes that
# condition; each line is exit-checked, so a failed or skipped phase aborts
# before the final success line below. Do not collapse this back to
# `all: ci web parity e2e`.
all:
	@echo "── make all: 1/5 ci ──────────────────────────────"
	$(MAKE) --no-print-directory ci
	@echo "── make all: 2/5 web ─────────────────────────────"
	$(MAKE) --no-print-directory web
	@echo "── make all: 3/5 parity ──────────────────────────"
	$(MAKE) --no-print-directory parity
	@echo "── make all: 4/5 e2e ─────────────────────────────"
	$(MAKE) --no-print-directory e2e
	@echo "── make all: 5/5 deploy-artifact ─────────────────"
	$(MAKE) --no-print-directory deploy-artifact
	@echo "✓ make all: ci + web + parity + e2e + deploy-artifact all completed"

security: semgrep ast-grep bandit pip-audit cargo-audit trivy gitleaks

web: typecheck web-test contract

# ---------- Python tests (was: ci.yml python-tests) ----------
test:
	PYTHONPATH=src $(PYTHON) -m pytest -q

# ---------- Rust tests (was: ci.yml rust-tests) ----------
# CI built with default features (which link a Python dev library); the matcher
# core tests run feature-free locally so no libpython is required on PATH.
rust:
	cargo test --manifest-path $(MATCHER) --no-default-features

# ---------- security scanners (was: ci.yml + gitleaks.yml) ----------
semgrep:
	semgrep --config .semgrep/chronicle-security.yml --error .

ast-grep:
	sg scan

bandit:
	bandit -c bandit.yaml -r src/chronicle_preprocessing_app -ll

# Audit the project's third-party deps for known CVEs. Uses uv (the project's
# package manager) to resolve pyproject deps into an isolated env and audit it
# in environment mode — independent of $(PYTHON), and without building the local
# package's Rust extension. Requires uv on PATH.
pip-audit:
	@reqs=$$(mktemp) && \
	uv pip compile --quiet --extra dev pyproject.toml -o $$reqs && \
	uv run --no-project --with-requirements $$reqs --with pip-audit pip-audit --strict; \
	status=$$?; rm -f $$reqs; exit $$status

cargo-audit:
	cd rust/chronicle_app_usage_matcher && cargo audit

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

# ---------- cross-surface parity + browser e2e (mirror web-pwa-deploy.yml) ----------
parity:
	PYTHONPATH=src $(PYTHON) scripts/run_deterministic_web_parity.py

e2e:
	cd web && npm run test:e2e:smoke

# ---------- deploy artifact validation (CSP meta + _headers + PWA files) ----------
# Builds the production bundle, then verifies dist carries the CSP <meta> fallback,
# _headers, sw.js, manifest.webmanifest and .vite/manifest.json, and that the
# _headers CSP matches the index.html meta CSP. Owns its build (the check reads
# web/dist), restoring the validation that the deleted deploy workflow used to run.
deploy-artifact:
	cd web && npm run build && npm run check:deploy-artifact
