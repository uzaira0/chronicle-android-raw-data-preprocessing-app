#!/usr/bin/env bash
# shellcheck disable=SC2012,SC2086  # labels and file names here never contain spaces
# usage: parity.sh <ref-binary> <new-binary> <csv> <label> [extra profiler args...]
# Exports every artifact from both builds and compares them. Files whose only
# differing JSON fields are build-identity fields are reported as IDENTITY-ONLY.
set -u
W=${W:?set W to the work directory}
ref=$1; new=$2; csv=$3; label=$4; shift 4
cd "$W" || exit 1
for side in ref new; do
  bin=$ref; [ $side = new ] && bin=$new
  rm -rf parity/$label-$side
  CHRONICLE_PAYLOAD_BUDGET_MIB=${BUDGET:-1536} CAP_MEM=12G cap ./$bin --raw $csv --sequential-engine --export-artifacts-dir parity/$label-$side "$@" > parity/$label-$side.log 2>&1
  echo "$side exit=$? $(grep -o 'result_digest=[^ ]*' parity/$label-$side.log | cut -c1-40) $(grep 'heap after_execute' parity/$label-$side.log)"
done
data_diff=0
for f in $(cd parity/$label-ref && ls); do
  if cmp -s "parity/$label-ref/$f" "parity/$label-new/$f"; then continue; fi
  paths=$(jq -rn --slurpfile a "parity/$label-ref/$f" --slurpfile b "parity/$label-new/$f" \
    '[ ($a[0]|paths(scalars)) as $p | select(($a[0]|getpath($p)) != ($b[0]|getpath($p))) | $p | map(if type=="number" then "[]" else . end) | join(".") ] | unique | join(" ")' 2>/dev/null)
  if [ -z "$paths" ]; then echo "DATA-DIFF (not JSON or structure differs): $f"; data_diff=1; continue; fi
  bad=$(echo "$paths" | tr ' ' '\n' | grep -vE '^(implementationDigest|buildEnvironmentDigest|dependencyCacheMode|dependencyCacheDecision\..*|executionStateDigest|artifactClosureDigest|root_digest|rootDigest|selectedRunRoot|computationalArtifactDigests\.\[\]|artifactDigests\.\[\]|requiredViews\.\[\]\.artifactDigest|.*inputKey|.*input_key|.*reasonId|.*reason_id|.*query_input_key|.*query_reason_id|edges\..*|payload\.artifacts\..*|artifacts\.\[\]\..*)$')
  if [ -n "$bad" ]; then echo "DATA-DIFF $f: $(echo $bad | cut -c1-300)"; data_diff=1; else echo "identity-only $f"; fi
done
echo "files=$(ls parity/$label-ref | wc -l) data_diff=$data_diff"
