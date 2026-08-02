#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
manifest_list=${RUST_AUTHORITY_MANIFESTS:-quality/rust-authority-manifests.txt}
minimum_lines=${RUST_COVERAGE_MIN_LINES:-95}
minimum_regions=${RUST_COVERAGE_MIN_REGIONS:-94}
minimum_functions=${RUST_COVERAGE_MIN_FUNCTIONS:-70}
deny_config=${RUST_DENY_CONFIG:-quality/deny.toml}

# cargo-mutants builds each mutant in a copy of the crate directory, where the
# `../..` these build scripts fall back to is the scratch parent rather than
# the repository. The fallback only survived because the build scripts were not
# re-running; any edit under .semantic-federation makes them re-run and the
# whole gate then dies in an unmutated baseline with "read Chronicle product
# plan: No such file or directory". Pin the roots the build scripts already
# accept so a sandboxed build resolves them.
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
export CHRONICLE_REPOSITORY_ROOT="$repository_root"
export CHRONICLE_SEMANTIC_ROOT="$repository_root/.semantic-federation/semantic"
export CHRONICLE_DEPENDENCY_CERTIFICATE="$repository_root/.semantic-federation/proofs/dependency-certificate.json"

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
  IFS='|' read -r manifest exclude_re entry_lines entry_regions entry_functions features no_default_features coverage_ignore_re <<< "$entry"
  # The entry is split on '|' and its exclusion field on ',', so neither
  # character can appear inside an exclusion expression: a regex carrying one
  # is silently truncated into an unclosed group. An expression list that needs
  # them — alternation, a repetition bound — lives in its own file instead,
  # named here as `@<file>` relative to the manifest list, one expression per
  # line with '#' comments.
  exclude_file=""
  if [[ "$exclude_re" == @* ]]; then
    exclude_file="$(dirname "$manifest_list")/${exclude_re#@}"
    if [[ ! -f "$exclude_file" ]]; then
      echo "Configured mutation exclusion file does not exist: $exclude_file" >&2
      exit 2
    fi
    exclude_re=""
  elif [[ "$exclude_re" == *'('* || "$exclude_re" == *'{'* ]]; then
    echo "Inline exclusion expressions cannot contain '(' or '{': the entry is split on '|' and ',', so a group or a repetition bound is cut in half. Move them to an @file: $manifest" >&2
    exit 2
  fi
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
      if [[ -n "$coverage_ignore_re" ]]; then
        # A coverage scope that matches nothing is worse than none at all: it
        # reads as a considered decision while measuring the whole crate, which
        # is how drifted mutation anchors hid seven phantom misses. Resolve it
        # against the crate's real sources and fail if it anchors on nothing.
        crate_src=$(cd "$(dirname "$manifest")" && pwd -P)/src
        matched=$(find "$crate_src" -name '*.rs' | grep -cE "$coverage_ignore_re" || true)
        if (( matched == 0 )); then
          echo "Coverage scope regex matches no source under $crate_src: $coverage_ignore_re" >&2
          exit 2
        fi
        echo "rust_authority_coverage_scope manifest=$manifest excluded_files=$matched regex=$coverage_ignore_re"
        args+=(--ignore-filename-regex "$coverage_ignore_re")
      fi
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
      if [[ -n "$exclude_file" ]]; then
        excluded=0
        while IFS= read -r pattern || [[ -n "$pattern" ]]; do
          [[ "$pattern" =~ ^[[:space:]]*(#.*)?$ ]] && continue
          args+=(-E "$pattern")
          excluded=$((excluded + 1))
        done < "$exclude_file"
        if (( excluded == 0 )); then
          echo "Mutation exclusion file has no expressions: $exclude_file" >&2
          exit 2
        fi
        echo "rust_authority_mutation_exclusions manifest=$manifest file=$exclude_file expressions=$excluded"
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
