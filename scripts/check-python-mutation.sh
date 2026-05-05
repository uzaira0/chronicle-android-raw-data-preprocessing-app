#!/usr/bin/env bash
# Real mutation testing with mutmut 3.5.
# Runs targeted mutations on the two most critical preprocessor files,
# checking that each achieves ≥ 80% kill rate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

THRESHOLD=80   # percent
SCRATCH_BASE="$REPO_ROOT/.mutation-scratch"
mkdir -p "$SCRATCH_BASE"
SCORE_FILE="$SCRATCH_BASE/last_score"

# ---------------------------------------------------------------------------
# run_mutation FILE TEST_FILES...
#   Runs mutmut on a single source file using targeted test files.
#   Writes integer kill-% to $SCORE_FILE on success.
#   Returns 0 on success (including survived mutants), non-zero on hard failure.
# ---------------------------------------------------------------------------
run_mutation() {
  local source_file="$1"
  shift
  local test_files=("$@")

  local short_name
  short_name="$(basename "$source_file" .py)"
  local run_dir="$SCRATCH_BASE/$short_name"

  # Clean any previous run so mutmut doesn't load stale state
  rm -rf "$run_dir"

  # Create directory structure before rsync
  mkdir -p "$run_dir/src"
  mkdir -p "$run_dir/tests"

  # Copy the full source package so imports within the package resolve
  rsync -a \
    "$REPO_ROOT/src/chronicle_preprocessing_app/" \
    "$run_dir/src/chronicle_preprocessing_app/"

  # Copy test support files
  cp "$REPO_ROOT/tests/conftest.py" "$run_dir/tests/" 2>/dev/null || true
  cp "$REPO_ROOT/tests/polars_helpers.py" "$run_dir/tests/" 2>/dev/null || true
  for tf in "${test_files[@]}"; do
    local tf_path="$REPO_ROOT/tests/$tf"
    if [ -f "$tf_path" ]; then
      cp "$tf_path" "$run_dir/tests/"
    fi
  done

  # Build TOML array entries for the test files that actually exist in run_dir
  local toml_test_entries=""
  local first=1
  for tf in "${test_files[@]}"; do
    local base
    base="$(basename "$tf")"
    if [ -f "$run_dir/tests/$base" ]; then
      if [ "$first" -eq 1 ]; then
        toml_test_entries="\"tests/${base}\""
        first=0
      else
        toml_test_entries="${toml_test_entries}, \"tests/${base}\""
      fi
    fi
  done

  local rel_source="src/chronicle_preprocessing_app/core/preprocessing/$(basename "$source_file")"

  # Write pyproject.toml — mutmut 3.5 reads [tool.mutmut] from here.
  # also_copy = ["src"] ensures the full package lands in mutants/src/
  # so intra-package imports work when the mutated module is loaded.
  cat > "$run_dir/pyproject.toml" <<TOML
[tool.pytest.ini_options]
pythonpath = ["src"]

[tool.mutmut]
paths_to_mutate = ["${rel_source}"]
also_copy = ["src"]
pytest_add_cli_args_test_selection = [${toml_test_entries}]
TOML

  echo "--- mutmut: $short_name ---"
  echo "Source:  $rel_source"
  echo "Tests:   ${test_files[*]}"

  # Run mutmut; exit 2 = "some mutants survived" (normal); 0 = all killed
  set +e
  (
    cd "$run_dir"
    PYTHONPATH="$run_dir/src" \
    PY_IGNORE_IMPORTMISMATCH=1 \
    "$PYTHON" -m mutmut run 2>&1
  )
  local run_exit=$?
  set -e

  if [ "$run_exit" -ne 0 ] && [ "$run_exit" -ne 2 ]; then
    echo "mutmut run exited with unexpected status $run_exit for $source_file" >&2
    return 1
  fi

  # Export cicd stats → mutants/mutmut-cicd-stats.json
  (
    cd "$run_dir"
    PY_IGNORE_IMPORTMISMATCH=1 \
    "$PYTHON" -m mutmut export-cicd-stats 2>&1 || true
  )

  local stats_file="$run_dir/mutants/mutmut-cicd-stats.json"
  if [ ! -f "$stats_file" ]; then
    echo "mutmut did not produce cicd-stats.json for $source_file" >&2
    return 1
  fi

  # Parse killed and survived from JSON
  local killed survived total score
  killed="$("$PYTHON" -c "import json; d=json.load(open('$stats_file')); print(d['killed'])")"
  survived="$("$PYTHON" -c "import json; d=json.load(open('$stats_file')); print(d['survived'])")"
  total="$(( killed + survived ))"

  if [ "$total" -eq 0 ]; then
    echo "No mutants were generated or tested for $source_file" >&2
    return 1
  fi

  score="$("$PYTHON" -c "print(round($killed / $total * 100))")"
  echo "Result: $killed/$total mutants killed — score ${score}%"

  echo "$score" > "$SCORE_FILE"
}

# ---------------------------------------------------------------------------
# check_file SOURCE_BASENAME TEST_FILES...
# ---------------------------------------------------------------------------
check_file() {
  local source_file="$1"
  shift
  local test_files=("$@")

  rm -f "$SCORE_FILE"
  run_mutation "$source_file" "${test_files[@]}"

  if [ ! -f "$SCORE_FILE" ]; then
    echo "No score produced for $(basename "$source_file")" >&2
    return 1
  fi
  local score
  score="$(cat "$SCORE_FILE")"

  if [ "$score" -lt "$THRESHOLD" ]; then
    echo "FAIL: mutation score ${score}% is below threshold ${THRESHOLD}% for $(basename "$source_file")" >&2
    return 1
  fi

  echo "PASS: mutation score ${score}% >= ${THRESHOLD}% for $(basename "$source_file")"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "=== Mutation testing (threshold: ${THRESHOLD}%) ==="
echo

FAIL=0

check_file \
  "timestamp_preprocessor.py" \
  "test_timestamp_properties.py" \
  "test_timestamp_timezone_preprocessors.py" \
  "test_timestamp_comprehensive.py" \
  || FAIL=1

echo

check_file \
  "timezone_preprocessor.py" \
  "test_timestamp_timezone_preprocessors.py" \
  "test_study_date_provider.py" \
  || FAIL=1

echo

check_file \
  "app_filter_preprocessor.py" \
  "test_app_filter_preprocessor.py" \
  || FAIL=1

echo

check_file \
  "screen_usage_preprocessor.py" \
  "test_screen_usage_preprocessor.py" \
  || FAIL=1

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "Mutation testing FAILED. One or more files fell below ${THRESHOLD}% kill rate." >&2
  exit 1
fi

echo
echo "All mutation scores meet the ${THRESHOLD}% threshold."
