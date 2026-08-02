# Pre-migration baseline

Historical record. Both branches named here were merged and deleted; their
commits remain reachable locally by SHA. Current authority is `main@3c598ee`.

The isolated `desktop-removal@5f8e645` baseline passed the native matcher
tests (22/22), Semgrep, ast-grep, and Cargo audit. Its aggregate `make all` gate
originally stopped at `web/bun.lock` because `brace-expansion` 5.0.6 was affected
by CVE-2026-13149.

The implementation branch resolved the affected 5.x lock entry and the newly
disclosed affected 1.x entries. On `main@3c598ee` that resolution still holds
and has moved on: `web/package-lock.json` resolves a single
`brace-expansion` at 5.0.8 with no 1.x entry, and `npm ci` in `web/` reports
`found 0 vulnerabilities` over 656 audited packages. The `js-yaml 4.3.0`
resolution recorded here no longer describes the lockfile — the only remaining
`js-yaml` is a 3.15.0 transitive of the `@lhci/utils` Lighthouse dev
dependency, which `npm audit`, `trivy fs .`, and `make security` all currently
pass.

The matcher suite has grown since this baseline: `cargo test --locked
--manifest-path rust/chronicle_app_usage_matcher/Cargo.toml
--no-default-features` now reports `28 passed; 0 failed`.

Aggregate-green status is recorded only after the full gate is rerun. See the
[final review matrix](final-review-matrix.md) for what currently passes and
what does not.
