#!/usr/bin/env bash
# TypeScript/web dead code detection via knip.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
(cd "$REPO_ROOT/web" && node_modules/.bin/knip)
