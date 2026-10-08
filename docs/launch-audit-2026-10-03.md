# Launch audit — 2026-10-03

Scope: the whole repository at branch `wip/literature-components-20260917`
(PR #30 on the preview repo), audited at `55533851`, fixed through `9be8d764`.
The app is a browser-only React + Rust/WASM PWA on GitHub Pages: no server,
database, accounts, payments, email or AI feature. Users load sensitive
research files (children's phone usage) that are processed and stored only in
the browser. Production (public repo) is live at `e16d4abb` (#97, 2026-08-05).

Checklists run, one agent each, report-only, then a separate fix pass:
`security-checklist`, `production-readiness-checklist`,
`legal-compliance-checklist`, `ai-built-code-checklist`,
`analysis-tooling-checklist`, and the UI lane (`web-design-guidelines`,
`redesign-skill` read by hand because the Skill tool refused it,
`design-review` with local Playwright/axe probes).

Skipped, and why: `app-store-review-checklist` and `mobile-runtime-checklist`
(no native app); `launch-discoverability-checklist` and
`short-form-marketing-formats` (a research tool, not marketed);
`selfhost-operator-checklist` (nobody installs it); `shadcn-lint` (no
Tailwind); `hallmark` and `impeccable` (no `design.md` / `PRODUCT.md`);
`humanizer` (no launch copy in scope).

The full per-item ledgers, with evidence, are in
[`launch-audit-2026-10-03/`](launch-audit-2026-10-03/). They record the state
at `55533851`, before the fixes below.

## 1. Verdict

**Deployed to production on 2026-10-07** (public `main` 96375c5d, tag
`deployed-2026-10-07`). Every code-level blocker the audit found is fixed and
verified. The two legal items in section 2 were settled by the owner: the labs
gave permission for the codebook, and the owner chose to publish the EYES and
Culverhouse ports while the Van Gaeveren port stays off public.

## 2. Legal items and how they were settled

| IDs | What | Why it blocks |
|---|---|---|
| legal I4b/L4 | Code ported from repos with no licence: `eyes-toolbox` (EYES complement, `eyes_complement.rs`), `joshculverhouse/chronicle-preprocessed-cleaning` and `chronicle-android-preprocessing` (Culverhouse logic, `model.rs`), the OSF Van Gaeveren notebook (`checkpoint.rs`). | Owner decision 2026-10-07: EYES and Culverhouse are published (public #110); the Van Gaeveren rule is removed from public and kept on preview only. |
| legal I4d/L6 | `unified_app_codebook.csv` merges coding from Baby EMU, BYU, UMich, BCM and USC plus scraped Play Store data. | Resolved 2026-10-07: the owner reports that the labs gave permission to publish their coding. The older codebook files in public history are covered by the same permission and stay. |

## 3. Fixed in this pass

Every fix below has a test that fails without it. Branches were merged into
`wip/literature-components-20260917`; the final `make check` ran on the merge.

**Data safety and honesty (app code)**
- Delete results left the participant's data in browser storage (security K3,
  HIGH). It now removes the run's OPFS workspace, the IndexedDB record and
  worker spill files, and reports success only after they are gone. An e2e
  scans OPFS bytes for the participant ID afterwards.
- The crash screen wiped everything in one click (prod U1). Now "Reload
  without clearing" comes first, and clearing asks with an exact list. The
  same wipe is in the footer as "Delete all local data…".
- Success shown for writes that failed (ai S1/S3, prod X4): saving the last
  run, presets, settings, config import, "Reprocessed X". Success now follows
  the awaited write; failures say so.
- Importing any JSON (`[]`, `{}`) reset settings and deleted every preset (ai
  S2/Q3). Non-export files are refused; preset names are de-duplicated.
- No input size bound (ai B2, prod R4): files above 180 MB are refused before
  reading (derivation in `web/src/lib/inputLimits.ts`).
- Destructive actions ran without confirmation (UI WDG-25/RD-U15/DR-16):
  `ConfirmDialog` with focus on Cancel, trapped Tab (including Safari's
  default Tab behaviour), Escape, and focus returned to the opener.
- Accessibility: help popovers stay open on hover and close on Escape (WCAG
  1.4.13); error toasts are `role="alert"` and stay until dismissed; the toast
  timer no longer restarts on every render and the toast moved off the download
  column; per-day rows have a real button; inputs have visible labels;
  24 px targets for download links, summaries and day buttons; footer links
  underlined (dark-mode axe link-in-text-block).
- View tab said "no timeline" after a successful run (UI DR-15): it now says
  the interactive timeline was off for that run and offers the setting.
- Privacy and terms in the app (legal P1/P2/P4/P5/A1/L3/TM1): footer notice —
  processing is local, GitHub Pages sees visitor IPs, what is stored and how to
  delete it, research use only / no warranty, GPL-3.0 notice, source and
  licence links, non-affiliation with Methodic, third-party notices.
- Safari private browsing was refused outright (WebKit's repeated
  `UnknownError`); it now runs in the existing ephemeral mode with its banner.
- The service worker read and deleted every cache on the shared
  `uzaira0.github.io` origin (security X2): caches are named after the app's
  scope, lookups pass `cacheName`, and only this app's old caches are removed.
- Narrow screens scrolled sideways (UI DR-01/DR-02).

**Engine (Rust; full evidence chain re-run)**
- Spreadsheet formula injection (security X3) — owner decision: an opt-in
  `neutralize_spreadsheet_formulas` setting, off by default so default output
  is byte-identical; when on, text cells starting with `= + - @ TAB CR` get a
  leading `'`. Literature downloads are digest-bound and stay verbatim.
- `csv_escape_value` did not quote a bare CR (security X4).
- Unknown option values silently became the default (ai C3/K2); they are now
  refused, with a table test over all 27 enum axes.
- Rust defaults were a second copy of the contract (ai C7); a test now checks
  every default against `contract-baseline.json` and found two real
  mismatches, fixed (`proximity_interval_ns`, `enable_activity_heatmap`).
- Yanked `chacha20 0.10.1` updated; unused `proptest` removed (analysis S5).

**Tests, docs, CI**
- The full Playwright suite had 51 chromium / 61 firefox failures that no gate
  ran (gates run `@smoke` only). Root causes fixed: 40 stale method-profile
  button expectations, a false export-refusal message after slot fallback,
  the narrow-screen overflow, stale matrix cases, timing waits, a reload race.
  Result: full chromium 957 passed, 0 failed; firefox/webkit/webkit-durable
  0 failed on every touched spec.
- Deploy docs described a deploy that does not exist (prod O7, ai C4/C5):
  `docs/web-deployment.md` rewritten with a rollback runbook; the live-build
  claim corrected; `CITATION.cff`, `.zenodo.json`, CHANGELOG corrected;
  `MANIFEST.in` and the stray Python `__init__.py` removed.
- Third-party notices now ship in the build (`THIRD-PARTY-NOTICES.txt`, npm
  and Rust crates incl. Apache NOTICE files) (legal L1/L5, analysis S10).
- GitHub Actions pinned to commit SHAs; Dependabot cooldown (security I4).
- The preview canary tested the wrong site and failed 100/100 runs (prod
  O3/R3); each repo's canary now tests its own Pages site.
- PR scanners fixed: gitleaks pinned to the version that reads the repo's
  allowlists; CodeQL and osv no longer fail on SARIF upload in the private
  repo; 18 npm advisories cleared.
- `referrer` meta added; private corpus ignored in `.gitignore`; the
  unique-input benchmark harness reads the right registry key.

## 4. Owner to-do

1. **Linux screenshot baselines** — on node-z run
   `scripts/run-visual-regression.sh --update-snapshots` (intended changes:
   footer height and its diagnostic-report button, 24 px download rows, Files
   fixture, the first-paint skeleton). Recording them in Docker on macOS does
   not work: even on the commit node-z last recorded, Docker's rendering
   differs by 2–4%.

Done since the first pass: branch protection on both repos (required checks
CodeQL, gitleaks and osv-scanner; PR required; admins included; linear
history; public after its dependency PR #109 made osv pass), the public
`main` history rewrite (AI co-author lines removed, protection restored
identical) and the unique-input benchmark (it now drives the app's own
runtime calls on the sequential engine; `docs/perf/BASELINE.md`).

## 5. Still open after this pass

Listed so none of them is mistaken for done:

- Storage is still shared with the preview site on the same origin
  (security X1/A8/K1). The owner kept the preview public; cache sharing is
  fixed, settings/IndexedDB/OPFS names are still common to both apps.
- Without the private corpus, web coverage is about 56% (most of
  `methodProfiles.ts` is exercised only by corpus-backed tests). The pre-push
  coverage hook therefore stops on a machine that lacks the corpus, and says
  that is why.
- Settled after the audit, ai K6/K7. K6 (naive output timestamps) is not a
  bug: the raw export carries a timezone column, the raw times are UTC, and
  the app converts them to that local zone, so local wall-clock output is the
  intended result. K7 (option names with no unit) is fixed where people read
  it: all four settings now name their unit in the label, the last one being
  "Custom app engagement duration (seconds)". The internal option keys keep
  their names, so saved settings and the research-pipeline consumer are
  unchanged.

### Fixed in the follow-up pass (batch 2)

- Diagnostics (prod O1): uncaught errors are recorded locally and the footer
  copies a redacted report (file names, participant IDs, quoted values removed).
- First load (prod U2/F2/F3/F9, analysis D15): the method-profile registries,
  result/review panels and literature panel load after first paint behind a
  skeleton; the entry chunk fell from 1,350,924 to about 490,000 bytes.
  Lighthouse mobile (simulated, median of 3): performance 0.70 → 0.80, LCP
  10.4 s → 5.1 s, CLS 0.
- Cross-tab settings and preset merge; preset and project records carry a
  schema version and migrate per key (ai K4, prod M3); a saved run that cannot
  be reopened is archived, not deleted; background storage failures show as
  notices.
- Every swallowed error has a reason comment or is handled;
  `swallowedErrors.test.ts` enforces it, and an ast-grep rule warns on new
  uncommented empty catches.
- Non-null assertions (ai-built-code): the type-aware rule counted 404 in
  production web code (317 in `methodProfiles.ts`); all were replaced by
  compiler-visible narrowing or `requireDefined()` (`web/src/lib/invariant.ts`),
  and `@typescript-eslint/no-non-null-assertion` is now an error for
  `web/src/**` outside tests and `testSupport/`.
- The first-paint skeleton paints in the user's theme: `public/theme-boot.js`
  sets `data-theme` from `<head>` before anything paints (dark-mode users used
  to see a light page first).
- `window.__CHRONICLE_TEST_RUNTIME__` and the benchmark hooks are compiled out
  of deploy builds (security A10).
- Gates: semgrep `p/github-actions` + `p/rust`, shellcheck, actionlint,
  cargo-udeps, ast-grep TS safety rules, cargo-audit on the kernel crate.
- The deploy ships a checked CycloneDX `sbom.cdx.json`
  (`scripts/generate-sbom.sh`).
- The workflow contract and the source-column reach were rebuilt on every
  run; they are now built once per process (a test checks the cached contract
  is byte-identical to a fresh build). Execute 99.8 → 80.6 ms, with provenance
  evidence 213.8 → 138.8 ms, `structured_workspace` fuzz 33.5 → 16.4 ms a run.
- Tests no longer need the private literature corpus to load: corpus-backed
  unit tests and 13 Playwright specs skip where it is absent, and
  `shippedLocalPaths.test.ts` fails on any build-machine path in shipped
  files (two absolute locators in `methodProfiles.ts` were fixed).
- Literature e2e timeouts: a loopback `PLAYWRIGHT_BASE_URL` got the canary's
  30 s budget, and checks right after a reload could pass against the lazy
  card's placeholder; `reloadApp` now waits for the real card.
- The native profiler checks every timed run against the sequential oracle,
  takes `--seed` and `--iterations`, and labels each figure in-process,
  process wall or peak RSS (`docs/perf/BASELINE.md`, items 7–9).
- A `closure_evidence_journal` fuzz target covers the Rust decoder a
  workspace-archive import reaches; `structured_workspace` no longer spends
  its sanity window re-running its corpus.

## 6. Full ledgers

| Checklist | PASS | FAIL | N/A | Ledger |
|---|---|---|---|---|
| security-checklist | 25 | 11 | 57 | [security.md](launch-audit-2026-10-03/security.md) |
| production-readiness-checklist | 16 | 16 | 16 | [production-readiness.md](launch-audit-2026-10-03/production-readiness.md) |
| legal-compliance-checklist | 12 | 17 | 24 | [legal.md](launch-audit-2026-10-03/legal.md) |
| ai-built-code-checklist | 34 | 29 | 2 | [ai-built-code.md](launch-audit-2026-10-03/ai-built-code.md) |
| analysis-tooling-checklist | 7 | 13 | 9 | [analysis-tooling.md](launch-audit-2026-10-03/analysis-tooling.md) |
| UI lane (WDG / RD / DR) | 50 | 53 | 2 | [ui.md](launch-audit-2026-10-03/ui.md) |

Counts are at `55533851`, before the fixes in section 3.
