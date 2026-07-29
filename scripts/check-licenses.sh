#!/usr/bin/env bash
# check-licenses.sh
# License compliance check across npm and Rust dependencies.
#
# This project is GPL-3.0-only, so GPL-2.0 and GPL-3.0 deps are acceptable.
# Blocked: AGPL (copyleft over network), Proprietary, Commercial.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Make cargo-license findable even if PATH not yet updated after install
export PATH="$PATH:/Users/u/.cargo/bin"

FAIL=0

# ---------------------------------------------------------------------------
echo ""
echo "=== npm licenses ==="
# MIT*  = MIT license found in file but missing SPDX field; known-good
# buffers@0.1.1 = ancient substack package with no license field; known-good MIT
(
    cd "$REPO_ROOT/web"
    npx license-checker \
        --production \
        --onlyAllow "MIT;MIT*;BSD-2-Clause;BSD-3-Clause;Apache-2.0;ISC;CC0-1.0;Unlicense;CC-BY-4.0;Python-2.0;0BSD;BlueOak-1.0.0" \
        --excludePrivatePackages \
        --excludePackages "buffers@0.1.1" \
        --summary \
        2>&1
) || {
    echo "ERROR: Incompatible npm licenses found" >&2
    FAIL=1
}

# ---------------------------------------------------------------------------
echo ""
echo "=== Rust licenses ==="
if command -v cargo-license >/dev/null 2>&1; then
    cd "$REPO_ROOT/rust/chronicle_app_usage_matcher"
    cargo license --json 2>/dev/null \
        | python3 -c "
import json, sys
data = json.load(sys.stdin)
bad = []
for p in data:
    name = p.get('name', '')
    lic  = p.get('license', '') or ''
    if name == 'chronicle_app_usage_matcher':
        continue
    # Block AGPL, Proprietary, and pure-GPL without a permissive dual-license.
    # GPL-2.0-or-later / LGPL are acceptable for a GPL-3.0 project.
    u = lic.upper()
    if any(x in u for x in ('AGPL', 'PROPRIETARY', 'COMMERCIAL')):
        bad.append(f'{name}: {lic}')
    elif 'GPL' in u and 'LGPL' not in u and 'MIT' not in u and 'APACHE' not in u and 'OR' not in u:
        bad.append(f'{name}: {lic}')
if bad:
    for b in bad:
        print('INCOMPATIBLE:', b, file=sys.stderr)
    sys.exit(1)
print('Rust licenses OK')
" || FAIL=1
else
    echo "cargo-license not installed — skipping Rust license check"
    echo "Install with: cargo install cargo-license --locked"
fi

exit $FAIL
