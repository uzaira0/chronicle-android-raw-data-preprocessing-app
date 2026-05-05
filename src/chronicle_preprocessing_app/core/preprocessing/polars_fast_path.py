"""
Polars-native preprocessing fast path for the standard app-usage workflow.

This path keeps the canonical app-usage semantics and is the shared Polars-native
core used by the supported preprocessing flow.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import polars as pl

from chronicle_preprocessing_app.config.constants import (
    ALL_INTERACTION_TYPES_MAP,
    AMAZON_APPS,
    GAP_TIMESTAMPS_SIDECAR_SUFFIX,
    PREPROCESSED_FILE_SUFFIX,
    PREPROCESSED_FOLDER_SUFFIX,
    TARGET_CHILD_USERNAME,
    AppCodebookColumn,
    ChronicleDeviceType,
    Column,
    InteractionType,
    TimezoneHandlingOption,
)
from chronicle_preprocessing_app.config.defaults import (
    DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS,
    DEFAULT_LONG_USAGE_DURATION_THRESHOLDS,
)
from chronicle_preprocessing_app.config.version import __version__
from chronicle_preprocessing_app.core.config import PreprocessingOptions

LOGGER = logging.getLogger(__name__)

_MISSING_INT64 = np.iinfo(np.int64).min
_CODEBOOK_COLUMN_RENAME_MAP: dict[str, str] = {
    AppCodebookColumn.APPLICATION_LABEL: Column.CODEBOOK_APPLICATION_LABEL,
    AppCodebookColumn.PLAY_STORE_GENRE_ID: Column.PLAY_STORE_GENRE_ID,
    AppCodebookColumn.PLAY_STORE_GENRE: Column.PLAY_STORE_GENRE,
    AppCodebookColumn.PLAY_STORE_BROAD_APP_CATEGORY: Column.PLAY_STORE_BROAD_APP_CATEGORY,
    AppCodebookColumn.PLAY_STORE_DEVELOPER: Column.PLAY_STORE_DEVELOPER,
    AppCodebookColumn.PLAY_STORE_FREE: Column.PLAY_STORE_FREE,
    AppCodebookColumn.PLAY_STORE_RATING: Column.PLAY_STORE_RATING,
    AppCodebookColumn.PLAY_STORE_DOWNLOADS: Column.PLAY_STORE_DOWNLOADS,
    AppCodebookColumn.USC_BROAD_APP_CATEGORY: Column.USC_BROAD_APP_CATEGORY,
    AppCodebookColumn.USC_GENRE_ID: Column.USC_GENRE_ID,
    AppCodebookColumn.UMICH_CHILD_APP_CATEGORY_CODE: Column.UMICH_CHILD_APP_CATEGORY_CODE,
    AppCodebookColumn.UMICH_CHILD_APP_CATEGORY: Column.UMICH_CHILD_APP_CATEGORY,
    AppCodebookColumn.UMICH_ADULT_APP_CATEGORY_CODE: Column.UMICH_ADULT_APP_CATEGORY_CODE,
    AppCodebookColumn.UMICH_ADULT_APP_CATEGORY: Column.UMICH_ADULT_APP_CATEGORY,
    AppCodebookColumn.UMICH_FREE: Column.UMICH_FREE,
    AppCodebookColumn.UMICH_GAMBLING_APP: Column.UMICH_GAMBLING_APP,
    AppCodebookColumn.UMICH_INAPPROPRIATE_APP: Column.UMICH_INAPPROPRIATE_APP,
    AppCodebookColumn.BABYEMU_GENRE_ID_SCRAPED: Column.BABYEMU_GENRE_ID_SCRAPED,
    AppCodebookColumn.BABYEMU_GENRE_ID_MANUAL: Column.BABYEMU_GENRE_ID_MANUAL,
    AppCodebookColumn.BABYEMU_BROAD_APP_CATEGORY: Column.BABYEMU_BROAD_APP_CATEGORY,
    AppCodebookColumn.BABYEMU_MEDIUM_APP_CATEGORY: Column.BABYEMU_MEDIUM_APP_CATEGORY,
    AppCodebookColumn.BABYEMU_FINE_APP_CATEGORY: Column.BABYEMU_FINE_APP_CATEGORY,
    AppCodebookColumn.BABYEMU_ALTERNATE_FINE_APP_CATEGORY: Column.BABYEMU_ALTERNATE_FINE_APP_CATEGORY,
    AppCodebookColumn.BABYEMU_KIDS: Column.BABYEMU_KIDS,
    AppCodebookColumn.BCM_CNRC_HEURISTIC_CATEGORY: Column.BCM_CNRC_HEURISTIC_CATEGORY,
    AppCodebookColumn.BCM_CNRC_CATEGORIZATION_SOURCE: Column.BCM_CNRC_CATEGORIZATION_SOURCE,
    AppCodebookColumn.DATASET: Column.CODEBOOK_DATASET,
}
_CODEBOOK_OUTPUT_COLUMNS: tuple[str, ...] = tuple(_CODEBOOK_COLUMN_RENAME_MAP.values())


def polars_fast_path_enabled() -> bool:
    """Return whether the Polars-native fast path should be used."""
    return os.getenv("CHRONICLE_USE_POLARS_FAST_PATH", "true").lower() not in {
        "0",
        "false",
        "no",
    }


@dataclass
class PolarsFastPathResult:
    participant_id: str
    data: pl.DataFrame
    pre_algo_event_timestamps: pl.Series | None = None


def supports_polars_fast_path(
    options: PreprocessingOptions,
    *,
    survey_data_processor_available: bool,
    study_date_provider_available: bool,
) -> bool:
    """Return whether the standard preprocessing request can stay Polars-native."""
    return (
        polars_fast_path_enabled()
        and options.process_app_usage_sessions
        and not options.process_screen_usage_sessions
        and not survey_data_processor_available
        and not study_date_provider_available
    )


class PolarsFastPathPreprocessor:
    """Polars-native preprocessing for the standard app-usage workflow."""

    def __init__(
        self,
        options: PreprocessingOptions,
        *,
        app_codebook: pl.DataFrame | None = None,
    ) -> None:
        self.options = options
        self.app_codebook = app_codebook

    def _get_datetime_of_preprocessing(self) -> str:
        return self.options.datetime_of_preprocessing_override or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def preprocess_raw_data_file(self, raw_data_file: Path | str) -> PolarsFastPathResult:
        df = self._read_raw_csv(Path(raw_data_file))
        if df.is_empty():
            msg = f"Raw data file is empty: {raw_data_file}"
            raise ValueError(msg)

        participant_id = self._get_participant_id(df)
        df = self._correct_username_column(df)
        df = self._rename_interaction_types(df)
        df = self._correct_event_timestamp_column(df)
        df = self._create_additional_columns(df)
        df = self._label_filtered_apps(df)
        # Capture after timestamp/TZ/dedup corrections but before the algorithm
        # removes rows. These timestamps power gap detection in the plotter.
        pre_algo_ts = df.get_column(Column.EVENT_TIMESTAMP).drop_nulls()
        df = self._run_app_usage_algorithm(df)
        df = self._check_for_disordered_timestamps(df)
        df = self._enrich_with_app_codebook_data(df)
        df = self._add_app_usage_detail_columns(df)
        df = self._mark_app_usage_flags(df)
        df = self._remove_selected_interaction_types(df)
        return PolarsFastPathResult(participant_id=participant_id, data=df, pre_algo_event_timestamps=pre_algo_ts)

    def save_preprocessed_output(
        self,
        df: pl.DataFrame,
        *,
        raw_data_filename: str,
        output_folder: str | Path,
        study_name: str,
        pre_algo_event_timestamps: pl.Series | None = None,
    ) -> Path:
        preprocessed_data_save_folder = Path(output_folder) / f"{study_name + ' ' + PREPROCESSED_FOLDER_SUFFIX}"
        preprocessed_data_save_folder.mkdir(parents=True, exist_ok=True)
        stem = Path(raw_data_filename).stem.replace("Raw ", "")
        save_name = preprocessed_data_save_folder / f"{stem} {PREPROCESSED_FILE_SUFFIX}"

        df = df.with_columns(pl.lit(study_name).alias(Column.STUDY_NAME))
        columns_to_include = self._build_output_columns(df)
        output_df = df.select([col for col in columns_to_include if col in df.columns])
        output_df = self._format_output_frame(output_df)
        output_df.write_csv(save_name)

        if pre_algo_event_timestamps is not None and len(pre_algo_event_timestamps) > 0:
            sidecar_path = save_name.with_name(save_name.stem + GAP_TIMESTAMPS_SIDECAR_SUFFIX)
            pl.DataFrame({Column.EVENT_TIMESTAMP: pre_algo_event_timestamps}).write_parquet(sidecar_path)

        return preprocessed_data_save_folder

    def _read_raw_csv(self, raw_data_file: Path) -> pl.DataFrame:
        df = pl.read_csv(raw_data_file, infer_schema_length=10000)
        string_columns = [column for column, dtype in df.schema.items() if dtype == pl.String]
        if string_columns:
            df = df.with_columns([pl.col(column).cast(pl.String).str.strip_chars() for column in string_columns])
        return df

    def _get_participant_id(self, df: pl.DataFrame) -> str:
        participant_series = df.get_column(Column.PARTICIPANT_ID)
        index = 1 if len(participant_series) > 1 else 0
        return str(participant_series[index])

    def _correct_username_column(self, df: pl.DataFrame) -> pl.DataFrame:
        if Column.USERNAME not in df.columns:
            return df
        return df.with_columns(pl.col(Column.USERNAME).replace("Target child", TARGET_CHILD_USERNAME).alias(Column.USERNAME))

    def _rename_interaction_types(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.with_columns(
            pl.col(Column.INTERACTION_TYPE)
            .replace_strict(
                list(ALL_INTERACTION_TYPES_MAP.keys()),
                list(ALL_INTERACTION_TYPES_MAP.values()),
                default=pl.col(Column.INTERACTION_TYPE),
            )
            .alias(Column.INTERACTION_TYPE)
        )

    def _correct_event_timestamp_column(self, df: pl.DataFrame) -> pl.DataFrame:
        timestamp_col = Column.EVENT_TIMESTAMP
        original_col = f"{timestamp_col}_original"
        timestamp_text = pl.col(timestamp_col).cast(pl.String)

        df = df.with_columns(pl.col(timestamp_col).alias(original_col))
        has_explicit_timezone = df.select(timestamp_text.str.contains(r"(Z|[+-]\d{2}:\d{2})$").fill_null(False).any()).item()
        timestamp_expr = (
            timestamp_text.str.to_datetime(
                format="%Y-%m-%d %H:%M:%S",
                time_zone="UTC",
                strict=False,
            )
            if not has_explicit_timezone
            else pl.coalesce(
                [
                    timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                        format="%Y-%m-%dT%H:%M:%S%#z",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                        format="%Y-%m-%d %H:%M:%S%#z",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%d %H:%M:%S",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%dT%H:%M:%S",
                        time_zone="UTC",
                        strict=False,
                    ),
                ]
            )
        )
        df = df.with_columns(timestamp_expr.alias(timestamp_col))

        null_mask = pl.col(timestamp_col).is_null() & pl.col(original_col).is_not_null()
        if df.select(null_mask.any()).item():
            invalid_column_name = f"{timestamp_col}_invalid_original"
            df = df.with_columns(pl.when(null_mask).then(pl.col(original_col)).otherwise(pl.lit(None)).alias(invalid_column_name))

        df = df.drop(original_col)
        df = self._apply_timezone_handling(df, timestamp_col)
        if self.options.correct_duplicate_event_timestamps:
            df = self._unalign_duplicate_timestamps(df, timestamp_col)
        df = self._mark_data_time_gaps(df, timestamp_col, Column.DATA_TIME_GAP_HOURS)
        return df.sort(timestamp_col)

    def _determine_primary_timezone(self, df: pl.DataFrame) -> str:
        if Column.TIMEZONE in df.columns:
            timezone_values = (
                df.filter(pl.col(Column.TIMEZONE).is_not_null() & (pl.col(Column.TIMEZONE) != "None"))
                .group_by(Column.TIMEZONE)
                .len()
                .sort("len", descending=True)
            )
            if not timezone_values.is_empty():
                return str(timezone_values[0, Column.TIMEZONE])
        return "UTC"

    def _apply_timezone_handling(self, df: pl.DataFrame, timestamp_column: str) -> pl.DataFrame:
        option = self.options.timezone_handling_option
        target_timezone: str | None = None

        if option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE:
            target_timezone = str(self.options.selected_timezone) if self.options.selected_timezone else self._determine_primary_timezone(df)
            if self.options.selected_timezone is not None:
                df = df.filter(pl.col(Column.TIMEZONE).is_not_null() & (pl.col(Column.TIMEZONE) == str(self.options.selected_timezone)))
        elif option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE:
            target_timezone = str(self.options.selected_timezone) if self.options.selected_timezone else self._determine_primary_timezone(df)
        elif option in (
            TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE,
            TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE,
        ):
            target_timezone = self._determine_primary_timezone(df)
            if option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE:
                df = df.filter(pl.col(Column.TIMEZONE).is_not_null() & (pl.col(Column.TIMEZONE) == target_timezone))
        else:
            raise ValueError(f"Invalid timezone option: {option}")

        if target_timezone is None:
            return df

        if target_timezone and isinstance(df.schema[timestamp_column], pl.Datetime):
            if df.schema[timestamp_column].time_zone is not None:
                df = df.with_columns(pl.col(timestamp_column).dt.convert_time_zone(target_timezone).alias(timestamp_column))
        if Column.TIMEZONE in df.columns:
            df = df.with_columns(pl.lit(target_timezone).alias(Column.TIMEZONE))
        return df

    def _unalign_duplicate_timestamps(self, df: pl.DataFrame, timestamp_column: str) -> pl.DataFrame:
        timestamps_ns = df.get_column(timestamp_column).dt.epoch("ns").to_numpy()
        if len(timestamps_ns) <= 1:
            return df
        if np.all(timestamps_ns[1:] > timestamps_ns[:-1]):
            return df

        dedup_columns = [timestamp_column, Column.INTERACTION_TYPE, Column.APP_PACKAGE_NAME]
        df = df.unique(subset=dedup_columns, keep="first", maintain_order=True)
        timestamps_ns = df.get_column(timestamp_column).dt.epoch("ns").to_numpy()
        if len(timestamps_ns) <= 1:
            return df
        if np.all(timestamps_ns[1:] > timestamps_ns[:-1]):
            return df

        interaction_types = df.get_column(Column.INTERACTION_TYPE).to_numpy()
        stop_usage_types = {
            str(value) for value in (self.options.same_app_interaction_types_to_stop_usage_at | self.options.other_interaction_types_to_stop_usage_at)
        }
        adjusted = timestamps_ns.copy()
        normalized_interaction_types = np.asarray(interaction_types, dtype=object)
        normalized_interaction_types = np.where(
            normalized_interaction_types == "Screen Non-interactive",
            "Screen Non-Interactive",
            normalized_interaction_types,
        )
        priorities = np.ones(len(normalized_interaction_types), dtype=np.int8)
        priorities[normalized_interaction_types == str(InteractionType.ACTIVITY_RESUMED)] = 0
        if stop_usage_types:
            stop_mask = np.isin(normalized_interaction_types, tuple(stop_usage_types))
            priorities[stop_mask] = np.where(
                normalized_interaction_types[stop_mask] == str(InteractionType.ACTIVITY_RESUMED),
                0,
                2,
            )

        group_starts = np.concatenate(
            (
                np.array([0], dtype=np.intp),
                np.flatnonzero(timestamps_ns[1:] != timestamps_ns[:-1]).astype(np.intp) + 1,
            )
        )
        group_ends = np.concatenate((group_starts[1:], np.array([len(timestamps_ns)], dtype=np.intp)))

        for group_start, group_end in zip(group_starts, group_ends, strict=False):
            count = int(group_end - group_start)
            if count <= 1:
                continue

            group_priorities = priorities[group_start:group_end]
            order = np.argsort(group_priorities, kind="stable")
            row_indices = np.arange(group_start, group_end, dtype=np.intp)[order]
            adjusted[row_indices] -= np.arange(count, 0, -1, dtype=np.int64) * 1_000

        tz_name = df.schema[timestamp_column].time_zone or "UTC"
        df = df.with_columns(
            pl.from_epoch(pl.Series("__event_timestamp_ns", adjusted), time_unit="ns")
            .dt.replace_time_zone("UTC")
            .dt.convert_time_zone(tz_name)
            .alias(timestamp_column)
        )
        return df.sort(timestamp_column)

    def _mark_data_time_gaps(self, df: pl.DataFrame, timestamp_column: str, gap_column: str) -> pl.DataFrame:
        gap_expr = pl.col(timestamp_column).diff().dt.total_microseconds().cast(pl.Float64) / 3_600_000_000.0
        return df.with_columns(gap_expr.round(2).fill_null(0.0).alias(gap_column))

    def _create_additional_columns(self, df: pl.DataFrame) -> pl.DataFrame:
        device_model = self._get_possible_device_model(df)
        weekday = pl.col(Column.EVENT_TIMESTAMP).dt.weekday()
        return df.with_columns(
            [
                pl.lit(__version__).alias(Column.PREPROCESSOR_VERSION),
                pl.lit(self._get_datetime_of_preprocessing()).alias(Column.DATETIME_OF_PREPROCESSING),
                pl.lit(device_model.value).alias(Column.POSSIBLE_DEVICE_MODEL),
                pl.col(Column.EVENT_TIMESTAMP).dt.date().alias(Column.DATE),
                ((weekday % 7) + 1).alias(Column.DAY),
                (weekday < 6).cast(pl.Int64).alias(Column.WEEKDAY_MF),
                (weekday < 5).cast(pl.Int64).alias(Column.WEEKDAY_MTH),
                ((weekday < 5) | (weekday == 7)).cast(pl.Int64).alias(Column.WEEKDAY_SUTH),
                pl.col(Column.EVENT_TIMESTAMP).dt.hour().alias(Column.HOUR),
                pl.col(Column.EVENT_TIMESTAMP).dt.quarter().alias(Column.QUARTER),
            ]
        )

    def _get_possible_device_model(self, df: pl.DataFrame) -> ChronicleDeviceType:
        amazon_packages = list(AMAZON_APPS.keys())
        has_amazon = df.select(pl.col(Column.APP_PACKAGE_NAME).str.contains("|".join(amazon_packages)).any()).item()
        return ChronicleDeviceType.AMAZON if has_amazon else ChronicleDeviceType.ANDROID

    def _label_filtered_apps(self, df: pl.DataFrame) -> pl.DataFrame:
        if not self.options.use_filter_file or not self.options.apps_to_filter_dict:
            return df

        filter_rows = []
        package_names = []
        for package_name, labels_str in self.options.apps_to_filter_dict.items():
            package_names.append(package_name)
            for label in labels_str.split(","):
                filter_rows.append(
                    {
                        Column.APP_PACKAGE_NAME: package_name,
                        Column.APPLICATION_LABEL: label.strip(),
                        "__valid_filter_match": True,
                    }
                )

        if not filter_rows:
            return df

        lookup_df = pl.DataFrame(filter_rows).unique()
        df = df.with_columns(pl.col(Column.APP_PACKAGE_NAME).is_in(package_names).alias("__filter_candidate")).join(
            lookup_df,
            on=[Column.APP_PACKAGE_NAME, Column.APPLICATION_LABEL],
            how="left",
        )

        mismatch_df = df.filter(pl.col("__filter_candidate") & pl.col("__valid_filter_match").is_null())
        if not mismatch_df.is_empty():
            unexpected = mismatch_df.select([Column.APP_PACKAGE_NAME, Column.APPLICATION_LABEL]).unique().iter_rows()
            for package_name, app_label in unexpected:
                LOGGER.warning(
                    "App label mismatch for package %s: found '%s'",
                    package_name,
                    app_label,
                )

        interaction_mapping = {
            str(InteractionType.ACTIVITY_RESUMED): str(InteractionType.FILTERED_APP_RESUMED),
            str(InteractionType.ACTIVITY_PAUSED): str(InteractionType.FILTERED_APP_PAUSED),
            str(InteractionType.ACTIVITY_STOPPED): str(InteractionType.FILTERED_APP_STOPPED),
            str(InteractionType.ACTIVITY_DESTROYED): str(InteractionType.FILTERED_APP_DESTROYED),
        }

        df = df.with_columns(
            pl.when(pl.col("__valid_filter_match").fill_null(False))
            .then(
                pl.col(Column.INTERACTION_TYPE).replace(
                    list(interaction_mapping.keys()),
                    list(interaction_mapping.values()),
                    default=pl.col(Column.INTERACTION_TYPE),
                )
            )
            .otherwise(pl.col(Column.INTERACTION_TYPE))
            .alias(Column.INTERACTION_TYPE)
        )
        return df.drop(["__filter_candidate", "__valid_filter_match"], strict=False)

    def _run_app_usage_algorithm(self, df: pl.DataFrame) -> pl.DataFrame:
        if self.options.use_filter_file:
            df = self._process_filtered_app_usage(df)
        df = self._process_valid_app_usage(df)
        return df

    def _process_filtered_app_usage(self, df: pl.DataFrame) -> pl.DataFrame:
        interactions = df.get_column(Column.INTERACTION_TYPE).to_numpy()
        if not np.isin(
            interactions,
            [str(InteractionType.FILTERED_APP_RESUMED), str(InteractionType.FILTERED_APP_PAUSED)],
        ).any():
            return df

        df = self._process_usage_rows(
            df,
            resumed_type=str(InteractionType.FILTERED_APP_RESUMED),
            paused_type=str(InteractionType.FILTERED_APP_PAUSED),
            usage_type=str(InteractionType.FILTERED_APP_USAGE),
            stopped_type=str(InteractionType.FILTERED_APP_STOPPED),
            same_stop_types={str(value) for value in self.options.filtered_same_app_interaction_types_to_stop_usage_at},
            other_stop_types={str(value) for value in self.options.filtered_other_interaction_types_to_stop_usage_at},
        )
        return df

    def _process_valid_app_usage(self, df: pl.DataFrame) -> pl.DataFrame:
        interactions = df.get_column(Column.INTERACTION_TYPE).to_numpy()
        if not np.isin(
            interactions,
            [str(InteractionType.ACTIVITY_RESUMED), str(InteractionType.ACTIVITY_PAUSED)],
        ).any():
            raise ValueError("No valid app usage data during the study period")

        return self._process_usage_rows(
            df,
            resumed_type=str(InteractionType.ACTIVITY_RESUMED),
            paused_type=str(InteractionType.ACTIVITY_PAUSED),
            usage_type=str(InteractionType.APP_USAGE),
            stopped_type=str(InteractionType.ACTIVITY_STOPPED),
            same_stop_types={str(value) for value in self.options.same_app_interaction_types_to_stop_usage_at},
            other_stop_types={str(value) for value in self.options.other_interaction_types_to_stop_usage_at},
        )

    def _process_usage_rows(
        self,
        df: pl.DataFrame,
        *,
        resumed_type: str,
        paused_type: str,
        usage_type: str,
        stopped_type: str,
        same_stop_types: set[str],
        other_stop_types: set[str],
    ) -> pl.DataFrame:
        interactions = df.get_column(Column.INTERACTION_TYPE).to_numpy()
        app_packages = df.get_column(Column.APP_PACKAGE_NAME).fill_null("").cast(pl.Categorical).to_physical().to_numpy()
        timestamp_ns = df.get_column(Column.EVENT_TIMESTAMP).dt.epoch("ns").to_numpy()
        resumed_flags = interactions == resumed_type
        same_stop_flags = np.isin(interactions, list(same_stop_types))
        other_stop_flags = np.isin(interactions, list(other_stop_types))
        stopped_flags = interactions == stopped_type

        start_indices, stop_start_indices, stop_event_indices, missing_indices = self._match_usage_updates(
            app_codes=np.ascontiguousarray(app_packages, dtype=np.int32),
            timestamp_ns=np.ascontiguousarray(timestamp_ns, dtype=np.int64),
            resumed_flags=np.ascontiguousarray(resumed_flags, dtype=bool),
            same_stop_flags=np.ascontiguousarray(same_stop_flags, dtype=bool),
            other_stop_flags=np.ascontiguousarray(other_stop_flags, dtype=bool),
            stopped_flags=np.ascontiguousarray(stopped_flags, dtype=bool),
        )

        row_count = len(df)
        start_ns = np.full(row_count, _MISSING_INT64, dtype=np.int64)
        stop_ns = np.full(row_count, _MISSING_INT64, dtype=np.int64)
        interaction_updates = interactions.copy()

        if start_indices.size:
            start_ns[start_indices] = timestamp_ns[start_indices]
        if stop_start_indices.size:
            stop_ns[stop_start_indices] = timestamp_ns[stop_event_indices]
        if missing_indices.size:
            interaction_updates[missing_indices] = str(InteractionType.END_OF_USAGE_MISSING)

        timestamp_tz = df.schema[Column.EVENT_TIMESTAMP].time_zone or "UTC"
        df = self._apply_timestamp_update_arrays(
            df,
            start_ns=start_ns,
            stop_ns=stop_ns,
            interaction_values=interaction_updates,
            timestamp_tz=timestamp_tz,
        )

        df = df.filter(pl.col(Column.INTERACTION_TYPE) != paused_type)
        df = df.filter(
            ~(
                (pl.col(Column.INTERACTION_TYPE) == resumed_type)
                & (pl.col(Column.START_TIMESTAMP).is_null() | pl.col(Column.STOP_TIMESTAMP).is_null())
            )
        )
        df = df.with_columns(pl.col(Column.INTERACTION_TYPE).replace(resumed_type, usage_type).alias(Column.INTERACTION_TYPE))
        duration_expr = (pl.col(Column.STOP_TIMESTAMP) - pl.col(Column.START_TIMESTAMP)).dt.total_microseconds().cast(pl.Float64) / 1_000_000.0
        df = df.with_columns(
            [
                duration_expr.alias(Column.DURATION_SECONDS),
                (duration_expr / 60.0).alias(Column.DURATION_MINUTES),
            ]
        )
        return df.sort(Column.EVENT_TIMESTAMP)

    def _match_usage_updates(
        self,
        *,
        app_codes: np.ndarray,
        timestamp_ns: np.ndarray,
        resumed_flags: np.ndarray,
        same_stop_flags: np.ndarray,
        other_stop_flags: np.ndarray,
        stopped_flags: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        try:
            from chronicle_preprocessing_app import _rust_app_usage_matcher

            update_fn = (
                getattr(
                    _rust_app_usage_matcher,
                    "match_app_usage_update_arrays",
                    None,
                )
                or _rust_app_usage_matcher.match_app_usage_update_indices
            )
            outputs = update_fn(
                app_codes,
                timestamp_ns,
                resumed_flags,
                same_stop_flags,
                other_stop_flags,
                stopped_flags,
                self.options.allow_stop_event_reuse,
                self.options.use_activity_stopped_as_fallback,
                self.options.apply_threshold_to_activity_stopped_fallback,
                int(self.options.long_duration_threshold_hours * 3600 * 1_000_000_000),
            )
            return tuple(np.asarray(output, dtype=np.intp) for output in outputs)
        except Exception:
            LOGGER.debug("Rust matcher unavailable in Polars fast path; falling back to Python")
            return self._match_usage_updates_python(
                app_codes=app_codes,
                timestamp_ns=timestamp_ns,
                resumed_flags=resumed_flags,
                same_stop_flags=same_stop_flags,
                other_stop_flags=other_stop_flags,
                stopped_flags=stopped_flags,
            )

    def _match_usage_updates_python(
        self,
        *,
        app_codes: np.ndarray,
        timestamp_ns: np.ndarray,
        resumed_flags: np.ndarray,
        same_stop_flags: np.ndarray,
        other_stop_flags: np.ndarray,
        stopped_flags: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        open_start_indices: list[int] = []
        start_indices: list[int] = []
        stop_start_indices: list[int] = []
        stop_event_indices: list[int] = []
        missing_indices: list[int] = []

        def is_valid_duration(start_index: int, stop_index: int, *, enforce_threshold: bool) -> bool:
            duration_ns = int(timestamp_ns[stop_index]) - int(timestamp_ns[start_index])
            if duration_ns < 0:
                return False
            return not enforce_threshold or duration_ns <= int(self.options.long_duration_threshold_hours * 3600 * 1_000_000_000)

        for index in range(len(app_codes)):
            current_app = app_codes[index]
            is_normal_stop = bool(same_stop_flags[index] or other_stop_flags[index])
            is_fallback_stop = bool(stopped_flags[index] and self.options.use_activity_stopped_as_fallback)

            if self.options.allow_stop_event_reuse and (is_normal_stop or is_fallback_stop):
                still_open: list[int] = []
                for start_index in open_start_indices:
                    start_app = app_codes[start_index]
                    same_app_compatible = bool(same_stop_flags[index] and start_app == current_app)
                    other_app_compatible = bool(other_stop_flags[index] and start_app != current_app)
                    fallback_compatible = bool(not is_normal_stop and is_fallback_stop and start_app == current_app)
                    if not (same_app_compatible or other_app_compatible or fallback_compatible):
                        still_open.append(start_index)
                        continue
                    enforce_threshold = not fallback_compatible or self.options.apply_threshold_to_activity_stopped_fallback
                    if is_valid_duration(start_index, index, enforce_threshold=enforce_threshold):
                        stop_start_indices.append(start_index)
                        stop_event_indices.append(index)
                    else:
                        still_open.append(start_index)
                open_start_indices = still_open
            elif is_normal_stop or is_fallback_stop:
                matched_position: int | None = None
                for position in range(len(open_start_indices) - 1, -1, -1):
                    start_index = open_start_indices[position]
                    start_app = app_codes[start_index]
                    same_app_compatible = bool(same_stop_flags[index] and start_app == current_app)
                    other_app_compatible = bool(other_stop_flags[index] and start_app != current_app)
                    fallback_compatible = bool(not is_normal_stop and is_fallback_stop and start_app == current_app)
                    if not (same_app_compatible or other_app_compatible or fallback_compatible):
                        continue
                    enforce_threshold = not fallback_compatible or self.options.apply_threshold_to_activity_stopped_fallback
                    if is_valid_duration(start_index, index, enforce_threshold=enforce_threshold):
                        matched_position = position
                        break
                if matched_position is not None:
                    start_index = open_start_indices.pop(matched_position)
                    stop_start_indices.append(start_index)
                    stop_event_indices.append(index)

            if resumed_flags[index]:
                start_indices.append(index)
                open_start_indices.append(index)

        if open_start_indices:
            last_index = len(app_codes) - 1
            still_open = list(open_start_indices)
            for start_index in still_open:
                if last_index > start_index and is_valid_duration(start_index, last_index, enforce_threshold=True):
                    stop_start_indices.append(start_index)
                    stop_event_indices.append(last_index)
                else:
                    missing_indices.append(start_index)

        return (
            np.asarray(start_indices, dtype=np.intp),
            np.asarray(stop_start_indices, dtype=np.intp),
            np.asarray(stop_event_indices, dtype=np.intp),
            np.asarray(missing_indices, dtype=np.intp),
        )

    def _apply_timestamp_update_arrays(
        self,
        df: pl.DataFrame,
        *,
        start_ns: np.ndarray,
        stop_ns: np.ndarray,
        interaction_values: np.ndarray,
        timestamp_tz: str,
    ) -> pl.DataFrame:
        start_series = pl.Series("__start_ns", start_ns)
        stop_series = pl.Series("__stop_ns", stop_ns)
        interaction_series = pl.Series(Column.INTERACTION_TYPE, interaction_values)
        timestamp_dtype = pl.Datetime("ns", time_zone=timestamp_tz) if timestamp_tz else pl.Datetime("ns")
        df = df.with_columns([start_series, stop_series, interaction_series])

        df = df.with_columns(
            [
                pl.when(pl.col("__start_ns") != _MISSING_INT64)
                .then(
                    pl.from_epoch(pl.col("__start_ns"), time_unit="ns").dt.replace_time_zone("UTC").dt.convert_time_zone(timestamp_tz)
                    if timestamp_tz
                    else pl.from_epoch(pl.col("__start_ns"), time_unit="ns")
                )
                .otherwise(pl.lit(None, dtype=timestamp_dtype))
                .alias(Column.START_TIMESTAMP),
                pl.when(pl.col("__stop_ns") != _MISSING_INT64)
                .then(
                    pl.from_epoch(pl.col("__stop_ns"), time_unit="ns").dt.replace_time_zone("UTC").dt.convert_time_zone(timestamp_tz)
                    if timestamp_tz
                    else pl.from_epoch(pl.col("__stop_ns"), time_unit="ns")
                )
                .otherwise(pl.lit(None, dtype=timestamp_dtype))
                .alias(Column.STOP_TIMESTAMP),
            ]
        )
        return df.drop(["__start_ns", "__stop_ns"], strict=False)

    def _check_for_disordered_timestamps(self, df: pl.DataFrame) -> pl.DataFrame:
        if Column.START_TIMESTAMP not in df.columns or Column.STOP_TIMESTAMP not in df.columns:
            return df
        has_disordered = df.filter(
            pl.col(Column.START_TIMESTAMP).is_not_null()
            & pl.col(Column.STOP_TIMESTAMP).is_not_null()
            & (pl.col(Column.START_TIMESTAMP) > pl.col(Column.STOP_TIMESTAMP))
        ).height
        if has_disordered:
            raise ValueError("Disordered timestamps detected")
        return df

    @staticmethod
    def _blank_to_null_expr(column_name: str) -> pl.Expr:
        return pl.when(pl.col(column_name).cast(pl.String).str.strip_chars() == "").then(pl.lit(None)).otherwise(pl.col(column_name))

    @staticmethod
    def _null_string_expr() -> pl.Expr:
        return pl.lit(None).cast(pl.String)

    def _enrich_with_app_codebook_data(self, df: pl.DataFrame) -> pl.DataFrame:
        if not self.options.use_app_codebook:
            return df

        if self.app_codebook is None:
            return df.with_columns(
                [
                    *[pl.lit(None).cast(pl.String).alias(column) for column in _CODEBOOK_OUTPUT_COLUMNS],
                    pl.lit("Unknown").alias(Column.BROAD_APP_CATEGORY),
                    pl.lit("Unknown").alias(Column.GENRE_ID_SCRAPED),
                ]
            )

        available_source_columns = [source_column for source_column in _CODEBOOK_COLUMN_RENAME_MAP if source_column in self.app_codebook.columns]
        renamed_codebook = self.app_codebook.select(
            [
                pl.col(AppCodebookColumn.APP_PACKAGE_NAME),
                *[pl.col(source_column).alias(_CODEBOOK_COLUMN_RENAME_MAP[source_column]) for source_column in available_source_columns],
            ]
        )
        df = df.join(renamed_codebook, on=Column.APP_PACKAGE_NAME, how="left")

        missing_output_columns = [column for column in _CODEBOOK_OUTPUT_COLUMNS if column not in df.columns]
        if missing_output_columns:
            df = df.with_columns([pl.lit(None).cast(pl.String).alias(column) for column in missing_output_columns])

        broad_category_candidates = [
            column
            for column in (
                Column.PLAY_STORE_BROAD_APP_CATEGORY,
                Column.USC_BROAD_APP_CATEGORY,
                Column.BABYEMU_BROAD_APP_CATEGORY,
                Column.BCM_CNRC_HEURISTIC_CATEGORY,
                Column.BROAD_APP_CATEGORY,
            )
            if column in df.columns
        ]
        genre_id_candidates = [
            column
            for column in (
                Column.BABYEMU_GENRE_ID_SCRAPED,
                Column.BABYEMU_GENRE_ID_MANUAL,
                Column.PLAY_STORE_GENRE_ID,
                Column.USC_GENRE_ID,
            )
            if column in df.columns
        ]
        genre_value_list_column = "__chronicle_genre_values"
        broad_category_expr = pl.coalesce([*(self._blank_to_null_expr(column) for column in broad_category_candidates), pl.lit("Unknown")]).alias(
            Column.BROAD_APP_CATEGORY
        )
        if genre_id_candidates:
            df = df.with_columns(
                pl.concat_list([self._blank_to_null_expr(column).cast(pl.String) for column in genre_id_candidates])
                .list.drop_nulls()
                .alias(genre_value_list_column)
            )
            unanimous_genre_expr = pl.col(genre_value_list_column).list.n_unique() <= 1
            genre_id_expr = (
                pl.when(pl.col(genre_value_list_column).list.len() == 0)
                .then(pl.lit("Unknown"))
                .when(unanimous_genre_expr)
                .then(pl.col(genre_value_list_column).list.first())
                .otherwise(self._null_string_expr())
                .alias(Column.GENRE_ID_SCRAPED)
            )
            source_genre_exprs = [
                pl.when(unanimous_genre_expr).then(self._null_string_expr()).otherwise(pl.col(column).cast(pl.String)).alias(column)
                for column in genre_id_candidates
            ]
            return df.with_columns([broad_category_expr, genre_id_expr, *source_genre_exprs]).drop(genre_value_list_column)

        genre_id_expr = pl.lit("Unknown").alias(Column.GENRE_ID_SCRAPED)
        return df.with_columns([broad_category_expr, genre_id_expr])

    def _add_app_usage_detail_columns(self, df: pl.DataFrame) -> pl.DataFrame:
        row_count = len(df)
        interaction_values = df.get_column(Column.INTERACTION_TYPE).to_numpy()
        app_packages = df.get_column(Column.APP_PACKAGE_NAME).fill_null("").to_numpy()
        start_ns = df.get_column(Column.START_TIMESTAMP).dt.epoch("ns").fill_null(_MISSING_INT64).to_numpy()
        stop_ns = df.get_column(Column.STOP_TIMESTAMP).dt.epoch("ns").fill_null(_MISSING_INT64).to_numpy()

        custom_duration = self.options.custom_app_engagement_duration
        any_engage_30 = np.zeros(row_count, dtype=np.int64)
        any_engage_custom = np.zeros(row_count, dtype=np.int64)
        any_switched = np.zeros(row_count, dtype=np.int64)
        any_gap = np.zeros(row_count, dtype=np.float64)
        valid_engage_30 = np.zeros(row_count, dtype=np.int64)
        valid_engage_custom = np.zeros(row_count, dtype=np.int64)
        valid_switched = np.zeros(row_count, dtype=np.int64)
        valid_gap = np.zeros(row_count, dtype=np.float64)

        any_usage_indices = np.where(
            np.isin(
                interaction_values,
                [str(InteractionType.APP_USAGE), str(InteractionType.FILTERED_APP_USAGE)],
            )
        )[0]
        valid_usage_indices = np.where(interaction_values == str(InteractionType.APP_USAGE))[0]

        def apply_usage_metrics(
            indices: np.ndarray,
            *,
            engage_30: np.ndarray,
            engage_custom: np.ndarray,
            switched: np.ndarray,
            gap: np.ndarray,
        ) -> None:
            if len(indices) == 0:
                return
            first_index = int(indices[0])
            engage_30[first_index] = 1
            engage_custom[first_index] = 1
            if len(indices) == 1:
                return
            current_indices = indices[1:]
            previous_indices = indices[:-1]
            time_gaps_seconds = (start_ns[current_indices] - stop_ns[previous_indices]) / 1_000_000_000.0
            switched_mask = app_packages[current_indices] != app_packages[previous_indices]
            switched[current_indices[switched_mask]] = 1
            engage_30[current_indices[time_gaps_seconds > 30]] = 1
            engage_custom[current_indices[time_gaps_seconds > custom_duration]] = 1
            gap[current_indices] = time_gaps_seconds / 3600.0

        apply_usage_metrics(
            any_usage_indices,
            engage_30=any_engage_30,
            engage_custom=any_engage_custom,
            switched=any_switched,
            gap=any_gap,
        )
        apply_usage_metrics(
            valid_usage_indices,
            engage_30=valid_engage_30,
            engage_custom=valid_engage_custom,
            switched=valid_switched,
            gap=valid_gap,
        )

        return df.with_columns(
            [
                pl.Series(Column.ANY_APP_NEW_ENGAGE_30S, any_engage_30),
                pl.Series(
                    Column.ANY_APP_NEW_ENGAGE_CUSTOM.format(custom_duration),
                    any_engage_custom,
                ),
                pl.Series(Column.ANY_APP_SWITCHED_APP, any_switched),
                pl.Series(Column.ANY_APP_USAGE_TIME_GAP_HOURS, any_gap),
                pl.Series(Column.VALID_APP_NEW_ENGAGE_30S, valid_engage_30),
                pl.Series(
                    Column.VALID_APP_NEW_ENGAGE_CUSTOM.format(custom_duration),
                    valid_engage_custom,
                ),
                pl.Series(Column.VALID_APP_SWITCHED_APP, valid_switched),
                pl.Series(Column.VALID_APP_USAGE_TIME_GAP_HOURS, valid_gap),
            ]
        )

    def _mark_app_usage_flags(self, df: pl.DataFrame) -> pl.DataFrame:
        thresholds_to_use = list(self.options.long_data_time_gap_thresholds)
        duration_thresholds_to_use = list(self.options.long_usage_duration_thresholds)
        if not thresholds_to_use:
            thresholds_to_use = list(DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS)
        if not duration_thresholds_to_use:
            duration_thresholds_to_use = list(DEFAULT_LONG_USAGE_DURATION_THRESHOLDS)

        gap_label_column = "__chronicle_time_gap_flag"
        duration_label_column = "__chronicle_duration_flag"

        gap_label_expr = pl.coalesce(
            [
                pl.when(pl.col(Column.DATA_TIME_GAP_HOURS).cast(pl.Float64) >= float(threshold)).then(pl.lit(f">{threshold}-HR TIME GAP"))
                for threshold in sorted(thresholds_to_use, reverse=True)
            ]
            + [pl.lit("")]
        )
        duration_hours_expr = pl.col(Column.DURATION_MINUTES).cast(pl.Float64) / 60.0
        duration_label_expr = pl.coalesce(
            [
                pl.when(duration_hours_expr >= float(threshold)).then(pl.lit(f">{threshold}-HR APP USAGE"))
                for threshold in sorted(duration_thresholds_to_use, reverse=True)
            ]
            + [pl.lit("")]
        )

        return (
            df.with_columns(
                [
                    gap_label_expr.alias(gap_label_column),
                    duration_label_expr.alias(duration_label_column),
                ]
            )
            .with_columns(
                pl.when((pl.col(gap_label_column) == "") & (pl.col(duration_label_column) == ""))
                .then(pl.lit("[]"))
                .when(pl.col(duration_label_column) == "")
                .then(pl.format("['{}']", pl.col(gap_label_column)))
                .when(pl.col(gap_label_column) == "")
                .then(pl.format("['{}']", pl.col(duration_label_column)))
                .otherwise(
                    pl.format(
                        "['{}', '{}']",
                        pl.col(gap_label_column),
                        pl.col(duration_label_column),
                    )
                )
                .alias(Column.ANY_APP_USAGE_FLAGS)
            )
            .drop([gap_label_column, duration_label_column])
        )

    def _remove_selected_interaction_types(self, df: pl.DataFrame) -> pl.DataFrame:
        threshold_hours = min(
            self.options.long_data_time_gap_thresholds,
            default=min(DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS),
        )
        if not self.options.interaction_types_to_remove:
            return df
        return df.filter(
            ~pl.col(Column.INTERACTION_TYPE).is_in([str(value) for value in self.options.interaction_types_to_remove])
            | (pl.col(Column.DATA_TIME_GAP_HOURS) >= threshold_hours)
        ).sort(Column.EVENT_TIMESTAMP)

    def _build_output_columns(self, df: pl.DataFrame) -> list[str]:
        include_legacy_codebook_aliases = not (self.options.use_app_codebook and self.app_codebook is not None)
        identification_columns = [
            Column.STUDY_ID,
            Column.STUDY_NAME,
            Column.PARTICIPANT_ID,
            Column.POSSIBLE_DEVICE_MODEL,
            Column.USERNAME,
        ]
        timestamp_columns = [Column.EVENT_TIMESTAMP, Column.DATE, Column.TIMEZONE]
        app_core_columns = [
            Column.APP_PACKAGE_NAME,
            Column.APPLICATION_LABEL,
            Column.GENRE_ID_SCRAPED,
            *([Column.BROAD_APP_CATEGORY] if include_legacy_codebook_aliases else []),
            *_CODEBOOK_OUTPUT_COLUMNS,
            Column.INTERACTION_TYPE,
        ]
        timestamp_continuation = [
            Column.START_TIMESTAMP,
            Column.STOP_TIMESTAMP,
            Column.DURATION_SECONDS,
            Column.DURATION_MINUTES,
            Column.SCREEN_USAGE_END_REASON,
            Column.SCREEN_USAGE_END_REASON_CONFIDENCE,
            Column.SCREEN_USAGE_STOP_EVENT_TYPE,
            Column.SCREEN_USAGE_LAST_ACTIVITY_TIMESTAMP,
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE,
            Column.SCREEN_USAGE_APPS_FORCING_SCREEN_OPEN_LABEL,
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY,
            Column.ANY_APP_USAGE_FLAGS,
            Column.DATA_TIME_GAP_HOURS,
            Column.DAY,
            Column.WEEKDAY_MF,
            Column.WEEKDAY_MTH,
            Column.WEEKDAY_SUTH,
            Column.HOUR,
            Column.QUARTER,
        ]
        app_derived_columns = [
            Column.VALID_APP_NEW_ENGAGE_30S,
            Column.VALID_APP_NEW_ENGAGE_CUSTOM.format(self.options.custom_app_engagement_duration),
            Column.VALID_APP_SWITCHED_APP,
            Column.VALID_APP_USAGE_TIME_GAP_HOURS,
            Column.ANY_APP_NEW_ENGAGE_30S,
            Column.ANY_APP_NEW_ENGAGE_CUSTOM.format(self.options.custom_app_engagement_duration),
            Column.ANY_APP_SWITCHED_APP,
            Column.ANY_APP_USAGE_TIME_GAP_HOURS,
        ]
        admin_columns = [Column.PREPROCESSOR_VERSION, Column.DATETIME_OF_PREPROCESSING]
        return [
            *identification_columns,
            *timestamp_columns,
            *app_core_columns,
            *timestamp_continuation,
            *app_derived_columns,
            *admin_columns,
        ]

    def _format_output_frame(self, df: pl.DataFrame) -> pl.DataFrame:
        list_columns = [column for column, dtype in df.schema.items() if dtype.base_type() == pl.List]

        expressions = []
        for column in (Column.START_TIMESTAMP, Column.STOP_TIMESTAMP):
            if column in df.columns and isinstance(df.schema[column], pl.Datetime):
                expressions.append(pl.col(column).dt.strftime("%m-%d-%Y %H:%M:%S").alias(column))
        if Column.EVENT_TIMESTAMP in df.columns:
            event_dtype = df.schema[Column.EVENT_TIMESTAMP]
            event_format = (
                "%Y-%m-%d %H:%M:%S%:z" if isinstance(event_dtype, pl.Datetime) and event_dtype.time_zone is not None else "%Y-%m-%d %H:%M:%S"
            )
            expressions.append(pl.col(Column.EVENT_TIMESTAMP).dt.strftime(event_format).alias(Column.EVENT_TIMESTAMP))

        for column in list_columns:
            expressions.append(
                pl.when(pl.col(column).is_null())
                .then(pl.lit(""))
                .otherwise(
                    pl.concat_str(
                        [
                            pl.lit("["),
                            pl.col(column).list.eval(pl.format("'{}'", pl.element())).list.join(", "),
                            pl.lit("]"),
                        ]
                    )
                )
                .alias(column)
            )

        return df.with_columns(expressions) if expressions else df
