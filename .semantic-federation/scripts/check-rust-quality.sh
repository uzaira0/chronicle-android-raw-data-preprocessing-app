#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
manifest_list=${RUST_AUTHORITY_MANIFESTS:-quality/rust-authority-manifests.txt}
minimum_lines=${RUST_COVERAGE_MIN_LINES:-95}
minimum_regions=${RUST_COVERAGE_MIN_REGIONS:-94}
minimum_functions=${RUST_COVERAGE_MIN_FUNCTIONS:-70}
deny_config=${RUST_DENY_CONFIG:-quality/deny.toml}

case "$mode" in
  coverage|mutation|supply-chain) ;;
  *) echo "usage: $0 coverage|mutation|supply-chain" >&2; exit 2 ;;
esac

if [[ ! -f "$manifest_list" ]]; then
  echo "Rust authority manifest list is missing: $manifest_list" >&2
  exit 2
fi

count=0
while IFS= read -r entry || [[ -n "$entry" ]]; do
  entry=${entry%%#*}
  entry=${entry#"${entry%%[![:space:]]*}"}
  entry=${entry%"${entry##*[![:space:]]}"}
  [[ -z "$entry" ]] && continue
  IFS='|' read -r manifest exclude_re entry_lines entry_regions entry_functions features no_default_features <<< "$entry"
  coverage_lines=${entry_lines:-$minimum_lines}
  coverage_regions=${entry_regions:-$minimum_regions}
  coverage_functions=${entry_functions:-$minimum_functions}
  if [[ ! -f "$manifest" ]]; then
    echo "Configured Rust authority manifest does not exist: $manifest" >&2
    exit 2
  fi
  count=$((count + 1))
  case "$mode" in
    coverage)
      args=(llvm-cov
        --manifest-path "$manifest"
        --summary-only
        --fail-under-lines "$coverage_lines"
        --fail-under-regions "$coverage_regions"
        --fail-under-functions "$coverage_functions")
      [[ "$no_default_features" == "no-default-features" ]] && args+=(--no-default-features)
      [[ -n "$features" ]] && args+=(--features "$features")
      rustup run stable cargo "${args[@]}"
      ;;
    mutation)
      crate_dir=$(cd "$(dirname "$manifest")" && pwd -P)
      args=(mutants -d "$crate_dir" --jobs "${RUST_MUTATION_JOBS:-8}" --timeout "${RUST_MUTATION_TIMEOUT:-90}")
      if [[ -n "$exclude_re" ]]; then
        IFS=',' read -r -a exclude_patterns <<< "$exclude_re"
        for pattern in "${exclude_patterns[@]}"; do
          args+=(-E "$pattern")
        done
      fi
      [[ "$no_default_features" == "no-default-features" ]] && args+=(--no-default-features)
      [[ -n "$features" ]] && args+=(--features "$features")
      cargo "${args[@]}"
      ;;
    supply-chain)
      if [[ ! -f "$deny_config" ]]; then
        echo "cargo-deny policy is missing: $deny_config" >&2
        exit 2
      fi
      cargo deny --manifest-path "$manifest" check \
        --config "$deny_config" \
        --allow unmatched-source \
        --allow license-not-encountered \
        --allow advisory-not-detected \
        advisories licenses sources
      ;;
  esac
done < "$manifest_list"

if (( count == 0 )); then
  echo "No Rust authorities configured in $manifest_list" >&2
  exit 2
fi

echo "rust_authority_quality=$mode manifests=$count"
