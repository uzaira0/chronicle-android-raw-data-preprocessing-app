"""Deterministic pathological raw-data fixture generation for Chronicle tests and benches."""

from __future__ import annotations

import csv
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from random import Random
from zoneinfo import ZoneInfo

import polars as pl

from chronicle_preprocessing_app.config.constants import (
    AMAZON_APPS,
    TARGET_CHILD_USERNAME,
    ChronicleDeviceType,
    Column,
    InteractionType,
    TimezoneHandlingOption,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

RAW_COLUMNS = [
    Column.STUDY_ID,
    Column.PARTICIPANT_ID,
    Column.POSSIBLE_DEVICE_MODEL,
    Column.USERNAME,
    Column.APPLICATION_LABEL,
    Column.INTERACTION_TYPE,
    Column.APP_PACKAGE_NAME,
    Column.EVENT_TIMESTAMP,
    Column.START_TIMESTAMP,
    Column.STOP_TIMESTAMP,
    Column.TIMEZONE,
]

SYSTEM_APPS = (
    "android",
    "com.android.systemui",
    "com.android.settings",
    "com.google.android.gms",
    "com.amazon.firelauncher",
)
STORE_APPS = (
    "com.spotify.music",
    "com.netflix.mediaclient",
    "com.google.android.youtube",
    "com.roblox.client",
    "com.duolingo",
    "com.discord",
    "com.whatsapp",
    "com.instagram.android",
    "com.snapchat.android",
    "com.amazon.kindle",
    "com.google.android.apps.maps",
    "com.microsoft.teams",
)
FILTERED_APPS = (
    "com.filtered.reader",
    "com.filtered.camera",
)
TIMEZONES = (
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "UTC",
)
APPS_FORCING_SCREEN_OPEN = {
    "com.google.android.youtube": "YouTube",
    "com.google.android.apps.maps": "Maps",
}


@dataclass(frozen=True)
class FixtureBuildConfig:
    study_id: str = "pathological_study"
    participant_id: str = "P0001"
    possible_device_model: str = ChronicleDeviceType.ANDROID.value
    username: str = TARGET_CHILD_USERNAME
    weeks: int = 6
    seed: int = 20260423


def _label_for_package(package_name: str) -> str:
    known = {
        "android": "Android System",
        "com.android.systemui": "System UI",
        "com.android.settings": "Settings",
        "com.google.android.gms": "Google Play Services",
        "com.amazon.firelauncher": "Amazon Fire Launcher",
        "com.spotify.music": "Spotify",
        "com.netflix.mediaclient": "Netflix",
        "com.google.android.youtube": "YouTube",
        "com.roblox.client": "Roblox",
        "com.duolingo": "Duolingo",
        "com.discord": "Discord",
        "com.whatsapp": "WhatsApp",
        "com.instagram.android": "Instagram",
        "com.snapchat.android": "Snapchat",
        "com.amazon.kindle": "Kindle",
        "com.google.android.apps.maps": "Google Maps",
        "com.microsoft.teams": "Teams",
        "com.filtered.reader": "Filtered Reader",
        "com.filtered.camera": "Filtered Camera",
    }
    if package_name in known:
        return known[package_name]
    return package_name.rsplit(".", 1)[-1].replace("_", " ").title() or package_name


def _serialize_timestamp(value: datetime, *, explicit_offset: bool) -> str:
    if explicit_offset:
        return value.isoformat(timespec="seconds")
    if value.tzinfo is not None:
        value = value.replace(tzinfo=None)
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _parse_timestamp_text(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _permuted_package(package_name: str, file_index: int, repetition_index: int) -> str:
    if (
        package_name in SYSTEM_APPS
        or package_name in FILTERED_APPS
        or package_name in APPS_FORCING_SCREEN_OPEN
        or package_name in AMAZON_APPS
    ):
        return package_name
    suffix = (file_index * 101) + (repetition_index * 17)
    return f"{package_name}.v{suffix:03d}"


def _raw_row(
    *,
    config: FixtureBuildConfig,
    interaction_type: InteractionType,
    package_name: str,
    timestamp: datetime,
    timezone_name: str,
    explicit_offset: bool,
    application_label: str | None = None,
) -> dict[str, str]:
    return {
        Column.STUDY_ID: config.study_id,
        Column.PARTICIPANT_ID: config.participant_id,
        Column.POSSIBLE_DEVICE_MODEL: config.possible_device_model,
        Column.USERNAME: config.username,
        Column.APPLICATION_LABEL: application_label or _label_for_package(package_name),
        Column.INTERACTION_TYPE: str(interaction_type),
        Column.APP_PACKAGE_NAME: package_name,
        Column.EVENT_TIMESTAMP: _serialize_timestamp(timestamp, explicit_offset=explicit_offset),
        Column.START_TIMESTAMP: "",
        Column.STOP_TIMESTAMP: "",
        Column.TIMEZONE: timezone_name,
    }


def build_pathological_raw_block(
    *,
    config: FixtureBuildConfig | None = None,
) -> list[dict[str, str]]:
    config = config or FixtureBuildConfig()
    rng = Random(config.seed)
    rows: list[dict[str, str]] = []

    def add_row(
        interaction_type: InteractionType,
        package_name: str,
        timestamp: datetime,
        timezone_name: str,
        *,
        explicit_offset: bool = False,
        duplicates: int = 1,
        application_label: str | None = None,
    ) -> None:
        row = _raw_row(
            config=config,
            interaction_type=interaction_type,
            package_name=package_name,
            timestamp=timestamp,
            timezone_name=timezone_name,
            explicit_offset=explicit_offset,
            application_label=application_label,
        )
        for _ in range(duplicates):
            rows.append(dict(row))

    for week in range(config.weeks):
        week_anchor = datetime(2026, 2, 16, 6, 0, tzinfo=ZoneInfo("America/Chicago")) + timedelta(
            weeks=week
        )
        primary_timezone = TIMEZONES[week % len(TIMEZONES)]
        primary_zoneinfo = ZoneInfo(primary_timezone)
        day_anchor = week_anchor.astimezone(primary_zoneinfo)

        for day in range(7):
            base = (day_anchor + timedelta(days=day)).replace(hour=6, minute=0, second=0)
            valid_app = STORE_APPS[(week * 7 + day) % len(STORE_APPS)]
            alt_app = STORE_APPS[(week * 7 + day + 3) % len(STORE_APPS)]
            filtered_app = FILTERED_APPS[(week + day) % len(FILTERED_APPS)]
            apps_forcing_screen_open_app = tuple(APPS_FORCING_SCREEN_OPEN)[
                (week + day) % len(APPS_FORCING_SCREEN_OPEN)
            ]

            duplicate_ts = base + timedelta(minutes=15)
            duplicate_cluster = [
                (InteractionType.ACTIVITY_PAUSED, valid_app),
                (InteractionType.ACTIVITY_RESUMED, valid_app),
                (InteractionType.NOTIFICATION_SEEN, "android"),
                (InteractionType.KEYGUARD_SHOWN, "com.android.systemui"),
                (InteractionType.FILTERED_APP_RESUMED, filtered_app),
            ]
            rng.shuffle(duplicate_cluster)
            for interaction_type, package_name in duplicate_cluster:
                add_row(interaction_type, package_name, duplicate_ts, primary_timezone)
            add_row(
                InteractionType.NOTIFICATION_SEEN,
                "android",
                duplicate_ts,
                primary_timezone,
                duplicates=2,
            )

            add_row(
                InteractionType.ACTIVITY_RESUMED,
                valid_app,
                base + timedelta(minutes=30),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_RESUMED,
                valid_app,
                base + timedelta(minutes=31),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_PAUSED,
                valid_app,
                base + timedelta(minutes=35),
                primary_timezone,
            )

            add_row(
                InteractionType.ACTIVITY_RESUMED,
                valid_app,
                base + timedelta(minutes=45),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_RESUMED,
                alt_app,
                base + timedelta(minutes=49),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_PAUSED,
                alt_app,
                base + timedelta(minutes=52),
                primary_timezone,
            )

            add_row(
                InteractionType.ACTIVITY_RESUMED,
                STORE_APPS[(week + day + 5) % len(STORE_APPS)],
                base + timedelta(hours=1, minutes=5),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_STOPPED,
                STORE_APPS[(week + day + 5) % len(STORE_APPS)],
                base + timedelta(hours=1, minutes=50),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_RESUMED,
                STORE_APPS[(week + day + 6) % len(STORE_APPS)],
                base + timedelta(hours=2),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_STOPPED,
                STORE_APPS[(week + day + 6) % len(STORE_APPS)],
                base + timedelta(hours=16, minutes=30),
                primary_timezone,
            )

            add_row(
                InteractionType.ACTIVITY_RESUMED,
                valid_app,
                base + timedelta(hours=3),
                primary_timezone,
            )
            add_row(
                InteractionType.FILTERED_APP_RESUMED,
                filtered_app,
                base + timedelta(hours=3, minutes=2),
                primary_timezone,
            )
            add_row(
                InteractionType.FILTERED_APP_PAUSED,
                filtered_app,
                base + timedelta(hours=3, minutes=8),
                primary_timezone,
            )
            add_row(
                InteractionType.FILTERED_APP_USAGE,
                filtered_app,
                base + timedelta(hours=3, minutes=8, seconds=5),
                primary_timezone,
            )

            add_row(
                InteractionType.ACTIVITY_RESUMED,
                alt_app,
                base + timedelta(hours=4),
                primary_timezone,
            )
            add_row(
                InteractionType.USER_STOPPED,
                "android",
                base + timedelta(hours=4, minutes=4),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_RESUMED,
                STORE_APPS[(week + day + 7) % len(STORE_APPS)],
                base + timedelta(hours=4, minutes=30),
                primary_timezone,
            )
            add_row(
                InteractionType.DEVICE_SHUTDOWN,
                "android",
                base + timedelta(hours=4, minutes=33),
                primary_timezone,
            )
            add_row(
                InteractionType.DEVICE_STARTUP,
                "android",
                base + timedelta(hours=4, minutes=40),
                primary_timezone,
            )
            add_row(
                InteractionType.USER_UNLOCKED,
                "android",
                base + timedelta(hours=4, minutes=41),
                primary_timezone,
            )

            add_row(
                InteractionType.SCREEN_INTERACTIVE,
                "android",
                base + timedelta(hours=6),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_RESUMED,
                valid_app,
                base + timedelta(hours=6, seconds=5),
                primary_timezone,
            )
            add_row(
                InteractionType.SCREEN_NON_INTERACTIVE,
                "android",
                base + timedelta(hours=6, seconds=20),
                primary_timezone,
            )

            add_row(
                InteractionType.SCREEN_INTERACTIVE,
                "android",
                base + timedelta(hours=7),
                primary_timezone,
            )
            add_row(
                InteractionType.KEYGUARD_SHOWN,
                "android",
                base + timedelta(hours=7, seconds=1),
                primary_timezone,
                duplicates=2,
            )
            add_row(
                InteractionType.KEYGUARD_HIDDEN,
                "android",
                base + timedelta(hours=7, seconds=10),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_RESUMED,
                alt_app,
                base + timedelta(hours=7, seconds=15),
                primary_timezone,
            )
            add_row(
                InteractionType.SCREEN_NON_INTERACTIVE,
                "android",
                base + timedelta(hours=7, minutes=2, seconds=15),
                primary_timezone,
            )

            add_row(
                InteractionType.SCREEN_INTERACTIVE,
                "android",
                base + timedelta(hours=8),
                primary_timezone,
            )
            add_row(
                InteractionType.ACTIVITY_RESUMED,
                apps_forcing_screen_open_app,
                base + timedelta(hours=8, seconds=10),
                primary_timezone,
            )
            add_row(
                InteractionType.SCREEN_NON_INTERACTIVE,
                "android",
                base + timedelta(hours=8, minutes=30, seconds=10),
                primary_timezone,
            )

            add_row(
                InteractionType.SCREEN_INTERACTIVE,
                "android",
                base + timedelta(hours=9),
                primary_timezone,
            )
            add_row(
                InteractionType.KEYGUARD_SHOWN,
                "android",
                base + timedelta(hours=9, seconds=1),
                primary_timezone,
            )
            add_row(
                InteractionType.SCREEN_NON_INTERACTIVE,
                "android",
                base + timedelta(hours=9, seconds=20),
                primary_timezone,
            )

            add_row(
                InteractionType.ACTIVITY_RESUMED,
                STORE_APPS[(week + day + 8) % len(STORE_APPS)],
                base + timedelta(hours=10, minutes=50),
                primary_timezone,
            )

            noise_anchor = base + timedelta(hours=11)
            for offset, interaction_type in enumerate(
                (
                    InteractionType.SYSTEM_INTERACTION,
                    InteractionType.USER_INTERACTION,
                    InteractionType.NOTIFICATION_RECEIVED,
                    InteractionType.NOTIFICATION_REMOVED,
                    InteractionType.NOTIFICATION_INTERRUPTION,
                    InteractionType.STANDBY_BUCKET_CHANGED,
                    InteractionType.CONFIGURATION_CHANGE,
                    InteractionType.APP_COMPONENT_USED,
                    InteractionType.LOCUS_ID_SET,
                    InteractionType.FOREGROUND_SERVICE_START,
                    InteractionType.CONTINUING_FOREGROUND_SERVICE,
                    InteractionType.ROLLOVER_FOREGROUND_SERVICE,
                    InteractionType.FOREGROUND_SERVICE_STOP,
                    InteractionType.FLUSH_TO_DISK,
                    InteractionType.SHORTCUT_INVOCATION,
                    InteractionType.CHOOSER_ACTION,
                    InteractionType.APP_LAUNCH,
                    InteractionType.SLICE_PINNED_APP,
                    InteractionType.SLICE_PINNED_PRIV,
                )
            ):
                package_name = (
                    STORE_APPS[(week + day + offset) % len(STORE_APPS)] if offset % 3 else "android"
                )
                add_row(
                    interaction_type,
                    package_name,
                    noise_anchor + timedelta(seconds=offset),
                    primary_timezone,
                )

        parade_anchor = week_anchor + timedelta(days=7, hours=2)
        for offset, interaction_type in enumerate(InteractionType):
            timezone_name = TIMEZONES[offset % len(TIMEZONES)]
            timestamp = parade_anchor.astimezone(ZoneInfo(timezone_name)) + timedelta(
                seconds=offset
            )
            explicit_offset = (
                interaction_type
                in {
                    InteractionType.SCREEN_INTERACTIVE,
                    InteractionType.SCREEN_NON_INTERACTIVE,
                    InteractionType.KEYGUARD_SHOWN,
                    InteractionType.KEYGUARD_HIDDEN,
                    InteractionType.ACTIVITY_STOPPED,
                    InteractionType.FILTERED_APP_USAGE,
                }
                or timezone_name != "America/Chicago"
            )
            package_name = (
                FILTERED_APPS[offset % len(FILTERED_APPS)]
                if "Filtered" in str(interaction_type)
                else (
                    tuple(APPS_FORCING_SCREEN_OPEN)[offset % len(APPS_FORCING_SCREEN_OPEN)]
                    if "Screen" in str(interaction_type)
                    else (STORE_APPS[offset % len(STORE_APPS)] if offset % 2 else "android")
                )
            )
            add_row(
                interaction_type,
                package_name,
                timestamp,
                timezone_name,
                explicit_offset=explicit_offset,
            )

    spring_zone = ZoneInfo("America/Chicago")
    add_row(
        InteractionType.ACTIVITY_RESUMED,
        "com.dst.spring",
        datetime(2026, 3, 8, 1, 55, tzinfo=spring_zone),
        "America/Chicago",
        explicit_offset=True,
    )
    add_row(
        InteractionType.ACTIVITY_PAUSED,
        "com.dst.spring",
        datetime(2026, 3, 8, 3, 5, tzinfo=spring_zone),
        "America/Chicago",
        explicit_offset=True,
    )

    fall_before = datetime.fromisoformat("2026-11-01 01:15:00-05:00")
    fall_after = datetime.fromisoformat("2026-11-01 01:10:00-06:00")
    add_row(
        InteractionType.ACTIVITY_RESUMED,
        "com.dst.fall",
        fall_before,
        "America/Chicago",
        explicit_offset=True,
    )
    add_row(
        InteractionType.ACTIVITY_PAUSED,
        "com.dst.fall",
        fall_after,
        "America/Chicago",
        explicit_offset=True,
    )
    add_row(
        InteractionType.SCREEN_INTERACTIVE,
        "android",
        datetime(2026, 11, 15, 22, 0, tzinfo=spring_zone),
        "America/Chicago",
        explicit_offset=True,
    )
    add_row(
        InteractionType.ACTIVITY_RESUMED,
        "com.screen.missing",
        datetime(2026, 11, 15, 22, 0, 15, tzinfo=spring_zone),
        "America/Chicago",
        explicit_offset=True,
    )

    return rows


def build_pathological_raw_dataframe(
    *,
    config: FixtureBuildConfig | None = None,
) -> pl.DataFrame:
    return pl.DataFrame(build_pathological_raw_block(config=config))


def build_pathological_algorithm_dataframe(
    *,
    config: FixtureBuildConfig | None = None,
    selected_timezone: str = "America/Chicago",
    timezone_handling_option: TimezoneHandlingOption = TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
) -> pl.DataFrame:
    config = config or FixtureBuildConfig()
    raw_df = build_pathological_raw_dataframe(config=config)
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        use_filter_file=False,
        selected_timezone=selected_timezone,
        timezone_handling_option=timezone_handling_option,
    )
    helper = PolarsFastPathPreprocessor(options)
    df = helper._correct_username_column(raw_df)
    df = helper._rename_interaction_types(df)
    df = helper._correct_event_timestamp_column(df)
    if Column.START_TIMESTAMP not in df.columns:
        df = df.with_columns(pl.lit(None).alias(Column.START_TIMESTAMP))
    if Column.STOP_TIMESTAMP not in df.columns:
        df = df.with_columns(pl.lit(None).alias(Column.STOP_TIMESTAMP))
    return df


def iter_scaled_pathological_rows(
    *,
    base_rows: Iterable[dict[str, str]],
    repetitions: int,
    file_index: int,
    repetition_spacing_days: int = 14,
) -> Iterator[dict[str, str]]:
    cached_rows = list(base_rows)
    for repetition_index in range(repetitions):
        shift = timedelta(days=repetition_index * repetition_spacing_days)
        for row in cached_rows:
            shifted = dict(row)
            shifted[Column.APP_PACKAGE_NAME] = _permuted_package(
                row[Column.APP_PACKAGE_NAME],
                file_index=file_index,
                repetition_index=repetition_index,
            )
            shifted[Column.APPLICATION_LABEL] = _label_for_package(shifted[Column.APP_PACKAGE_NAME])
            timestamp = _parse_timestamp_text(row[Column.EVENT_TIMESTAMP]) + shift
            shifted[Column.EVENT_TIMESTAMP] = _serialize_timestamp(
                timestamp,
                explicit_offset=(
                    "+" in row[Column.EVENT_TIMESTAMP][10:]
                    or row[Column.EVENT_TIMESTAMP].endswith("Z")
                ),
            )
            yield shifted


def write_pathological_raw_folder(
    output_folder: str | Path,
    *,
    file_count: int = 8,
    repetitions: int = 32,
    weeks: int = 6,
    seed: int = 20260423,
) -> Path:
    output_path = Path(output_folder)
    output_path.mkdir(parents=True, exist_ok=True)
    for file_index in range(file_count):
        config = FixtureBuildConfig(
            participant_id=f"P{file_index + 1:04d}",
            weeks=weeks,
            seed=seed + file_index,
            possible_device_model=(
                ChronicleDeviceType.AMAZON.value
                if file_index % 3 == 0
                else ChronicleDeviceType.ANDROID.value
            ),
        )
        base_rows = build_pathological_raw_block(config=config)
        save_path = output_path / f"Raw_pathological_{file_index + 1}.csv"
        with save_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=[str(c) for c in RAW_COLUMNS])
            writer.writeheader()
            writer.writerows(
                iter_scaled_pathological_rows(
                    base_rows=base_rows,
                    repetitions=repetitions,
                    file_index=file_index,
                )
            )
    return output_path
