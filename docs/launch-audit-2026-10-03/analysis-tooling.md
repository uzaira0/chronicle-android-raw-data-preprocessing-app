# analysis-tooling-checklist — 0ef0e870 (7 PASS, 13 FAIL, 9 N/A)
Raw logs with real commands + exit codes: <scratch>/launch-audit/logs/

PASS: S4 linters (eslint 0, actionlint 0, checkov 116/0, clippy -D warnings clean x5); S6 gitleaks --all 587 commits clean; S7 osv (10 lockfiles), npm audit, cargo-audit, cargo-deny clean; D3 92/92 adversarial e2e; D9 workspace-recovery restore drill + 170/170 vitest; D12 storage-pressure/capability-gate/offline e2e; D14 axe + persona-accessibility e2e.
N/A: S8 S11 S12 D2 D4 D5 D8 D13 D16 (no images/server/API/DB/accounts/i18n/native).

| ID | item | FAIL evidence | fix |
|---|---|---|---|
| D11 | kill-mid-write | durability-fault-injection.spec.ts:244 fails chromium+firefox (export download timeout) | fix slot-fallback export |
| D1 | e2e | full chromium 51 failed/889 passed | fixer agent; require 0 failed both browsers |
| D15 | real-browser perf | lighthouse perf 0.59, LCP 10.2s, warn-only, desktop only | mobile preset + LCP error budget |
| S1 | semgrep packs | 13 mutable action tags (web-pwa-deploy.yml:33,36,39,76,92), 2 dependabot cooldown; 18 prod JSON.parse casts on OPFS/WASM bytes | pin SHAs, cooldown, guard casts, gate packs |
| D7 | fuzzing | structured_workspace 39 execs/10s; no fuzz for archive import (rustPipelineRuntime.ts:3025) or settings/method-profile import | add targets |
| D6 | headers | Pages: no nosniff/frame-ancestors/Referrer-Policy; CSP meta only | referrer meta, frame-buster |
| S10 | license notices | dist ships no notices; check-licenses.sh covers matcher only | generate notices |
| S13 | gate coverage | semgrep packs, cargo-udeps, TS ast-grep not gated | add to check-scoped.sh |
| S2 | ast-grep | 38 empty catch{} in prod, no rule; 43 unchecked-index warnings in prod | TS rules + triage |
| D10 | rollback | no newer-schema-in-older-build test (settingsPersistence.ts:454) | add test |
| S3 | strict types | 402 non-null assertions in prod | ratchet no-non-null-assertion |
| S9 | SBOM | none generated in deploy | syft step |
| S5 | dead deps | proptest unused dev-dep chronicle_preprocessing_semantic_adapter/Cargo.toml:38 | remove |
Also: chacha20 0.10.1 yanked (chronicle_semantic_index_wasm/Cargo.lock:29); Makefile cargo-audit omits chronicle_chrono_kernel_wasm; shellcheck/actionlint ungated.
