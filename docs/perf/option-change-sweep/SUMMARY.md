# Per-option warm change cost — 100,004-row synthetic fixture

Measured 2026-08-28 on the RHEL 9 host (single Node 24 process, committed runtime WASM,
fixture: fixtures/synthetic-100k.csv, 100,004 rows / 19,018,650 bytes — the exact scale
docs/perf/BASELINE.md names). Warm loop mirrors benchmark_runtime_wasm.mts (stable
workspaceId + previousRoot threading) plus the scientific_preflight_json call the
production worker makes per request. Base = app defaults + America/Chicago selected-filter,
support files off, concurrent usage + screen-gated crediting + aggregates on.

## Anchors

| Run | Wall time |
|---|---:|
| Cold first run (nothing cached) | 9.2 s |
| Warm re-run, nothing changed (all 55 active queries cached) | 5.6 s |
| Warm re-run, processAppUsage off | 0.9 s |

The ~5.6 s cached floor is envelope, not recompute: it tracks output volume (app CSV
rebuild/serialization) — with app usage off it collapses to 0.9 s, and with the
row-dropping parry_toth_7 retention set the changed run (4.7 s) lands BELOW the floor.
Warm scientific preflight is ~90–140 ms of each figure (1.0 s cold).

## Per-option measurements (one changed setting from the warm default base)

The `sessionGroupingPolicy` row was measured on an arm that has since been removed from
this copy, so its row (and its `results.json` entry) were dropped rather than re-measured.
The three session-grouping extension rows below change one setting from the default base,
where no grouping policy is selected.

