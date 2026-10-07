# App Usage Semantic Decisions

This matrix separates settled semantic requirements from choices that are still
policy/configuration decisions. The archived baseline algorithm is for parity
comparison only; production behavior should be defined by this matrix.

## Settled

- A same-app stop event should close the session even when no other stop class is
  present. Example: `A Resumed -> A Paused` closes A at `A Paused`.
- An other-app foreground event should close the previous app when the previous
  app has no same-app stop. Example: `A Resumed -> B Resumed` closes A at B's
  resume.
- When multiple valid stop candidates exist, choose the earliest valid timestamp
  under the configured duration threshold.
- When stop reuse is disabled and multiple starts compete for one stop, assign
  that stop to the nearest preceding compatible open start. Older starts remain
  open until another valid stop, file end, or missing-stop handling.
- `Activity Stopped` is a fallback stop candidate, not a reason to fabricate
  arbitrarily long sessions. With threshold enforcement enabled, over-threshold
  fallback stops should produce `End of Usage Missing`.
- End of file should close an open session at the last event timestamp in that
  file. This uses observed data within the file, not a calendar boundary.
- Internal study-boundary closure should behave like file-end closure when an
  internal pipeline applies externally configured study start/end dates. This is
  not an end-user app setting and should not appear in the public GUI.
- Day boundaries should not close sessions. A session can cross midnight if the
  file contains evidence that it continued.
- `Device Shutdown` should be a default app-usage stop candidate.
- A filtered-app foreground switch should stop the previous valid app session.
  The user clearly switched away from the valid app, even if the destination app
  is filtered out of valid-app analysis.
- A configured duration threshold should include the exact boundary. A 12-hour
  threshold should allow a 12-hour session unless the config explicitly says
  otherwise.
- Missing stops should remain diagnostic rows with `stop_timestamp` and duration
  empty only when there is no file-end closure timestamp available. The algorithm
  must not extend them to day end, study end, or a later multi-day event
  implicitly.
- App usage and screen usage are separate outputs. Screen-only mode should not
  run app-usage flags/details, and app+screen mode should write two files.
- Duration across DST should mean elapsed real time after timezone normalization,
  not naive wall-clock subtraction.
- Cross-file matching is not supported. Each raw file is a closed processing
  unit, and file end closes open sessions.
- App-session matching does not add participant/device grouping. End-user raw
  file processing assumes one file stream; callers that provide dataframe inputs
  are responsible for not mixing unrelated streams before preprocessing.
- Duplicate event timestamps already have an established priority when duplicate
  correction is enabled: exact duplicate rows are dropped, `Activity Resumed`
  sorts before neutral events, and configured stop events sort last. Events with
  the same priority keep their original relative order.

## Ambiguous Or Policy-Driven

- None for core app-usage pairing semantics at this point.

## Output Or Analysis Policy

- Whether below-minimum-duration sessions should be dropped, retained with null
  duration, or retained with a flag.
- Whether filtered-app usage should be emitted with full duration/detail columns
  or only used as stop evidence for valid app usage.

## Not Default Stops Unless Explicitly Configured

- Screen-off/keyguard events should not become default app-usage stop events
  without separate validation. They can still be selected in advanced interaction
  type configuration if a study wants that behavior.

## Arbitrary Defaults

- The default long-duration threshold is 12 hours.
- The screen auto-lock default is 120 seconds.
- The manual-lock and auto-lock tolerance windows are heuristic defaults.
- The keep-awake app list is intentionally data/config driven, not hardcoded.

## Default Changes That Move Output

- **2026-08-27, contract v4, settings schema v13 — `timezone_handling` default is now
  `selected-convert`, was `selected-filter`.** A file whose rows carry more than one
  timezone previously had the non-matching rows dropped by default; they are now
  converted to the selected zone and kept, so day attribution is on one clock and no
  row is lost for carrying a different timezone. This is what the studies' locked
  preprocessing configuration has always run, and it is what the kernel has always
  used for an absent key — the old contract default disagreed with both.
  Effect on an existing user: a v12+ persisted setting or a share link that names
  `selected-filter` was a deliberate choice and is preserved verbatim; a save that
  never named the key (schema v12 stores only the diff from defaults) adopts the new
  behaviour on next load. A pre-v12 save stored the full option set, so its
  `selected-filter` is the default of the day, not a choice: on its first read it
  adopts `selected-convert` like the other superseded defaults. (A pre-v12 save that
  a v13–v15 build already rewrote keeps `selected-filter`; that rewrite left it
  indistinguishable from a choice.) A study that must reproduce pre-v4 output has to select
  `selected-filter` explicitly. Single-timezone data is unaffected either way.
