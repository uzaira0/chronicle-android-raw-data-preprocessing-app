# Handoff: large-file memory fix (branch `large-file-memory`)

Delete this `handoff/` folder before the squash-merge. It is working notes, not product.

## What this branch does

An analyst could not process a 605.9 MB, 3.5 M-row Chronicle export in the browser: the app
refused anything over 180 MB, and above that the worker ran out of its 4 GiB memory. The
earlier analyst had processed the same files, so the cause was the app, not the files.

This branch lowers memory without changing any output byte, and raises the limit to 750 MB.

- Kernel: the source-row table is released as soon as later steps have what they need.
  Repeated strings are shared, rare timing data is boxed, and app-shaped CSVs are written
  straight into spillable chunks.
- Runtime: results are handed to the page one chunk at a time (`take_artifact_chunk`).
- Web:
  - Results are streamed into OPFS one at a time, largest first.
  - Stored objects over 256 MiB are verified with a streaming SHA-256.
  - The shared inspection worker is retired after a large input, because its WASM memory
    never shrinks.
- Limits:
  - Input limit 180 MB → 750 MB.
  - Row ceiling 950k → 4.4 M.
  - The payload budget shrinks as the largest input grows.
  - The worker shows a plain message when it hits the 4 GiB limit.

## Measured on this branch (RHEL 9 host)

- **Byte parity** (old engine against new, 512 MiB budget, 900k rows): every output file is
  identical.
  - All optional outputs: 55 files.
  - Web defaults: 45 files.
  - The full 606 MB file gives the same result digest on both engines.
- **Native peak, full 606 MB file:**
  - Defaults: 6,357 → 2,733 MiB.
  - All outputs: 8,817 → 4,011 MiB.
- **Chromium, real app:**
  - 606 MB: results in 139–180 s, tab peak 3.9–4.4 GiB.
  - 750 MB: 161 s, tab peak 4.5 GiB.
  - Memory drops to about 0.26 GB once results are shown.
- **Still fails:** all optional outputs at once on a 606 MB file still runs out of memory in
  WASM. The app now says so plainly. This is documented in `docs/perf/BASELINE.md` under
  "Real-size exports".
- **Reviews:** Codex astra (high) and Fable 5.1 reviewed the changes. All findings are fixed,
  and an astra fix-check confirmed them.
- **Checks run:**
  - Clippy is clean with Rust 1.97.1.
  - `build:wasm` was run with 1.97.1.
  - `make dependency-evidence` ran green, exit 0, in 40.5 min. Only identity digests moved
    in the 41 goldens.
  - Typecheck passes.
  - The targeted vitest suites passed: 218 tests.
  - Published figures: 25/25 agree, after `pin-figures` in the last commit.

## What is left

1. **Gate.** Nothing in it has been run yet on this commit.
   ```bash
   export RUSTUP_TOOLCHAIN=1.97.1 CHECK_BASE=production/main \
          NODE_OPTIONS=--max-old-space-size=4096 CARGO_INCREMENTAL=0
   make check     # PR gate
   make all       # pre-deploy gate (rust, scanners, e2e chromium+firefox, deploy-artifact, wasm-fresh)
   ```
   - `web/src/lib/rustPipelineRuntimeContract.test.ts` had 7 failures before the evidence
     run. All of them were from the stale certificate, which is now regenerated, so they
     should pass. Run that file alone first:
     ```bash
     npm exec -- node scripts/run-clean-env.mjs vitest run src/lib/rustPipelineRuntimeContract.test.ts
     ```
     Run it from `web/`.
   - If a gate fails, fix it, then rerun only the failing test.
   - If a figure drifts, run `make pin-figures` and commit.
   - Any production Rust edit means `npm run build:wasm` and one more
     `make dependency-evidence`.
2. **PR.** Open it to `production` (`uzaira0/chronicle-android-raw-data-preprocessing-app`),
   base `main`. Squash-merge once `make all` is green.
