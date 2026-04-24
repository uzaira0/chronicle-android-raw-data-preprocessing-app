# Quality And Security Matrix

This repository is a Python desktop/data-processing application with:

- Python 3.10+ core logic
- optional PyQt6 GUI
- Polars/Numpy data pipeline
- optional PyO3 Rust acceleration crate
- GitHub Actions CI

## Current Testing Surface

Implemented today:

- `pytest` regression tests for app-usage semantics, screen-usage behavior, parallel processing, dataframe API, pathological fixtures, and Polars fast-path parity
- `cargo test` for the Rust matcher crate
- packaging/release workflow in `.github/workflows/build-exe.yml`

Recommended test catalog for this stack:

### Essential

- Unit and regression tests: `python -m pytest -q`
- Rust unit tests: `cargo test --manifest-path rust/chronicle_app_usage_matcher/Cargo.toml`
- Full-path parity tests between optimized/Python/Rust algorithm implementations
- Smoke tests for packaged entrypoints and raw-folder preprocessing
- Secret scanning and dependency audits in CI

### Recommended

- Property-based tests for timestamp ordering, duplicate timestamps, DST transitions, and app/session closure rules
- Golden-file tests for preprocessed CSV output shape on curated fixtures
- `pytest-benchmark` or `hyperfine` regression benchmarks for hot paths
- Static type checking for Python public APIs
- PyInstaller smoke validation on CI artifacts

### Advanced

- Mutation testing for the algorithm/config decision layer
- Fuzzing the Rust matcher and timestamp parsers
- Cross-implementation parity tests for a future browser/WASM runtime
- UI automation for a future web/PWA front end

## Security Tooling

Implemented in this repository:

- Semgrep SAST via `.github/workflows/ci.yml`
- Trivy filesystem scanning (`vuln`, `misconfig`, `secret`) via `trivy.yaml`
- Bandit for Python security linting
- `pip-audit` for Python dependency vulnerabilities
- `cargo-audit` for Rust dependency vulnerabilities
- Gitleaks secret scanning
- Dependabot for pip, cargo, and GitHub Actions dependencies

## Local Commands

Run the main local security checks with:

```bash
./scripts/run_security_checks.sh
```

Run the test suites with:

```bash
python3 -m pytest -q
cargo test --manifest-path rust/chronicle_app_usage_matcher/Cargo.toml
```

## Future WASM Testing

If the processing core is ported to browser-local WASM, add:

- shared fixture parity tests between native Python/Rust and WASM output
- browser worker integration tests
- large-file browser memory/performance benchmarks
- offline PWA smoke tests
