#!/usr/bin/env bash
# Semgrep registry packs, gated (launch audit 2026-10-03, analysis S1/S13).
#
#   scripts/check-semgrep-packs.sh [github-actions] [rust]   (default: both)
#
# Only the packs that produced real findings in the audit run are gated:
#   github-actions  over .github/   (mutable action tags, dependabot cooldown)
#   rust            over rust/      (unsafe, temp_dir, env::args)
# The TypeScript/React/JavaScript/OWASP/secrets packs found nothing in web/ at
# the audit and stay ungated; the repo's own rules (.semgrep/, .ast-grep/) cover
# the web source.
#
# Every finding fails the gate unless .semgrep/registry-pack-ignores.json
# carries an entry with the same rule, path and matched source line, plus the
# reason it is accepted. An ignore whose finding no longer exists also fails,
# so an entry cannot outlive the code it excused.
#
# Packs are fetched from the Semgrep registry on every run (they are not
# vendored: the Semgrep Rules License does not allow redistributing them), so
# this gate needs network access. A fetch failure fails the gate.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v semgrep >/dev/null 2>&1; then
  echo "semgrep not found — install with: brew install semgrep" >&2
  exit 1
fi

packs=("$@")
(( ${#packs[@]} )) || packs=(github-actions rust)

configs=(); targets=()
for pack in "${packs[@]}"; do
  case "$pack" in
    github-actions) configs+=(--config p/github-actions); targets+=(.github) ;;
    rust) configs+=(--config p/rust); targets+=(rust) ;;
    *) echo "unknown pack: $pack (expected github-actions or rust)" >&2; exit 2 ;;
  esac
done

# target/ is gitignored; the scan result stays there for inspection.
mkdir -p target
out=target/semgrep-packs.json

# rust/chronicle_preprocessing_runtime_wasm/vendor/ is upstream Apache Arrow
# (arrow-ipc 59.1.0, flatbuffers-generated) carried as a [patch]; its 300+
# `unsafe` blocks are upstream's, audited there, not product code.
semgrep scan "${configs[@]}" --metrics=off --quiet --json --output "$out" \
  --exclude 'rust/chronicle_preprocessing_runtime_wasm/vendor' \
  "${targets[@]}"

python3 - "$out" .semgrep/registry-pack-ignores.json "${targets[@]}" <<'PY'
import json, sys

results_path, ignores_path, *targets = sys.argv[1:]
results = json.load(open(results_path))
ignores = json.load(open(ignores_path))["ignores"]

errors = [e for e in results.get("errors", []) if e.get("level") == "error"]
for error in errors:
    print(f"semgrep error: {error.get('type')}: {error.get('message', '')[:300]}")

def in_scope(path):
    return any(path == t or path.startswith(t.rstrip("/") + "/") for t in targets)

def matched_line(result):
    with open(result["path"], encoding="utf-8", errors="replace") as handle:
        lines = handle.read().splitlines()
    return lines[result["start"]["line"] - 1].strip()

used = set()
unexcused = []
for result in results["results"]:
    line = matched_line(result)
    key = (result["check_id"], result["path"], line)
    # Each entry excuses one finding: a second identical line in the same file
    # is a new finding and needs its own reviewed entry.
    hit = next((i for i, entry in enumerate(ignores)
                if i not in used and (entry["rule"], entry["path"], entry["match"]) == key), None)
    if hit is None:
        unexcused.append((result, line))
    else:
        used.add(hit)

for result, line in unexcused:
    print(f"{result['path']}:{result['start']['line']}: {result['check_id']}\n"
          f"    {line}\n    {result['extra']['message'][:240]}")

stale = [entry for i, entry in enumerate(ignores)
         if i not in used and in_scope(entry["path"])]
for entry in stale:
    print(f"stale ignore (no such finding any more): {entry['rule']} {entry['path']}: {entry['match']}")

missing_reason = [entry for entry in ignores if not entry.get("reason", "").strip()]
for entry in missing_reason:
    print(f"ignore without a reason: {entry['rule']} {entry['path']}")

print(f"semgrep packs: {len(results['results'])} findings, {len(used)} accepted by "
      f"registry-pack-ignores.json, {len(unexcused)} unexcused, {len(stale)} stale ignores")
sys.exit(1 if (errors or unexcused or stale or missing_reason) else 0)
PY
