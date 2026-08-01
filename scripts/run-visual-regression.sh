#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/web"
if [ ! -f "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js" ]; then
  echo "WASM not built — run: npm run build:wasm" >&2; exit 1
fi
# A stale `vite preview` from another checkout can hold the default port, and
# playwright's reuseExistingServer would then silently screenshot the WRONG
# build. Serve this checkout's own fresh build on a dedicated port instead,
# and refuse to run against any server this script did not start.
PORT=4187
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is already in use — refusing to screenshot an unknown server" >&2
  exit 1
fi
# Only the app bundle is needed here (the committed WASM pkg is used as-is;
# `npm run build` would rebuild WASM from Rust on every pre-push).
node scripts/run-clean-env.mjs ./node_modules/.bin/vite build >/dev/null
# Launch the vite binary directly so $! is the listener's own PID — a wrapper
# in between leaves the real server orphaned when the trap fires.
./node_modules/.bin/vite preview --host 127.0.0.1 --port "$PORT" --strictPort >/dev/null 2>&1 &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/" || {
  echo "preview server failed to start on port $PORT" >&2; exit 1
}
# The readiness probe alone can be satisfied by a FOREIGN server if our
# strictPort launch lost a race and died — require that the listener on the
# port is exactly the vite process this script started.
kill -0 "$PREVIEW_PID" 2>/dev/null || {
  echo "our preview process died — refusing to screenshot whatever answered on port $PORT" >&2
  exit 1
}
LISTENER="$(lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN | head -1)"
if [ "$LISTENER" != "$PREVIEW_PID" ]; then
  echo "port $PORT is held by PID ${LISTENER:-none}, not our preview ($PREVIEW_PID) — refusing" >&2
  exit 1
fi
PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PORT" npx playwright test --project=chromium --grep "@visual"
