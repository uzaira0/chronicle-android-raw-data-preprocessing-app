# Chronicle Web PWA Transition

This repo now includes an initial web scaffold under [web/](/Users/u/chronicle-android-raw-data-preprocessing-app/web).

## Current scope

- Static Vite/React shell
- Installable/offline-capable PWA via service worker
- Browser worker boundary for heavy processing
- Real Rust matcher compiled to WASM
- Local-only sample and JSON-file matcher execution

## Immediate architecture

1. `web/` serves the PWA shell.
2. `web/src/workers/chronicle-worker.ts` hosts the browser processing boundary.
3. `rust/chronicle_app_usage_wasm` exposes the browser-safe matcher bindings.
4. `rust/chronicle_app_usage_matcher` remains the canonical core matcher used by Python and WASM.

## Why this shape

- It matches the local-first architecture used in the referenced `sleep-scoring-web`.
- It matches the dual-mode frontend structure used in `ios-screen-time-screenshot-processing`.
- It avoids a browser-only algorithm fork.

## Next steps

1. Move preprocessing config and schema definitions into a browser-safe shared layer.
2. Add file import/parsing in the web app.
3. Port additional Rust-backed preprocessing stages into WASM.
4. Replace the matcher-only demo with end-to-end file preprocessing.
