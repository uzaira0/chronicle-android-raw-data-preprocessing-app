#!/usr/bin/env bash
# The deploy and canary workflows run `npm ci` on the Node major named in
# web/.node-version, with that Node's bundled npm. npm 11 writes lockfiles that
# npm 10 refuses: it drops the optional-peer subtree of @puppeteer/browsers, and
# the 2026-10-07 production deploy died at "npm error Missing: ... from lock
# file" while every local gate, run with npm 11, had passed. So check the
# lockfile with the runner's npm, in a scratch copy that leaves node_modules
# alone.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR="$(tr -d '[:space:]' < "$REPO_ROOT/web/.node-version")"
case "$NODE_MAJOR" in
  22) NPM_MAJOR=10 ;;
  24) NPM_MAJOR=11 ;;
  *)
    echo "check-npm-lockfile: no npm major known for Node $NODE_MAJOR; add it here" >&2
    exit 1
    ;;
esac

work="$(mktemp -d "$REPO_ROOT/.tmp-npm-ci-check.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp "$REPO_ROOT/web/package.json" "$REPO_ROOT/web/package-lock.json" "$work/"

if ! (cd "$work" && npx -y "npm@$NPM_MAJOR" ci --ignore-scripts --dry-run --no-audit --no-fund >/dev/null); then
  echo "web/package-lock.json is refused by npm $NPM_MAJOR, the deploy runner's npm (Node $NODE_MAJOR)." >&2
  echo "Regenerate it with: cd web && npx -y npm@$NPM_MAJOR install --package-lock-only --ignore-scripts" >&2
  exit 1
fi
echo "web/package-lock.json installs with npm $NPM_MAJOR (Node $NODE_MAJOR, as on the deploy runner)."
