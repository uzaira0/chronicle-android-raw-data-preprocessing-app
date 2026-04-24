# Deferred Semantic Quirks

These items are intentionally documented without changing behavior yet.
The current browser port mirrors the desktop output exactly on the validated
pathological fixture, including the quirks below.

## Quirks To Revisit

### Filtered-app detail metrics use legacy null/sentinel arithmetic

`Filtered App Usage` rows keep blank `start_timestamp`, `stop_timestamp`,
`duration_seconds`, and `duration_minutes` in the final CSV, but some derived
detail fields such as `any_app_new_engage_*` and
`any_app_usage_time_gap_hours` are still computed from the same legacy
sentinel/null behavior used by the desktop Polars path.

Effect:
- some filtered rows receive very large or otherwise non-obvious
  `any_app_usage_time_gap_hours` values
- those values are parity-correct today, but they are not obviously the cleanest
  semantic interpretation

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
