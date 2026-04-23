# Interaction Types Loss Fix Summary

## Problem

Some raw interaction events were present in Chronicle raw CSV files but showed up in lower counts in the preprocessed output.

This was most visible for:

- `Unknown importance: 15` -> `Screen Interactive`
- `Unknown importance: 16` -> `Screen Non-Interactive`
- `Unknown importance: 17` -> `Keyguard Shown`
- `Unknown importance: 18` -> `Keyguard Hidden`
- `Unknown importance: 10` -> `Notification Seen`
- `Unknown importance: 12` -> `Notification Interruption`

The discrepancy was confusing because the events were renamed correctly and some still appeared in the preprocessed output, but fewer rows survived than existed in the raw input.

## Root Cause

The previous behavior had two separate causes.

### 1. Interaction types could be removed by default

The older root-level implementation used a broad default removal set for non-usage/system events. That set included screen, keyguard, notification, and other raw interaction events.

The new packaged implementation now centralizes defaults in `src/chronicle_preprocessing_app/config/defaults.py` and uses an empty default removal set:

- `DEFAULT_INTERACTION_TYPES_TO_REMOVE = frozenset()`

This means renamed raw interaction events are retained by default unless the user explicitly selects them for removal.

### 2. Removal behavior preserved rows for any positive gap

When an interaction type was selected for removal, the old removal logic preserved the row whenever:

- `data_time_gap_hours > 0`

That was misleading. `data_time_gap_hours` is the rounded time delta from the previous event. It is not the same thing as a configured long data gap.

This caused partial retention:

- many selected interaction rows were dropped
- some selected interaction rows were preserved
- preservation depended on whether the preceding gap was merely positive
- the "Long Data Time Gap Thresholds" setting did not control the behavior

## Fixes Applied

### 1. Raw interaction events are retained by default

The packaged app defaults now keep all interaction types unless the user explicitly selects types to remove.

This covers screen, keyguard, notification, standby bucket, and other renamed raw interaction events.

### 2. Removal now uses the configured long-gap threshold

The removal logic was changed from:

- preserve selected row if `data_time_gap_hours > 0`

to:

- preserve selected row only if `data_time_gap_hours >= min(long_data_time_gap_thresholds)`

This makes removal deterministic and aligned with the configured long-gap threshold.

### 3. Interaction dialogs now show actual current defaults

The interaction-type dialogs were updated so the unconfigured state reflects the real current option values rather than misleading fallback selections.

This affects:

- same-app interaction stop settings
- other interaction stop settings
- interaction types to remove

### 4. Threshold defaults now come from shared defaults

The long-usage and long-gap threshold reset behavior now uses the centralized defaults from `src/chronicle_preprocessing_app/config/defaults.py`.

This removes hidden drift between:

- model defaults
- UI fallback behavior
- app-usage flag fallback behavior

### 5. App usage algorithm orchestration is single-path

The app-usage event pairing flow now has a canonical entry point:

- `run_app_usage_algorithm()`

The main preprocessing pipeline delegates through that path instead of separately orchestrating filtered and valid app-usage processing.

`OptimizedAppUsageAlgorithm` is the single algorithm implementation used for app-usage pairing. The older baseline implementation is archived as `ArchivedBaselineAppUsageAlgorithm` for parity tests and is not imported by the production preprocessing path.

## Resulting Behavior

After the fix:

- screen, keyguard, notification, standby bucket, and other renamed raw interaction events are retained by default
- if a user explicitly selects interaction types for removal, those rows are removed deterministically except when they meet the configured long-gap threshold
- interaction dialogs reflect the real current settings
- threshold reset behavior matches the actual application defaults
- app-usage processing goes through one canonical orchestration path
- filtered-app usage now respects the same stop-event reuse setting as valid-app usage

## Verification

The updated modules were verified with:

- `python3 -m compileall -q src tests`
- `python3 -m pytest -q`
- `git diff --check`
