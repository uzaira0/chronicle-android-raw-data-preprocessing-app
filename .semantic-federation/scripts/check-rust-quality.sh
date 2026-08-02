#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
manifest_list=${RUST_AUTHORITY_MANIFESTS:-quality/rust-authority-manifests.txt}
minimum_lines=${RUST_COVERAGE_MIN_LINES:-95}
minimum_regions=${RUST_COVERAGE_MIN_REGIONS:-94}
minimum_functions=${RUST_COVERAGE_MIN_FUNCTIONS:-70}
deny_config=${RUST_DENY_CONFIG:-quality/deny.toml}
mutation_jobs=${RUST_MUTATION_JOBS:-8}
mutation_timeout=${RUST_MUTATION_TIMEOUT:-90}
# An exclusion set at or below this many mutants is audited mutant by mutant.
# A larger one is audited one mutant per distinct mutation site; see
# audit_mutation_exclusions.
exclusion_audit_max=${RUST_MUTATION_EXCLUSION_AUDIT_MAX:-400}

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

# Turn a literal mutant name into a regex that matches only that mutant.
regex_escape() {
  printf '%s' "$1" | sed -e 's/[][(){}.*+?^$|\\]/\\&/g'
}

# cargo-mutants 27.1.0 does not apply `--re` or `--exclude-re` to its
# "delete field <f> from struct <S> expression in <fn>" mutants: they are listed
# whatever the regex says, and `-E` cannot remove them. The kernel crate has
# seven, so an unguarded `--list --re` reports every expression as matching at
# least seven mutants and the zero-match check below could never fire there.
# Every `--re` result is therefore filtered against the set produced by a regex
# that matches nothing. When cargo-mutants filters them, that set is empty and
# the filter is a no-op.
exclusion_gate_sentinel='chronicle_exclusion_gate_sentinel_no_such_mutant'
always_listed=""
always_listed_count=0

# Mutants `-E <pattern>` would remove, one name per line.
list_expression_matches() {
  local pattern=$1
  if (( always_listed_count > 0 )); then
    { cargo mutants --list "${mutation_base[@]}" --re "$pattern" < /dev/null \
        | grep -F -x -v -f "$always_listed" || true; }
  else
    cargo mutants --list "${mutation_base[@]}" --re "$pattern" < /dev/null
  fi
}

