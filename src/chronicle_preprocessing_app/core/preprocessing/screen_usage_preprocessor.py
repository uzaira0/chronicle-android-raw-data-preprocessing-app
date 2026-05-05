"""Screen usage session derivation for Chronicle Android data."""

from __future__ import annotations

import bisect
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class ScreenUsageEndReason:
    PROBABLE_MANUAL_LOCK = "probable_manual_lock"
    PROBABLE_AUTO_LOCK = "probable_auto_lock"
    APP_KEPT_AWAKE_OR_EXTENDED = "app_kept_awake_or_extended"
    LOCK_SCREEN_ONLY = "lock_screen_only"
    EXTENDED_IDLE_OR_UNKNOWN = "extended_idle_or_unknown"
    UNKNOWN = "unknown"
    MISSING_STOP = "missing_stop"


@dataclass
class _ScreenSessionState:
    start_index: int
    start_timestamp: datetime
    start_timezone: Any = None
    lock_screen_seen: bool = False
    unlocked_seen: bool = False
    foreground_app_package: str | None = None
    last_meaningful_activity_timestamp: datetime | None = None
    last_meaningful_activity_package: str | None = None


@dataclass(frozen=True)
class _EndReason:
    reason: str
    confidence: float
    tail_gap_seconds: float | None
    apps_forcing_screen_open_label: str
    lock_screen_only: bool