3. **Deploy only when asked.** Production Pages currently serves the `gh-pages` branch
   (legacy source), because the Actions billing lock forced it. See
   `docs/web-deployment.md`.
4. **Reply to the analyst once the update is live.** The draft is in the "Reply to analyst"
   section below.

## Setting up another machine

- Rust 1.97.1 with the `wasm32-unknown-unknown` target, plus the WASM toolchain that
  `npm run build:wasm` needs (see `web/scripts/` for the build script it runs).
- Use the Node major in `web/.node-version`. Then run `cd web && npm ci`, then
  `npx playwright install chromium firefox`. WebKit is skipped.
- The evidence run is needed only after another Rust edit. It also needs
  `nightly-2026-04-23` with `llvm-tools` and wasm32, set as
  `CHRONICLE_NIGHTLY_TOOLCHAIN=nightly-2026-04-23`.
- WASM bytes depend only on the sources, not the checkout path (PR #36), so `make wasm-fresh`
  should pass on any machine with Rust 1.97.1. A different `rustc` gives different bytes.
- `cap` is a local memory and CPU wrapper on the original host. Elsewhere, drop it, or use
  `systemd-run --user --scope -p MemoryMax=12G`.

## Reproducing the large-file checks (optional)

All test files are synthetic. No participant data is involved.

```bash
export W=/path/to/workdir REPO=/path/to/checkout
cd $REPO/web
npm exec -- tsx scripts/generate_benchmark_fixture.mts --realistic --days 80 \
  --rows-per-day 20000 --seed 1 --output $W/half.csv            # ~318 MB, 1.6 M rows
python3 $REPO/handoff/large-file-memory/double.py $W/half.csv $W/synthetic.csv 80
python3 $REPO/handoff/large-file-memory/to_real_layout.py $W/synthetic.csv $W/real-layout.csv
cp $W/real-layout.csv $W/big-750m.csv
python3 $REPO/handoff/large-file-memory/extend.py $W/big-750m.csv 750000000 200
```

- **Browser:** build the app (`npm run build:app`) and serve `web/dist`
  (`npx vite preview --port 4294`). Then:
  ```bash
  node handoff/large-file-memory/run_build.mjs http://127.0.0.1:4294/ chromium $W/real-layout.csv real 60
  ```
  It uses an on-disk browser profile on purpose: a temporary profile keeps OPFS in memory
  under a small quota and fails with a short write.
- **Native parity:** build the profiler twice, once at the base commit `2169595a0` and once
  at this branch.
  ```bash
  cd rust/chronicle_preprocessing_runtime_wasm
  cargo build --locked --profile profiling --example profile_execute_workspace_native
  ```
  Copy each binary into `$W`. Then:
  ```bash
  BUDGET=512 parity.sh <old-bin> <new-bin> <csv> <label> --options web-default-options.json
  ```
  `data_diff=0` means byte parity.

## Reply to analyst

The draft is ready to send once the update is live:

> Thanks for flagging this. You were right that these are the same files the earlier analyst
> processed. The app had become much more memory-hungry than it needed to be. The fix was in
> the app, not in your files.
>
> Once the update is live:
> - Files up to 750 MB are accepted (the limit was 180 MB).
> - Your 605.9 MB file (3.5 million rows) processes in the browser. On our test machine in
>   Chrome it took 2 to 3 minutes, and the browser tab stayed under about 4.5 GB of memory.
> - Files the app could already handle give exactly the same outputs as before, byte for byte.
>
> Two things to know:
> - Turning on every optional output at once (credited usage, notification contacts,
>   placeholder days, day coverage, concurrent usage, aggregates, compliance, polled
>   sampling, formula protection) can still run out of memory on a file this large. If that
>   happens, the app says so and suggests turning some of them off.
> - A file above 750 MB still needs to be split by date range, with the parts added as
>   separate files.
