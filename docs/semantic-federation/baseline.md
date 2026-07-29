# Pre-migration baseline

The isolated `origin/desktop-removal@5f8e645` baseline passed the native matcher
tests (22/22), Semgrep, ast-grep, and Cargo audit. Its aggregate `make all` gate
originally stopped at `web/bun.lock` because `brace-expansion` 5.0.6 was affected
by CVE-2026-13149.

The implementation branch resolved the affected 5.x lock entry to 5.0.7 and
the newly disclosed affected 1.x entries to 1.1.16; `js-yaml` was also resolved
to 4.3.0. Aggregate-green status is recorded only after the full gate is rerun.
