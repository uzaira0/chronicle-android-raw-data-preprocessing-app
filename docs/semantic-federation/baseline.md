# Pre-migration baseline

The isolated `origin/desktop-removal@5f8e645` baseline passed the native matcher
tests (22/22), Semgrep, ast-grep, Cargo audit, and the clean `package-lock.json`
Trivy scan. The aggregate `make all` gate stopped at the independently scanned
`web/bun.lock`: `brace-expansion` 5.0.6 is affected by CVE-2026-13149 and must be
updated to 5.0.7 or later before a green baseline can be claimed.

This is a pre-existing lockfile finding, not a semantic-federation regression.
No baseline result is represented as fully green until that dependency gate is
re-run successfully.