# `cargo mutants -E <expr>` that matches nothing is a silent no-op: the mutants
# the expression was written for come back under test and the gate reports them
# as missed, while the entry still claims an exclusion. `cargo mutants -E <expr>`
# that matches a mutant the suite kills is worse — it removes a real kill from
# the score and nothing says so. Neither is visible from the campaign's own
# output, so the gate establishes both before the campaign runs.
#
# Globals read: manifest, crate_dir, pattern_source, exclusion_patterns,
#               mutation_base, exclusion_audit_max, mutation_jobs,
#               mutation_timeout.
check_mutation_exclusions() {
  local work="$crate_dir/target/mutation-exclusion-check"
  rm -rf "$work"
  mkdir -p "$work"

  local exclude_args=()
  local pattern
  for pattern in "${exclusion_patterns[@]}"; do
    exclude_args+=(-E "$pattern")
  done

  local total kept excluded
  total=$(cargo mutants --list "${mutation_base[@]}" < /dev/null | wc -l | tr -d '[:space:]')
  kept=$(cargo mutants --list "${mutation_base[@]}" "${exclude_args[@]}" < /dev/null | wc -l | tr -d '[:space:]')
  excluded=$((total - kept))

  always_listed="$work/always-listed.txt"
  cargo mutants --list "${mutation_base[@]}" --re "$exclusion_gate_sentinel" < /dev/null > "$always_listed"
  always_listed_count=$(wc -l < "$always_listed" | tr -d '[:space:]')

  # One representative mutant per distinct `file:line:col` mutation site, over
  # every expression. Used only when the exclusion set is too large to audit
  # mutant by mutant.
  local sites="$work/sites.txt"
  : > "$sites"

  local zero_match=0 count
  for pattern in "${exclusion_patterns[@]}"; do
    count=$(list_expression_matches "$pattern" \
      | awk -v out="$sites" '
          { key = $0; sub(/: .*/, "", key)
            if (!(key in seen)) { seen[key] = 1; print $0 >> out } }
          END { print NR }')
    if [[ "$count" == "0" ]]; then
      echo "Mutation exclusion expression matches no mutant." >&2
      echo "  manifest:   $manifest" >&2
      echo "  expressions from: $pattern_source" >&2
      echo "  expression: $pattern" >&2
      echo "  The mutants it was written for are back under test, or its anchor" >&2
      echo "  has drifted. Re-anchor it against \`cargo mutants --list\` or delete it." >&2
      zero_match=1
    fi
  done
  if (( zero_match )); then
    exit 2
  fi

  echo "rust_authority_mutation_exclusions manifest=$manifest source=$pattern_source expressions=${#exclusion_patterns[@]} matched=$excluded of=$total unfilterable=$always_listed_count"

  audit_mutation_exclusions "$work" "$excluded" "$sites"
}

# Prove the exclusion set contains no mutant the suite kills, by testing the
# excluded mutants themselves. `-F` selects exactly the set `-E` removes.
#
# A wholesale scope exclusion — the matcher's PyO3 facade, which the gate's
# `--no-default-features` build does not compile — can match hundreds of
# thousands of mutants, so an exclusion set larger than $exclusion_audit_max is
# audited one mutant per distinct mutation site instead, and the mode is
# printed. If even that does not fit, the gate fails rather than claim a check
# it did not run.
audit_mutation_exclusions() {
  local work=$1 excluded=$2 sites=$3
  local audit_args=() audit_mode audit_count pattern

  if (( excluded <= exclusion_audit_max )); then
    audit_mode=every-mutant
    audit_count=$excluded
    for pattern in "${exclusion_patterns[@]}"; do
      audit_args+=(-F "$pattern")
    done
  else
    local representatives="$work/representatives.txt"
    awk '{ key = $0; sub(/: .*/, "", key)
           if (!(key in seen)) { seen[key] = 1; print } }' "$sites" > "$representatives"
    audit_count=$(wc -l < "$representatives" | tr -d '[:space:]')
    if (( audit_count > exclusion_audit_max )); then
      echo "Mutation exclusion set is too large to audit: manifest=$manifest excluded=$excluded sites=$audit_count max=$exclusion_audit_max" >&2
      exit 2
    fi
    audit_mode=one-per-site
    local name
    while IFS= read -r name || [[ -n "$name" ]]; do
      [[ -z "$name" ]] && continue
      audit_args+=(-F "^$(regex_escape "$name")\$")
    done < "$representatives"
  fi

  local out="$work/audit"
  local report="$out/mutants.out"
  mkdir -p "$out"
  # Every audited mutant is expected to survive, so cargo-mutants exits non-zero
  # on a clean audit. The verdict comes from its outcome files, not its status.
  cargo mutants "${mutation_base[@]}" "${audit_args[@]}" \
    --jobs "$mutation_jobs" --timeout "$mutation_timeout" -o "$out" < /dev/null || true

  # The unfilterable mutants above ride along in every `-F` run too, so they are
  # part of what the audit tests and none of what it judges.
  local tested=0 file
  for file in caught missed timeout unviable success; do
    if [[ -f "$report/$file.txt" ]]; then
      tested=$((tested + $(wc -l < "$report/$file.txt" | tr -d '[:space:]')))
    fi
  done
  local expected=$((audit_count + always_listed_count))
  if (( tested != expected )); then
    echo "Mutation exclusion audit did not test the mutants it selected." >&2
    echo "  manifest: $manifest" >&2
    echo "  selected: $audit_count (+$always_listed_count unfilterable)   tested: $tested" >&2
    echo "  Report:   $report" >&2
    exit 2
  fi

  local caught_excluded="$work/caught-excluded.txt"
  if [[ -f "$report/caught.txt" ]] && (( always_listed_count > 0 )); then
    grep -F -x -v -f "$always_listed" "$report/caught.txt" > "$caught_excluded" || true
  elif [[ -f "$report/caught.txt" ]]; then
    cp "$report/caught.txt" "$caught_excluded"
  else
    : > "$caught_excluded"
  fi

  if [[ -s "$caught_excluded" ]]; then
    echo "Mutation exclusions cover mutants the suite catches." >&2
    echo "  manifest: $manifest" >&2
    echo "  Excluding a caught mutant removes a real kill from the score." >&2
    local name
    for pattern in "${exclusion_patterns[@]}"; do
      { list_expression_matches "$pattern" \
          | grep -F -x -f "$caught_excluded" || true; } \
        | while IFS= read -r name; do
            echo "  caught, excluded by [$pattern]: $name" >&2
          done
    done
    exit 2
  fi

  echo "rust_authority_mutation_exclusion_audit manifest=$manifest mode=$audit_mode audited=$audit_count caught=0"
}

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
      mutation_base=(-d "$crate_dir")
      [[ "$no_default_features" == "no-default-features" ]] && mutation_base+=(--no-default-features)
      [[ -n "$features" ]] && mutation_base+=(--features "$features")

      exclusion_patterns=()
      pattern_source=""
      if [[ -n "$exclude_re" ]]; then
        IFS=',' read -r -a inline_patterns <<< "$exclude_re"
        exclusion_patterns+=("${inline_patterns[@]}")
        pattern_source="$manifest_list"
      fi
      if [[ -n "$exclude_file" ]]; then
        while IFS= read -r pattern || [[ -n "$pattern" ]]; do
          [[ "$pattern" =~ ^[[:space:]]*(#.*)?$ ]] && continue
          exclusion_patterns+=("$pattern")
        done < "$exclude_file"
        if (( ${#exclusion_patterns[@]} == 0 )); then
          echo "Mutation exclusion file has no expressions: $exclude_file" >&2
          exit 2
        fi
        pattern_source="$exclude_file"
      fi

      args=(mutants "${mutation_base[@]}" --jobs "$mutation_jobs" --timeout "$mutation_timeout")
      if (( ${#exclusion_patterns[@]} > 0 )); then
        check_mutation_exclusions
        for pattern in "${exclusion_patterns[@]}"; do
          args+=(-E "$pattern")
        done
      fi
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
