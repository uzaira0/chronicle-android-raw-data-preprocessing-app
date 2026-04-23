from __future__ import annotations

from random import Random

import pandas as pd
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms.archived_app_usage_algorithms import (
    ArchivedBaselineAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.algorithms import (
    OptimizedAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.app_usage_preprocessor import (
    AppUsagePreprocessor,
)
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import (
    TimestampPreprocessor,
)

SYSTEM_APPS = [
    "android",
    "com.android.systemui",
    "com.android.settings",
    "com.android.launcher3",
    "com.google.android.gms",
    "com.google.android.gsf",
    "com.amazon.device.software.ota",
    "com.amazon.kindle.otter",
    "com.amazon.firelauncher",
    "com.amazon.client.metrics",
    "com.samsung.android.app.telephonyui",
    "com.motorola.actions",
]

STORE_APPS = [
    "com.spotify.music",
    "com.netflix.mediaclient",
    "com.google.android.youtube",
    "com.roblox.client",
    "com.duolingo",
    "com.discord",
    "com.instagram.android",
    "com.snapchat.android",
    "com.tiktok.android",
    "com.reddit.frontpage",
    "com.amazon.mShop.android.shopping",
    "com.microsoft.teams",
    "com.google.android.apps.docs",
    "com.google.android.apps.maps",
    "com.google.android.apps.photos",
    "com.google.android.gm",
    "com.king.candycrushsaga",
    "com.mojang.minecraftpe",
    "com.quizlet.quizletandroid",
    "com.khanacademy.android",
    "com.nintendo.zara",
    "com.pinterest",
    "com.twitter.android",
    "com.whatsapp",
    "com.zhiliaoapp.musically",
    "org.wikipedia",
    "tv.twitch.android.app",
    "com.hulu.plus",
    "com.disney.disneyplus",
    "com.prodigygame.prodigy",
    "com.abcya.android.games",
    "com.brainpop.brainpopfeatured",
    "com.crunchyroll.crunchyroid",
    "com.epicbooks.android",
    "com.nick.android.nickjr",
    "com.pbs.pbskids.video",
]


def _row(
    timestamp: pd.Timestamp,
    interaction_type: InteractionType,
    package_name: str,
) -> dict[str, object]:
    return {
        Column.INTERACTION_TYPE: interaction_type,
        Column.APP_PACKAGE_NAME: package_name,
        Column.EVENT_TIMESTAMP: timestamp,
        Column.START_TIMESTAMP: pd.NaT,
        Column.STOP_TIMESTAMP: pd.NaT,
        Column.TIMEZONE: "America/Chicago",
    }


def _generated_multiweek_dst_stress_data(
    *, include_screen_usage_stress: bool = False,
) -> pd.DataFrame:
    """Generate deterministic app/system events spanning the 2026 spring DST shift."""
    rng = Random(20260308)
    rows: list[dict[str, object]] = []
    base = pd.Timestamp("2026-02-23 06:30:00", tz="America/Chicago")
    all_packages = SYSTEM_APPS + STORE_APPS
    all_event_types = list(InteractionType)

    # Ensure every known interaction type is present at least once.
    for index, interaction_type in enumerate(all_event_types):
        timestamp = base + pd.Timedelta(minutes=index * 17)
        package_name = all_packages[index % len(all_packages)]
        rows.append(_row(timestamp, interaction_type, package_name))

    for day in range(28):
        day_start = base + pd.Timedelta(days=day)

        if include_screen_usage_stress:
            manual_start = day_start + pd.Timedelta(minutes=5)
            rows.extend(
                [
                    _row(manual_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                    _row(
                        manual_start + pd.Timedelta(seconds=5),
                        InteractionType.ACTIVITY_RESUMED,
                        "com.screen.manual",
                    ),
                    _row(
                        manual_start + pd.Timedelta(seconds=20),
                        InteractionType.SCREEN_NON_INTERACTIVE,
                        "android",
                    ),
                ]
            )

            auto_start = day_start + pd.Timedelta(minutes=15)
            rows.extend(
                [
                    _row(auto_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                    _row(
                        auto_start + pd.Timedelta(seconds=1),
                        InteractionType.KEYGUARD_SHOWN,
                        "android",
                    ),
                    _row(
                        auto_start + pd.Timedelta(seconds=10),
                        InteractionType.KEYGUARD_HIDDEN,
                        "android",
                    ),
                    _row(
                        auto_start + pd.Timedelta(seconds=15),
                        InteractionType.ACTIVITY_RESUMED,
                        "com.screen.auto",
                    ),
                    _row(
                        auto_start + pd.Timedelta(seconds=135),
                        InteractionType.SCREEN_NON_INTERACTIVE,
                        "android",
                    ),
                ]
            )

            keep_awake_start = day_start + pd.Timedelta(minutes=25)
            rows.extend(
                [
                    _row(keep_awake_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                    _row(
                        keep_awake_start + pd.Timedelta(seconds=10),
                        InteractionType.ACTIVITY_RESUMED,
                        "com.screen.keepawake",
                    ),
                    _row(
                        keep_awake_start + pd.Timedelta(minutes=30, seconds=10),
                        InteractionType.SCREEN_NON_INTERACTIVE,
                        "android",
                    ),
                ]
            )

            lock_screen_start = day_start + pd.Timedelta(minutes=60)
            rows.extend(
                [
                    _row(lock_screen_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                    _row(
                        lock_screen_start + pd.Timedelta(seconds=1),
                        InteractionType.KEYGUARD_SHOWN,
                        "android",
                    ),
                    _row(
                        lock_screen_start + pd.Timedelta(seconds=20),
                        InteractionType.SCREEN_NON_INTERACTIVE,
                        "android",
                    ),
                ]
            )

            oem_start = day_start + pd.Timedelta(minutes=70)
            rows.extend(
                [
                    _row(
                        oem_start - pd.Timedelta(seconds=1),
                        InteractionType.KEYGUARD_SHOWN,
                        "android",
                    ),
                    _row(oem_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                    _row(
                        oem_start + pd.Timedelta(seconds=9),
                        InteractionType.KEYGUARD_HIDDEN,
                        "android",
                    ),
                    _row(
                        oem_start + pd.Timedelta(seconds=14),
                        InteractionType.ACTIVITY_RESUMED,
                        "com.screen.oem",
                    ),
                    _row(
                        oem_start + pd.Timedelta(seconds=134),
                        InteractionType.DEVICE_SCREEN_OFF,
                        "android",
                    ),
                ]
            )

            duplicate_start = day_start + pd.Timedelta(minutes=80)
            rows.extend(
                [
                    _row(duplicate_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                    _row(
                        duplicate_start + pd.Timedelta(seconds=1),
                        InteractionType.SCREEN_INTERACTIVE,
                        "android",
                    ),
                    _row(
                        duplicate_start + pd.Timedelta(seconds=5),
                        InteractionType.ACTIVITY_RESUMED,
                        "com.screen.duplicate",
                    ),
                    _row(
                        duplicate_start + pd.Timedelta(seconds=15),
                        InteractionType.SCREEN_NON_INTERACTIVE,
                        "android",
                    ),
                    _row(
                        duplicate_start + pd.Timedelta(seconds=16),
                        InteractionType.DEVICE_SCREEN_OFF,
                        "android",
                    ),
                ]
            )

        # Daily system noise: screen/keyguard/notification/device lifecycle rows.
        for offset, interaction_type in enumerate(
            [
                InteractionType.SCREEN_INTERACTIVE,
                InteractionType.KEYGUARD_HIDDEN,
                InteractionType.NOTIFICATION_RECEIVED,
                InteractionType.NOTIFICATION_SEEN,
                InteractionType.STANDBY_BUCKET_CHANGED,
                InteractionType.FOREGROUND_SERVICE_START,
                InteractionType.FOREGROUND_SERVICE_STOP,
            ]
        ):
            timestamp = day_start + pd.Timedelta(hours=offset + 1, minutes=rng.randrange(0, 45))
            rows.append(_row(timestamp, interaction_type, rng.choice(SYSTEM_APPS)))

        # Valid app usage sessions, including repeated resumes, missing stops,
        # same-time events, long gaps, and fallback Activity Stopped rows.
        for session in range(8):
            package_name = rng.choice(STORE_APPS)
            start = day_start + pd.Timedelta(
                hours=8 + session,
                minutes=rng.randrange(0, 50),
                seconds=rng.randrange(0, 60),
            )
            rows.append(_row(start, InteractionType.ACTIVITY_RESUMED, package_name))

            if session == 1:
                rows.append(_row(start, InteractionType.NOTIFICATION_INTERRUPTION, "android"))
            if session == 2:
                rows.append(
                    _row(
                        start + pd.Timedelta(minutes=1),
                        InteractionType.ACTIVITY_RESUMED,
                        package_name,
                    )
                )

            duration = pd.Timedelta(minutes=rng.randrange(2, 180), seconds=rng.randrange(0, 60))
            stop_time = start + duration
            mode = (day + session) % 6
            if mode == 0:
                rows.append(_row(stop_time, InteractionType.ACTIVITY_PAUSED, package_name))
            elif mode == 1:
                rows.append(_row(stop_time, InteractionType.ACTIVITY_STOPPED, package_name))
            elif mode == 2:
                rows.append(_row(stop_time, InteractionType.ACTIVITY_DESTROYED, package_name))
            elif mode == 3:
                rows.append(_row(stop_time, InteractionType.DEVICE_SHUTDOWN, "android"))
            elif mode == 4:
                other_package = rng.choice([app for app in STORE_APPS if app != package_name])
                rows.append(_row(stop_time, InteractionType.ACTIVITY_RESUMED, other_package))
            else:
                # Missing stop is intentional: it should become END_OF_USAGE_MISSING.
                rows.append(
                    _row(
                        stop_time + pd.Timedelta(hours=13),
                        InteractionType.SCREEN_NON_INTERACTIVE,
                        "android",
                    )
                )

        # Filtered-app sessions use their filtered event names but share the
        # same active algorithm via filtered-specific masks.
        for session in range(4):
            package_name = rng.choice(STORE_APPS)
            start = day_start + pd.Timedelta(
                hours=18 + session,
                minutes=rng.randrange(0, 50),
                seconds=rng.randrange(0, 60),
            )
            rows.append(_row(start, InteractionType.FILTERED_APP_RESUMED, package_name))
            stop_time = start + pd.Timedelta(minutes=rng.randrange(1, 90))
            mode = (day + session) % 4
            if mode == 0:
                rows.append(_row(stop_time, InteractionType.FILTERED_APP_PAUSED, package_name))
            elif mode == 1:
                rows.append(_row(stop_time, InteractionType.FILTERED_APP_STOPPED, package_name))
            elif mode == 2:
                rows.append(_row(stop_time, InteractionType.FILTERED_APP_DESTROYED, package_name))
            else:
                rows.append(_row(stop_time, InteractionType.DEVICE_SHUTDOWN, "android"))

    if include_screen_usage_stress:
        dst_start = pd.Timestamp("2026-03-08 01:55:00", tz="America/Chicago")
        rows.extend(
            [
                _row(dst_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                _row(
                    pd.Timestamp("2026-03-08 01:56:00", tz="America/Chicago"),
                    InteractionType.ACTIVITY_RESUMED,
                    "com.screen.dst",
                ),
                _row(
                    pd.Timestamp("2026-03-08 03:05:00", tz="America/Chicago"),
                    InteractionType.SCREEN_NON_INTERACTIVE,
                    "android",
                ),
            ]
        )

        missing_start = base + pd.Timedelta(days=28, hours=1)
        rows.extend(
            [
                _row(missing_start, InteractionType.SCREEN_INTERACTIVE, "android"),
                _row(
                    missing_start + pd.Timedelta(seconds=10),
                    InteractionType.ACTIVITY_RESUMED,
                    "com.screen.missing",
                ),
            ]
        )

    df = pd.DataFrame(rows).sort_values(Column.EVENT_TIMESTAMP, kind="mergesort").reset_index(
        drop=True
    )
    return df


def _run_algorithms_for_masks(
    df: pd.DataFrame,
    options: PreprocessingOptions,
    resumed_type: InteractionType,
    same_app_stop_types: set[InteractionType],
    other_stop_types: set[InteractionType],
    stopped_type: InteractionType,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    resumed_mask = df[Column.INTERACTION_TYPE] == resumed_type
    same_app_stop_mask = df[Column.INTERACTION_TYPE].isin(same_app_stop_types)
    other_stop_mask = df[Column.INTERACTION_TYPE].isin(other_stop_types)
    stopped_mask = df[Column.INTERACTION_TYPE] == stopped_type

    optimized_result = OptimizedAppUsageAlgorithm(options).process_app_usage(
        df, resumed_mask, same_app_stop_mask, other_stop_mask, stopped_mask
    )
    archived_result = ArchivedBaselineAppUsageAlgorithm(options).process_app_usage(
        df, resumed_mask, same_app_stop_mask, other_stop_mask, stopped_mask
    )
    return optimized_result, archived_result


def _semantic_options(**overrides: object) -> PreprocessingOptions:
    values = {
        "raw_data_folder": "",
        "use_app_codebook": False,
        "same_app_interaction_types_to_stop_usage_at": {InteractionType.ACTIVITY_PAUSED},
        "other_interaction_types_to_stop_usage_at": {InteractionType.DEVICE_SHUTDOWN},
        "long_duration_threshold_hours": 12,
        "use_activity_stopped_as_fallback": True,
        "apply_threshold_to_activity_stopped_fallback": True,
    }
    values.update(overrides)
    return PreprocessingOptions(**values)


def _semantic_frame(
    rows: list[tuple[str, InteractionType, str]],
) -> pd.DataFrame:
    return pd.DataFrame(
        [
            _row(pd.Timestamp(timestamp), interaction_type, package_name)
            for timestamp, interaction_type, package_name in rows
        ]
    )


def _optimized_valid_result(
    df: pd.DataFrame,
    options: PreprocessingOptions,
) -> pd.DataFrame:
    optimized_result, _ = _run_algorithms_for_masks(
        df,
        options,
        InteractionType.ACTIVITY_RESUMED,
        options.same_app_interaction_types_to_stop_usage_at,
        options.other_interaction_types_to_stop_usage_at,
        InteractionType.ACTIVITY_STOPPED,
    )
    return optimized_result


def _first_row(result: pd.DataFrame) -> pd.Series:
    return result.iloc[0]


def _app_usage_rows(result: pd.DataFrame) -> pd.DataFrame:
    return result[result[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE]


def _missing_usage_rows(result: pd.DataFrame) -> pd.DataFrame:
    return result[result[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING]


def test_optimized_algorithm_is_the_canonical_algorithm_name() -> None:
    options = PreprocessingOptions(raw_data_folder="", use_app_codebook=False)

    assert options.app_usage_algorithm == "optimized"
    assert ArchivedBaselineAppUsageAlgorithm is not OptimizedAppUsageAlgorithm


def test_archived_baseline_remains_available_for_parity_tests() -> None:
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        same_app_interaction_types_to_stop_usage_at={InteractionType.ACTIVITY_PAUSED},
        other_interaction_types_to_stop_usage_at={InteractionType.DEVICE_SHUTDOWN},
    )
    timestamps = pd.to_datetime(
        [
            "2026-01-01 00:00:00",
            "2026-01-01 00:01:00",
            "2026-01-01 00:02:00",
        ]
    )
    df = pd.DataFrame(
        {
            Column.INTERACTION_TYPE: [
                InteractionType.ACTIVITY_RESUMED,
                InteractionType.ACTIVITY_PAUSED,
                InteractionType.DEVICE_SHUTDOWN,
            ],
            Column.APP_PACKAGE_NAME: ["com.example.app", "com.example.app", "android"],
            Column.EVENT_TIMESTAMP: timestamps,
            Column.START_TIMESTAMP: [pd.NaT, pd.NaT, pd.NaT],
            Column.STOP_TIMESTAMP: [pd.NaT, pd.NaT, pd.NaT],
        }
    )
    resumed_mask = df[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED
    same_app_stop_mask = df[Column.INTERACTION_TYPE].isin(
        options.same_app_interaction_types_to_stop_usage_at
    )
    other_stop_mask = df[Column.INTERACTION_TYPE].isin(
        options.other_interaction_types_to_stop_usage_at
    )
    stopped_mask = df[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_STOPPED

    optimized_result = OptimizedAppUsageAlgorithm(options).process_app_usage(
        df, resumed_mask, same_app_stop_mask, other_stop_mask, stopped_mask
    )
    archived_result = ArchivedBaselineAppUsageAlgorithm(options).process_app_usage(
        df, resumed_mask, same_app_stop_mask, other_stop_mask, stopped_mask
    )

    pd.testing.assert_frame_equal(optimized_result, archived_result)


def test_filtered_app_usage_respects_stop_event_reuse_setting() -> None:
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        use_filter_file=True,
        allow_stop_event_reuse=False,
        same_app_interaction_types_to_stop_usage_at={InteractionType.ACTIVITY_PAUSED},
        other_interaction_types_to_stop_usage_at={InteractionType.DEVICE_SHUTDOWN},
    )
    preprocessor = AppUsagePreprocessor(options)
    timestamps = pd.to_datetime(
        [
            "2026-01-01 00:00:00",
            "2026-01-01 00:01:00",
            "2026-01-01 00:02:00",
            "2026-01-01 00:03:00",
        ]
    )
    df = pd.DataFrame(
        {
            Column.INTERACTION_TYPE: [
                InteractionType.FILTERED_APP_RESUMED,
                InteractionType.FILTERED_APP_RESUMED,
                InteractionType.FILTERED_APP_PAUSED,
                InteractionType.DEVICE_SHUTDOWN,
            ],
            Column.APP_PACKAGE_NAME: [
                "com.example.app",
                "com.example.app",
                "com.example.app",
                "android",
            ],
            Column.EVENT_TIMESTAMP: timestamps,
            Column.START_TIMESTAMP: [pd.NaT, pd.NaT, pd.NaT, pd.NaT],
            Column.STOP_TIMESTAMP: [pd.NaT, pd.NaT, pd.NaT, pd.NaT],
        }
    )

    result = preprocessor.process_filtered_app_usage(df)

    assert (
        result[Column.INTERACTION_TYPE].eq(InteractionType.FILTERED_APP_USAGE).sum()
        == 1
    )
    assert (
        result[Column.INTERACTION_TYPE].eq(InteractionType.END_OF_USAGE_MISSING).sum()
        == 1
    )


def test_disordered_timestamp_check_requires_timestamp_columns() -> None:
    df = pd.DataFrame({Column.INTERACTION_TYPE: [InteractionType.ACTIVITY_RESUMED]})

    with pytest.raises(ValueError, match="required columns are missing"):
        TimestampPreprocessor.check_for_disordered_timestamps(df)


@pytest.mark.parametrize("allow_stop_event_reuse", [False, True])
def test_archived_and_optimized_algorithms_match_on_multiweek_dst_stress_data(
    allow_stop_event_reuse: bool,
) -> None:
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        allow_stop_event_reuse=allow_stop_event_reuse,
        use_activity_stopped_as_fallback=True,
        apply_threshold_to_activity_stopped_fallback=True,
        long_duration_threshold_hours=12,
        same_app_interaction_types_to_stop_usage_at={
            InteractionType.ACTIVITY_PAUSED,
            InteractionType.ACTIVITY_STOPPED,
            InteractionType.ACTIVITY_DESTROYED,
        },
        other_interaction_types_to_stop_usage_at={
            InteractionType.ACTIVITY_RESUMED,
            InteractionType.FILTERED_APP_RESUMED,
            InteractionType.FILTERED_APP_USAGE,
            InteractionType.DEVICE_SHUTDOWN,
            InteractionType.USER_STOPPED,
        },
    )
    df = _generated_multiweek_dst_stress_data()

    assert set(InteractionType).issubset(set(df[Column.INTERACTION_TYPE]))
    assert df[Column.APP_PACKAGE_NAME].nunique() >= 36
    assert len({timestamp.utcoffset() for timestamp in df[Column.EVENT_TIMESTAMP]}) >= 2
    assert df[Column.EVENT_TIMESTAMP].is_monotonic_increasing

    valid_optimized, valid_archived = _run_algorithms_for_masks(
        df,
        options,
        InteractionType.ACTIVITY_RESUMED,
        options.same_app_interaction_types_to_stop_usage_at,
        options.other_interaction_types_to_stop_usage_at,
        InteractionType.ACTIVITY_STOPPED,
    )
    filtered_optimized, filtered_archived = _run_algorithms_for_masks(
        df,
        options,
        InteractionType.FILTERED_APP_RESUMED,
        options.filtered_same_app_interaction_types_to_stop_usage_at,
        options.filtered_other_interaction_types_to_stop_usage_at,
        InteractionType.FILTERED_APP_STOPPED,
    )

    pd.testing.assert_frame_equal(valid_optimized, valid_archived)
    pd.testing.assert_frame_equal(filtered_optimized, filtered_archived)


def test_only_same_app_stop_is_currently_marked_missing() -> None:
    options = _semantic_options()
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
        ]
    )

    result = _optimized_valid_result(df, options)
    row = _first_row(result)

    assert row[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING
    assert row[Column.START_TIMESTAMP] == pd.Timestamp("2026-01-01 00:00:00")
    assert pd.isna(row[Column.STOP_TIMESTAMP])


def test_only_other_app_stop_is_currently_marked_missing() -> None:
    options = _semantic_options()
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = _optimized_valid_result(df, options)
    row = _first_row(result)

    assert row[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING
    assert row[Column.START_TIMESTAMP] == pd.Timestamp("2026-01-01 00:00:00")
    assert pd.isna(row[Column.STOP_TIMESTAMP])


def test_activity_stopped_fallback_under_threshold_is_used_when_enabled() -> None:
    options = _semantic_options()
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_STOPPED, "com.example.app"),
        ]
    )

    result = _optimized_valid_result(df, options)
    row = _first_row(result)

    assert row[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED
    assert row[Column.STOP_TIMESTAMP] == pd.Timestamp("2026-01-01 00:05:00")


def test_activity_stopped_fallback_can_be_disabled_by_config() -> None:
    options = _semantic_options(use_activity_stopped_as_fallback=False)
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_STOPPED, "com.example.app"),
        ]
    )

    result = _optimized_valid_result(df, options)

    assert _first_row(result)[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING


def test_activity_stopped_fallback_over_threshold_is_missing_when_threshold_applied() -> None:
    options = _semantic_options(
        apply_threshold_to_activity_stopped_fallback=True,
        long_duration_threshold_hours=12,
    )
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 13:00:00", InteractionType.ACTIVITY_STOPPED, "com.example.app"),
        ]
    )

    result = _optimized_valid_result(df, options)

    assert _first_row(result)[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING


def test_activity_stopped_fallback_over_threshold_can_create_long_session_when_config_allows() -> None:
    options = _semantic_options(
        apply_threshold_to_activity_stopped_fallback=False,
        long_duration_threshold_hours=12,
    )
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-03 00:00:00", InteractionType.ACTIVITY_STOPPED, "com.example.app"),
        ]
    )

    result = _optimized_valid_result(df, options)
    row = _first_row(result)

    assert row[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED
    assert row[Column.STOP_TIMESTAMP] == pd.Timestamp("2026-01-03 00:00:00")


def test_exact_threshold_duration_is_treated_as_missing() -> None:
    options = _semantic_options(long_duration_threshold_hours=12)
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 12:00:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 13:00:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = _optimized_valid_result(df, options)

    assert _first_row(result)[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING


def test_stop_reuse_enabled_allows_overlapping_sessions_sharing_same_stop() -> None:
    options = _semantic_options(allow_stop_event_reuse=True)
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:01:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 00:06:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = _optimized_valid_result(df, options)

    assert result.loc[[0, 1], Column.STOP_TIMESTAMP].tolist() == [
        pd.Timestamp("2026-01-01 00:05:00"),
        pd.Timestamp("2026-01-01 00:05:00"),
    ]
    assert not result.loc[[0, 1], Column.INTERACTION_TYPE].eq(
        InteractionType.END_OF_USAGE_MISSING
    ).any()


def test_stop_reuse_disabled_marks_second_resume_missing_after_first_consumes_stop() -> None:
    options = _semantic_options(allow_stop_event_reuse=False)
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:01:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 00:06:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = _optimized_valid_result(df, options)

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp("2026-01-01 00:05:00")
    assert result.loc[1, Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING
    assert pd.isna(result.loc[1, Column.STOP_TIMESTAMP])


def test_unsorted_input_can_pair_to_earlier_timestamp_and_preprocessor_rejects_it() -> None:
    options = _semantic_options()
    df = _semantic_frame(
        [
            ("2026-01-01 10:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 09:00:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 11:00:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = _optimized_valid_result(df, options)

    assert result.loc[0, Column.STOP_TIMESTAMP] < result.loc[0, Column.START_TIMESTAMP]
    with pytest.raises(ValueError, match="start timestamp being later than the stop timestamp"):
        AppUsagePreprocessor(options).process_valid_app_usage(df)


def test_equal_timestamp_stop_candidates_remain_separate_reuse_candidates() -> None:
    options = _semantic_options(allow_stop_event_reuse=False)
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:01:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.DEVICE_SHUTDOWN, "android"),
            ("2026-01-01 00:07:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 00:08:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = _optimized_valid_result(df, options)

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp("2026-01-01 00:05:00")
    assert result.loc[1, Column.STOP_TIMESTAMP] == pd.Timestamp("2026-01-01 00:05:00")


def test_filtered_before_valid_processing_can_turn_filtered_usage_into_valid_other_stop() -> None:
    options = _semantic_options(
        use_filter_file=True,
        other_interaction_types_to_stop_usage_at={
            InteractionType.FILTERED_APP_USAGE,
            InteractionType.DEVICE_SHUTDOWN,
        },
    )
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.valid"),
            ("2026-01-01 00:01:00", InteractionType.FILTERED_APP_RESUMED, "com.example.filtered"),
            ("2026-01-01 00:02:00", InteractionType.FILTERED_APP_PAUSED, "com.example.filtered"),
            ("2026-01-01 00:04:00", InteractionType.DEVICE_SHUTDOWN, "android"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.valid"),
        ]
    )

    result = AppUsagePreprocessor(options).run_app_usage_algorithm(df)
    app_usage = _app_usage_rows(result).iloc[0]

    assert app_usage[Column.START_TIMESTAMP] == pd.Timestamp("2026-01-01 00:00:00")
    assert app_usage[Column.STOP_TIMESTAMP] == pd.Timestamp("2026-01-01 00:01:00")
    assert (
        result[Column.INTERACTION_TYPE].eq(InteractionType.FILTERED_APP_USAGE).sum()
        == 1
    )


def test_end_of_usage_missing_rows_survive_valid_preprocessor_cleanup() -> None:
    options = _semantic_options()
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
        ]
    )

    result = AppUsagePreprocessor(options).process_valid_app_usage(df)
    missing_rows = _missing_usage_rows(result)

    assert len(missing_rows) == 1
    assert missing_rows.iloc[0][Column.START_TIMESTAMP] == pd.Timestamp("2026-01-01 00:00:00")
    assert pd.isna(missing_rows.iloc[0][Column.STOP_TIMESTAMP])


def test_minimum_usage_duration_nulls_short_duration_but_does_not_drop_row() -> None:
    options = _semantic_options(minimum_usage_duration=60)
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:00:30", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 00:02:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = AppUsagePreprocessor(options).process_valid_app_usage(df)
    app_usage = _app_usage_rows(result)

    assert len(app_usage) == 1
    assert pd.isna(app_usage.iloc[0][Column.DURATION_SECONDS])
    assert pd.isna(app_usage.iloc[0][Column.DURATION_MINUTES])


def test_zero_duration_sessions_are_dropped_when_config_enabled() -> None:
    options = _semantic_options(
        filter_zero_duration_sessions=True,
        minimum_usage_duration=0,
    )
    df = _semantic_frame(
        [
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
            ("2026-01-01 00:00:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ("2026-01-01 00:01:00", InteractionType.DEVICE_SHUTDOWN, "android"),
        ]
    )

    result = AppUsagePreprocessor(options).process_valid_app_usage(df)

    assert _app_usage_rows(result).empty
