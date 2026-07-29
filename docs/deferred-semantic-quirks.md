# Deferred Semantic Quirks

These items are intentionally documented without changing behavior yet.
The current browser port mirrors the desktop output exactly on the validated
pathological fixture, including the quirks below.

## Quirks To Revisit

### ~~Filtered-app detail metrics use legacy null/sentinel arithmetic~~ (FIXED)

RESOLVED (both runtimes together): a `Filtered App Usage` row now keeps its
REAL `start_timestamp`/`stop_timestamp` through the engagement walk
(`_add_app_usage_detail_columns` / `addAppUsageDetailColumns`), so
`any_app_new_engage_*` and `any_app_usage_time_gap_hours` are computed from
real neighbour timing instead of the int64-min sentinel (which wrapped into
~-2.07e9-second gaps on rows adjacent to a filtered app). The timing is
blanked AFTER the walk — desktop `_clear_filtered_usage_timing`, web
`interval_cleaning` — so the final CSV still never carries junk timing, and
junk durations are nulled before the min-duration / zero-drop / flag steps.
Valid-app episodes are unchanged (junk-blind matcher). Also fixed alongside:
the web CSV float serializer no longer truncates sub-1e-4 values to 15
significant digits, and web `duration_minutes` uses the same reciprocal
multiply as polars — web↔desktop parity is now byte-exact with ZERO
documented residuals.

### `End of Usage Missing` start timestamps are asymmetric

Some `End of Usage Missing` rows retain a populated `start_timestamp`, while
others are blank.

Observed parity behavior:
- valid missing sessions generally retain the start timestamp
- filtered-app missing sessions do not
- some Android/system missing rows also end up blank

This appears to be legacy behavior rather than a clearly documented semantic rule.

### Screen timestamp formatting is historically inconsistent across columns

Current desktop-compatible output uses different string formats for different
screen columns:

- `event_timestamp`: `YYYY-MM-DD HH:MM:SS-06:00`
- `start_timestamp` / `stop_timestamp`: `YYYY-MM-DD HH:MM:SS.000000-06:00`
- `screen_usage_last_activity_timestamp`: `YYYY-MM-DDTHH:MM:SS.000000-0600`

This is now mirrored intentionally for parity, but it is not a particularly clean
contract.

### Numeric serialization follows desktop string conventions, not a normalized schema

Some numeric fields are emitted as:

- integer-looking floats with `.0`
- scientific notation for tiny values such as `3e-6`

This is currently preserved to keep deterministic parity with desktop CSV output.

## Current Decision

For now, parity wins over semantic cleanup. Any future cleanup should be treated
as an explicit contract decision and should update both runtimes together.
