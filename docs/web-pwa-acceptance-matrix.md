# Web PWA Acceptance Matrix

This document defines the concrete acceptance checks for the local-first
browser port. The goal is not "looks like a PWA" but "the privacy and
offline claims are technically true and regression-tested."

## Outcome

The Chronicle browser port must behave as a local-first PWA:

- the app shell, worker, WASM, and bundled defaults remain usable offline
  after first load
- user data processing stays local to the browser
- the static web app does not depend on external runtime services
- desktop and browser outputs remain parity-checked
- contract drift between schema, OpenAPI, and runtime options is detected

## Required Acceptance Checks

### Build and Packaging

- `cd web && npm run typecheck`
- `cd web && npm run build`
- `cd web && npm audit`
- `cd web && npm run check:contract`

### Privacy and Security Enforcement

- `cd web && npm run test:e2e -- --grep "localhost|offline|network|privacy|csp"`
- the built app must expose a restrictive CSP that blocks accidental remote
  runtime access
- browser tests must prove there are no external HTTP(S) requests during
  initial load or local file processing

### Offline Capability

- a browser test must warm the cache online, switch offline, reload, and
  still process raw Chronicle data locally
- a browser test must verify the service worker is active and controlling the page

### Browser/Desktop Parity

- `./.tmp_benchmarks/venv313/bin/python scripts/run_deterministic_web_parity.py`
- `./.tmp_benchmarks/venv313/bin/python scripts/run_web_parity_matrix.py --weeks 2 4`
- browser output must still match desktop output on the deterministic
  pathological fixture, including `datetime_of_preprocessing`

### Contract Consistency

- a tracked check must validate that the LinkML contract, OpenAPI contract,
  and runtime/browser option surface agree on:
  - option names
  - enum values
  - boundary fields
  - required support file/runtime fields

### Larger Browser Evidence

- `./.tmp_benchmarks/venv313/bin/python scripts/benchmark_browser_pathological_fixture.py --weeks 2 --mode app_and_screen_usage`
- a tracked browser benchmark or browser-oriented local processing script must
  run a larger raw corpus and record the browser-side result shape, timing,
  and local-only network posture

## Non-Goals For This Pass

- redesigning the visual UI
- resolving the deferred semantic quirks documented elsewhere
- changing core preprocessing semantics unless required for correctness
