#!/usr/bin/env bash
# Run `cargo audit` in one Rust crate, ignoring exactly the RUSTSEC IDs that
# .semantic-federation/quality/deny.toml ignores (each with its reason there).
# One list for cargo-deny and cargo-audit; osv-scanner.toml repeats each ID with
# the same reason because the CI scanner cannot read deny.toml. The list is
# not kept in a crate's .cargo/audit.toml: the runtime crate's .cargo/ is part
# of its implementation digest, so editing it would stale the dependency
# certificate.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
crate_dir="${1:?usage: cargo-audit-crate.sh <crate dir>}"
ignores=()
while IFS= read -r id; do
  ignores+=(--ignore "$id")
done < <(grep -oE 'id = "RUSTSEC-[0-9]{4}-[0-9]{4}"' "$REPO_ROOT/.semantic-federation/quality/deny.toml" | grep -oE 'RUSTSEC-[0-9]{4}-[0-9]{4}')
cd "$crate_dir"
exec cargo audit "${ignores[@]}"
