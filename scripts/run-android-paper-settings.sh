#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ "$#" -lt 3 ]; then
    echo "usage: $0 RAW_CSV OPTIONS_JSON OUTPUT_DIR [METHOD_PROFILE_OR_PREPROCESSING_DIAGNOSTIC_JSON_OR_component:ID [SUPPORT_ROLE=PATH ...]]" >&2
    exit 2
fi

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
raw_csv=$1
options_json=$2
output_dir=$3
receipt_json=${4-}
shift 3
if (( $# > 0 )); then
    shift
fi

command=(cargo run --quiet \
    --manifest-path "$repo_root/rust/chronicle_preprocessing_runtime_wasm/Cargo.toml" \
    --example profile_execute_workspace_native -- \
    --raw "$raw_csv" \
    --options "$options_json" \
    --export-artifacts-dir "$output_dir")

if [[ "$receipt_json" == component:* ]]; then
    component_id=${receipt_json#component:}
    if [[ -z "$component_id" ]]; then
        echo "component: requires a registered component ID" >&2
        exit 2
    fi
    command+=(--component "$component_id")
elif [[ -n "$receipt_json" ]]; then
    if [[ ${receipt_json##*/} == preprocessing-diagnostic.json ]]; then
        command+=(--diagnostic-receipt "$receipt_json")
    else
        command+=(--receipt "$receipt_json")
    fi
fi

for support in "$@"; do
    command+=(--support "$support")
done

exec "${command[@]}"
