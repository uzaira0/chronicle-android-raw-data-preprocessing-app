# Quality And Security Matrix

This repository is a web (PWA) data-processing application with:

- React + Vite TypeScript front end running the whole pipeline in-browser (`web/`)
- Rust matcher crate compiled to WASM (`rust/chronicle_app_usage_matcher` + wasm wrappers)
- local-only CI via the root `Makefile` (GitHub Actions carries CD only)

The Python desktop engine and its pytest/parity suites were removed as fully
deprecated; their final validation evidence is frozen in
`docs/validation/CORPUS_SOAK.md` and `docs/perf/BASELINE.md`.

## Current Testing Surface

Implemented today (all local — see `make help`):

- `make web` — typecheck (three tsc passes), vitest unit suite (incl. golden
  byte-lock scenarios, property-based, metamorphic, covering-array, FSM model,
  fuzz suites), contract checks
- `make rust` — Rust matcher core tests, feature-free
- `make e2e` — Playwright smoke (personas incl. accessibility via axe-core)
- `make mutation` — StrykerJS mutation score, thresholds high 95 / low 90 / break 93
- `make coverage` — vitest v8 coverage with ratcheted floors
- `make gate-truth` — seeded-defect proof that every drift gate fires
- `make fuzz-sanity` — bounded native libFuzzer runs over the matcher, raw CSV
  inspection, and structure-aware full-runtime ingestion boundaries
- `make combinatorial` — PICT/ACTS covering arrays + NIST CCM measurement
- `make deploy-artifact` — production build + CSP/_headers/PWA/bundle-budget checks

## Security Tooling

Implemented in this repository (run all: `make security`):

- Semgrep SAST via `.semgrep/chronicle-security.yml`
- ast-grep structural linting via `sgconfig.yml` and `.ast-grep/rules/`
  (with `sg test` meta-tests proving each rule still catches its pinned bug shape)
- Trivy filesystem scanning (`vuln`, `misconfig`, `secret`) via `trivy.yaml`
- `cargo-audit` for Rust dependency vulnerabilities
- Gitleaks secret scanning via `.gitleaks.toml`
- Dependabot for cargo, npm, and GitHub Actions dependencies

## Local Commands

```bash
make security   # all scanners
make all        # ci + web checks + e2e smoke + deploy artifact
```
