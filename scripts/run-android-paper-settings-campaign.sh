#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 3 ]; then
    echo "usage: $0 RAW_CSV COMPILED_CAMPAIGN_DIR OUTPUT_DIR" >&2
    exit 2
fi

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
raw_csv=$1
campaign_dir=$2
output_dir=$3
found=0

for run_dir in "$campaign_dir"/runs/*; do
    [ -d "$run_dir" ] || continue
    found=1
    run_name=$(basename "$run_dir")
    "$repo_root/scripts/run-android-paper-settings.sh" \
        "$raw_csv" \
        "$run_dir/runtime-options.json" \
        "$output_dir/$run_name" \
        "$run_dir/method-profile-receipt.json"
done

[ "$found" -eq 1 ] || {
    echo "compiled campaign has no runs: $campaign_dir" >&2
    exit 1
}