class ScreenUsagePreprocessor(BasePreprocessor):
    """Derive screen-on sessions and inferred end reasons."""

    SCREEN_START_EVENTS: frozenset[str] = frozenset(
        {
            str(InteractionType.SCREEN_INTERACTIVE),
            str(InteractionType.SCREEN_INTERACTIVE_KEYGUARD_SHOWN),
        }
    )
    SCREEN_STOP_EVENTS: frozenset[str] = frozenset(
        {
            str(InteractionType.SCREEN_NON_INTERACTIVE),
            str(InteractionType.DEVICE_SCREEN_OFF),
            str(InteractionType.SCREEN_NON_INTERACTIVE_KEYGUARD_HIDDEN),
        }
    )
    LOCK_SCREEN_EVENTS: frozenset[str] = frozenset(
        {
            str(InteractionType.KEYGUARD_SHOWN),
            str(InteractionType.SCREEN_INTERACTIVE_KEYGUARD_SHOWN),
        }
    )
    UNLOCK_EVENTS: frozenset[str] = frozenset(
        {
            str(InteractionType.KEYGUARD_HIDDEN),
            str(InteractionType.USER_UNLOCKED),
            str(InteractionType.SCREEN_NON_INTERACTIVE_KEYGUARD_HIDDEN),
        }
    )
    FOREGROUND_EVENTS: frozenset[str] = frozenset(
        {
            str(InteractionType.ACTIVITY_RESUMED),
            str(InteractionType.FILTERED_APP_RESUMED),
        }
    )
    MEANINGFUL_ACTIVITY_EVENTS: frozenset[str] = frozenset(
        {
            str(InteractionType.ACTIVITY_RESUMED),
            str(InteractionType.FILTERED_APP_RESUMED),
            str(InteractionType.USER_INTERACTION),
            str(InteractionType.SHORTCUT_INVOCATION),
            str(InteractionType.CHOOSER_ACTION),
            str(InteractionType.APP_COMPONENT_USED),
            str(InteractionType.USER_UNLOCKED),
            str(InteractionType.KEYGUARD_HIDDEN),
        }
    )

    def preprocess(self, df: pl.DataFrame) -> pl.DataFrame:
        return self.derive_screen_usage_sessions(df)

    def derive_screen_usage_sessions(self, df: pl.DataFrame) -> pl.DataFrame:
        df_copy = df.clone()
        if not self.options.process_screen_usage_sessions:
            return df_copy

        required_columns = {Column.EVENT_TIMESTAMP, Column.INTERACTION_TYPE}
        missing_columns = required_columns - set(df_copy.columns)
        if missing_columns:
            raise ValueError("Cannot derive screen usage sessions because required columns are missing: " + ", ".join(sorted(missing_columns)))

        interaction_values = df_copy.get_column(Column.INTERACTION_TYPE).cast(pl.String).to_list()
        if not any(value in self.SCREEN_START_EVENTS for value in interaction_values):
            return df_copy

        rows = list(df_copy.iter_rows(named=True))
        keyguard_shown_timestamps = sorted(
            row[Column.EVENT_TIMESTAMP]
            for row in rows
            if str(row[Column.INTERACTION_TYPE]) in self.LOCK_SCREEN_EVENTS and row.get(Column.EVENT_TIMESTAMP) is not None
        )

        sessions: list[dict[str, Any]] = []
        state: _ScreenSessionState | None = None

        for index, row in enumerate(rows):
            interaction_type = str(row[Column.INTERACTION_TYPE])
            timestamp = row[Column.EVENT_TIMESTAMP]
            if timestamp is None:
                continue
            package_name = self._clean_package_name(row.get(Column.APP_PACKAGE_NAME))

            if interaction_type in self.SCREEN_START_EVENTS:
                if state is None:
                    state = _ScreenSessionState(
                        start_index=index,
                        start_timestamp=timestamp,
                        start_timezone=row.get(Column.TIMEZONE),
                        lock_screen_seen=interaction_type in self.LOCK_SCREEN_EVENTS,
                    )
                continue

            if state is None:
                continue

            if interaction_type in self.LOCK_SCREEN_EVENTS:
                state.lock_screen_seen = True
            if interaction_type in self.UNLOCK_EVENTS:
                state.unlocked_seen = True
            if interaction_type in self.FOREGROUND_EVENTS:
                state.foreground_app_package = package_name
            if interaction_type in self.MEANINGFUL_ACTIVITY_EVENTS:
                state.last_meaningful_activity_timestamp = timestamp
                state.last_meaningful_activity_package = package_name or state.foreground_app_package

            if interaction_type in self.SCREEN_STOP_EVENTS:
                sessions.append(
                    self._build_session_row(
                        source_rows=rows,
                        source_columns=df_copy.columns,
                        state=state,
                        stop_timestamp=timestamp,
                        stop_event_type=interaction_type,
                        keyguard_shown_timestamps=keyguard_shown_timestamps,
                    )
                )
                state = None

        if state is not None:
            sessions.append(
                self._build_session_row(
                    source_rows=rows,
                    source_columns=df_copy.columns,
                    state=state,
                    stop_timestamp=None,
                    stop_event_type=None,
                    keyguard_shown_timestamps=keyguard_shown_timestamps,
                )
            )

        if not sessions:
            return df_copy

        session_df = pl.DataFrame(sessions)
        shared_columns = [column for column in session_df.columns if column in df_copy.columns]
        if shared_columns:
            source_casts: list[pl.Expr] = []
            session_casts: list[pl.Expr] = []
            for column in shared_columns:
                source_dtype = df_copy.schema[column]
                session_dtype = session_df.schema[column]
                if source_dtype == session_dtype:
                    continue
                if source_dtype == pl.Null and session_dtype != pl.Null:
                    source_casts.append(pl.col(column).cast(session_dtype, strict=False).alias(column))
                elif session_dtype == pl.Null and source_dtype != pl.Null:
                    session_casts.append(pl.col(column).cast(source_dtype, strict=False).alias(column))
                else:
                    session_casts.append(pl.col(column).cast(source_dtype, strict=False).alias(column))
            if source_casts:
                df_copy = df_copy.with_columns(source_casts)
            if session_casts:
                session_df = session_df.with_columns(session_casts)
        return pl.concat([df_copy, session_df], how="diagonal").sort(Column.EVENT_TIMESTAMP)

    def _build_session_row(
        self,
        *,
        source_rows: list[dict[str, Any]],
        source_columns: list[str],
        state: _ScreenSessionState,
        stop_timestamp: datetime | None,
        stop_event_type: str | None,
        keyguard_shown_timestamps: list[datetime],
    ) -> dict[str, Any]:
        end_reason = self._classify_end_reason(
            state=state,
            stop_timestamp=stop_timestamp,
            keyguard_shown_timestamps=keyguard_shown_timestamps,
        )
        session_columns = set(source_columns) | {
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
        }
        session_row = dict.fromkeys(session_columns)
        start_row = source_rows[state.start_index]

        for column in (
            Column.STUDY_ID,
            Column.PARTICIPANT_ID,
            Column.USERNAME,
            Column.POSSIBLE_DEVICE_MODEL,
            Column.PREPROCESSOR_VERSION,
            Column.DATETIME_OF_PREPROCESSING,
        ):
            if column in start_row:
                session_row[column] = start_row.get(column)

        session_row[Column.EVENT_TIMESTAMP] = state.start_timestamp
        session_row[Column.START_TIMESTAMP] = state.start_timestamp
        session_row[Column.STOP_TIMESTAMP] = stop_timestamp
        session_row[Column.INTERACTION_TYPE] = str(InteractionType.SCREEN_USAGE)
        session_row[Column.APP_PACKAGE_NAME] = state.foreground_app_package
        session_row[Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE] = state.foreground_app_package
        session_row[Column.SCREEN_USAGE_END_REASON] = end_reason.reason
        session_row[Column.SCREEN_USAGE_END_REASON_CONFIDENCE] = end_reason.confidence
        session_row[Column.SCREEN_USAGE_STOP_EVENT_TYPE] = stop_event_type
        session_row[Column.SCREEN_USAGE_LAST_ACTIVITY_TIMESTAMP] = state.last_meaningful_activity_timestamp
        session_row[Column.SCREEN_USAGE_TAIL_GAP_SECONDS] = end_reason.tail_gap_seconds
        session_row[Column.SCREEN_USAGE_APPS_FORCING_SCREEN_OPEN_LABEL] = end_reason.apps_forcing_screen_open_label
        session_row[Column.SCREEN_USAGE_LOCK_SCREEN_ONLY] = end_reason.lock_screen_only
        if state.start_timezone is not None:
            session_row[Column.TIMEZONE] = state.start_timezone

        if stop_timestamp is not None:
            duration_seconds = (stop_timestamp - state.start_timestamp).total_seconds()
            session_row[Column.DURATION_SECONDS] = duration_seconds
            session_row[Column.DURATION_MINUTES] = duration_seconds / 60.0

        self._populate_time_columns(session_row, state.start_timestamp)
        return session_row

    def _classify_end_reason(
        self,
        *,
        state: _ScreenSessionState,
        stop_timestamp: datetime | None,
        keyguard_shown_timestamps: list[datetime],
    ) -> _EndReason:
        if stop_timestamp is None:
            return _EndReason(ScreenUsageEndReason.MISSING_STOP, 1.0, None, "", False)

        tail_gap_seconds = None
        if state.last_meaningful_activity_timestamp is not None:
            tail_gap_seconds = (stop_timestamp - state.last_meaningful_activity_timestamp).total_seconds()

        apps_forcing_screen_open_label = ""
        last_package = state.last_meaningful_activity_package or state.foreground_app_package
        if last_package:
            apps_forcing_screen_open_label = self.options.apps_forcing_screen_open_dict.get(last_package, "")

        if state.lock_screen_seen and not state.unlocked_seen and state.foreground_app_package is None:
            return _EndReason(ScreenUsageEndReason.LOCK_SCREEN_ONLY, 0.95, None, "", True)

        if tail_gap_seconds is not None:
            if apps_forcing_screen_open_label and tail_gap_seconds > self.options.screen_usage_auto_lock_timeout_seconds:
                return _EndReason(
                    ScreenUsageEndReason.APP_KEPT_AWAKE_OR_EXTENDED,
                    0.9,
                    tail_gap_seconds,
                    apps_forcing_screen_open_label,
                    False,
                )
            if tail_gap_seconds <= self.options.screen_usage_manual_lock_max_tail_gap_seconds:
                return _EndReason(
                    ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
                    0.85,
                    tail_gap_seconds,
                    apps_forcing_screen_open_label,
                    False,
                )

            auto_lock = self.options.screen_usage_auto_lock_timeout_seconds
            tolerance = self.options.screen_usage_auto_lock_tolerance_seconds
            if abs(tail_gap_seconds - auto_lock) <= tolerance:
                return _EndReason(
                    ScreenUsageEndReason.PROBABLE_AUTO_LOCK,
                    0.9,
                    tail_gap_seconds,
                    apps_forcing_screen_open_label,
                    False,
                )

        if state.lock_screen_seen:
            index = bisect.bisect_left(keyguard_shown_timestamps, stop_timestamp)
            near_stop = False
            for candidate_index in (index - 1, index):
                if 0 <= candidate_index < len(keyguard_shown_timestamps):
                    if (
                        abs((keyguard_shown_timestamps[candidate_index] - stop_timestamp).total_seconds())
                        <= self.options.screen_usage_keyguard_near_stop_seconds
                    ):
                        near_stop = True
                        break
            if near_stop:
                return _EndReason(
                    ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
                    0.7,
                    tail_gap_seconds,
                    apps_forcing_screen_open_label,
                    False,
                )

        if tail_gap_seconds is not None:
            return _EndReason(
                ScreenUsageEndReason.EXTENDED_IDLE_OR_UNKNOWN,
                0.5,
                tail_gap_seconds,
                apps_forcing_screen_open_label,
                False,
            )

        return _EndReason(ScreenUsageEndReason.UNKNOWN, 0.25, None, apps_forcing_screen_open_label, False)

    @staticmethod
    def _clean_package_name(value: Any) -> str | None:
        if value is None:
            return None
        package_name = str(value).strip()
        return package_name or None

    @staticmethod
    def _populate_time_columns(session_row: dict[str, Any], timestamp: datetime) -> None:
        session_row[Column.DATE] = timestamp.date()
        weekday = timestamp.weekday()
        session_row[Column.DAY] = ((weekday + 1) % 7) + 1
        session_row[Column.WEEKDAY_MF] = int(weekday < 5)
        session_row[Column.WEEKDAY_MTH] = int(weekday < 4)
        session_row[Column.WEEKDAY_SUTH] = int(weekday < 4 or weekday == 6)
        session_row[Column.HOUR] = timestamp.hour
        session_row[Column.QUARTER] = ((timestamp.month - 1) // 3) + 1
