# Support File Lineage And Default Bundle Sync

Date: 2026-04-28

## Summary

Create an automated support-file lineage check that verifies the tracked
workbook/CSV inputs and every bundled runtime copy stay equivalent across the
Python package and web app.

## Repo evidence

The same support data is intentionally carried in several places:

- `app_codebook_files/Chronicle_Android_raw_data_preprocessor_app_codebook.xlsx`
- `app_codebook_files/unified_app_codebook.csv`
- `src/chronicle_preprocessing_app/data/unified_app_codebook.csv`
- `web/src/assets/defaults/unified_app_codebook.csv`
- `apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx`
- `web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv`
- `apps_forcing_screen_open_files/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv`
- `web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv`

A quick hash check during this review showed the codebook copies currently
match each other, and the screen-open CSV copies currently match each other.
That is good, but the check is still manual and easy to forget when a workbook
or bundled default changes.

## Classification

Deterministic local script / hook candidate. This is not a Codex automation.

This classification follows `/Users/u/AGENTS.md` Priority 4 because workbook
normalization, generated CSV comparison, row counts, duplicate checks, and hash
comparison are deterministic. Priority 0 and Priority 5 require the check to
avoid overwriting user files unless a separate explicit regeneration command is
requested.

## Proposed mechanism

Add a read-only lineage-check script and a documented manual command. The same
command can be wired into a pre-push hook for support-file paths or run from
launchd/cron if periodic local drift checks are needed. Do not create a Codex
automation or a GitHub Actions workflow for this local test/check surface.

The script:

1. Reads the canonical workbook/CSV sources with the same parsers used by the
   app where possible.
2. Normalizes ordering, line endings, encoding, and expected headers.
3. Re-emits the generated CSV defaults into a temporary directory.
4. Compares generated files against the tracked package and web copies.
5. Emits a compact diff packet with row-count changes, added/removed package
   names, duplicate labels, blank required fields, and SHA-256 values.

## Trigger

- Manual command before changing or releasing support-file bundles.
- Optional pre-push hook when changed files include `app_codebook_files/`,
  `apps_to_filter_files/`, `apps_forcing_screen_open_files/`,
  `src/chronicle_preprocessing_app/data/`, or `web/src/assets/defaults/`.
- Optional local launchd/cron schedule to catch parser/dependency drift.

## Inputs

- Canonical workbook/CSV source files.
- Package default CSV copies.
- Web default CSV copies.
- Parser configuration used by the application.

## Outputs

- Normalized temporary generated CSVs.
- Row-count, header, duplicate, blank-required-field, and SHA-256 summary.
- Compact diff packet for mismatches.

## Stop condition

Stop once generated normalized support files match every tracked runtime copy,
or once the report identifies exact rows/files that drifted.

## Failure reporting

Exit nonzero with the mismatched file group, row/hash summary, and regeneration
or inspection command. Escalate to Codex only when the mismatch requires
semantic judgment about canonical data changes.

## Why LLM judgment is not required

The check is structured file normalization and comparison. Under
`/Users/u/AGENTS.md` Priority 4, this belongs in a script or hook. LLM judgment
is only appropriate after a deterministic diff shows a data change that needs
interpretation.

## Why it helps

The web app claims local processing with bundled defaults, while the desktop
path reads package and workbook-derived defaults. If these copies drift, parity
tests may still pass on synthetic defaults while real user support files behave
different across surfaces.

## Duplicate-risk review

This is narrower than the existing contract generation check. The LinkML/OpenAPI
contract covers option shapes; this proposal covers user-support data bundles
and workbook-to-CSV lineage.

## External references reviewed

- The Turing Way describes CI as a way to run tests regularly and reduce manual
  checking of important changes: https://book.the-turing-way.org/reproducible-research/ci/
- The Turing Way CI practices page recommends keeping build/test phases fast and
  proportionate: https://book.the-turing-way.org/reproducible-research/ci/ci-practices/