| Option | Changed to | Wall | Recomputed queries (of 55 active) |
|---|---|---:|---:|
| processAppUsage | false | 0.9 s | 1 |
| processScreenUsage | false | 6.4 s | 1 |
| eventRetentionSet | parrytoth7 | 4.7 s | 30 |
| openerSet | resumedonly | 7.2 s | 4 |
| episodeReconstructionStrategy | forward | 6.3 s | 28 |
| microUseClassificationPolicy | okoshilt5s | 7.6 s | 26 |
| allowStopEventReuse | true | 7.7 s | 28 |
| useActivityStoppedAsFallback | false | 7.1 s | 28 |
| applyThresholdToFallback | false | 7.8 s | 28 |
| longDurationThresholdHours | h1 | 7.4 s | 28 |
| longDurationThresholdHoursExplicit | true | 7.1 s | 1 |
| maximumDurationPolicy | strategynative | 7.2 s | 2 |
| maximumDurationDisposition | notapplicable | 6.2 s | 2 |
| maximumDurationThresholdSource | strategynative | 6.2 s | 2 |
| maximumDurationThresholdNs | ns1 | 7.7 s | 26 |
| correctDuplicateEventTimestamps | false | 7.9 s | 40 |
| deduplicateExactRows | false | 8.3 s | 42 |
| timezoneHandling | selected_convert | 7.6 s | 15 |
| dayBoundaryAttribution | splitmidnight | 7.3 s | 3 |
| packageExclusionPreset | honorfilterflag | 7.3 s | 1 |
| includeCategoryColumn | true | 7.2 s | 1 |
| includeAppUsageEndReason | false | 7.2 s | 1 |
| enableAggregates | false | 6.9 s | 1 |
| aggregateShape | long | 7.3 s | 1 |
| enableParticipantAmountSummary | true | 7.2 s | 1 |
| enableParquetExport | true | 6.4 s | 0 |
| enableSpssExport | true | 6.4 s | 0 |
| minimumUsageDuration | s0 | 7.3 s | 26 |
| minimumDurationComparator | inclusivele | 8.1 s | 26 |
| minimumDurationDisposition | retaincredit | 7.5 s | 26 |
| filterZeroDurationSessions | true | 7.5 s | 3 |
| intervalQualityPolicy | culverhouse | 7.6 s | 17 |
| sessionGapBasis | runningmaxstop | 7.4 s | 2 |
| sessionBoundaryScope | participantstudy | 7.4 s | 2 |
| emitSessionBreakLineage | true | 7.3 s | 2 |
| customAppEngagementDuration | s0 | 7.5 s | 19 |
| longUsageDurationThresholds | empty | 7.4 s | 18 |
| longDataTimeGapThresholds | empty | 7.5 s | 18 |
| screenUsageAutoLockTimeoutSeconds | s0 | 7.9 s | 3 |
| screenUsageAutoLockToleranceSeconds | s0 | 7.1 s | 2 |
| screenUsageManualLockMaxTailGapSeconds | s0 | 9.4 s | 2 |
| screenUsageKeyguardNearStopSeconds | s0 | 9.1 s | 2 |
| sameAppInteractionTypesToStopUsageAt | empty | 7.3 s | 40 |
| otherInteractionTypesToStopUsageAt | empty | 7.6 s | 3 |
| modelConcurrentUsage | false | 7.7 s | 29 |
| applyMinimumUsageDurationToConcurrentSubintervals | true | 7.4 s | 23 |
| interactionTypesToRemove | usage_stat | 7.3 s | 16 |
| interactionTypeRemap | custom | 9.2 s | 50 |
| proximityIntervalSeconds | s0 | 8.2 s | 28 |
| addNoActivityPlaceholderDays | true | 7.9 s | 2 |
| enableScreenGatedCrediting | false | 5.2 s | 1 |
| screenGatingRule | screenonly | 8.1 s | 2 |
| creditedSessionCapMinutes | m0 | 6.5 s | 4 |
| deviceLivenessGapToleranceMinutes | m0 | 6.5 s | 4 |
| autoLockBridgeSeconds | s0 | 8.1 s | 4 |
| noWitnessMinDayApps | n0 | 8.3 s | 4 |
| notificationProxyRule | seencontact | 8.1 s | 5 |
| polledEmulationMethod | rosssampledgap | 22.3 s | 5 |
| polledEmulationIntervalSeconds | cadence5s | 8 s | 1 |
| polledEmulationGapSeconds | gap0s | 8 s | 1 |
| enableComplianceScoring | true | 8 s | 4 |
| complianceThresholdPercent | p0 | 7.9 s | 1 |
| enableDayCoverage | true | 8.1 s | 2 |

## Not measurable warm

- screenSessionConstructionStrategy (both non-default arms): the warm path refuses with
  scientific_preflight_retry_required (a strategy change moves the B05 preflight identity);
  the app falls back to a full raw re-run ≈ cold cost (~9 s here).
- useFilterFile / useAppsForcingScreenOpenFile / useBackgroundAppsFile / useAppCodebook /
  enableStudyWindowFilter / enablePersonAttribution: refused without their support file
  bound (unresolved binding holes) — this harness supplies none.
- selectedTimezone: the fixture is single-timezone (America/Chicago); any other selection
  filters away every row and the runtime refuses.

## Reading the numbers

Run-to-run noise on this host is ±1 s (restore runs of the identical base configuration
ranged 5.8–9.6 s), so most options are statistically indistinguishable: virtually every
change costs floor + 0.5–2.5 s ≈ 6–8 s here. The stable signal is the recompute-breadth
column. Distinguishable outliers: polledEmulationMethod first activation (22 s), the
interaction-type surface (remap/dedup/same-app list: 40–50 queries recomputed, 8–9 s),
processAppUsage off (0.9 s), eventRetentionSet parry_toth_7 (4.7 s, smaller outputs).

Hardware anchor: BASELINE.md measured the same-scale warm option change at 0.83–0.85 s
end-to-end on an Apple M3 Ultra (2026-07-26, earlier runtime). The tier structure
(envelope-dominated floor; narrow vs broad recompute; the polled-emulation outlier) is
hardware-independent; absolute times scale with the machine.
