"""Screen usage session derivation for Chronicle Android data."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import pandas as pd

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class ScreenUsageEndReason:
    """Stable string values for inferred screen-session end reasons."""

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
    start_timestamp: pd.Timestamp
    start_timezone: Any = None
    lock_screen_seen: bool = False
    unlocked_seen: bool = False
    foreground_app_package: str | None = None
    last_meaningful_activity_timestamp: pd.Timestamp | None = None
    last_meaningful_activity_package: str | None = None


@dataclass(frozen=True)
class _EndReason:
    reason: str
    confidence: float
    tail_gap_seconds: float | None
    keep_awake_app_label: str
    lock_screen_only: bool


class ScreenUsagePreprocessor(BasePreprocessor):
    """Derive screen-on sessions and inferred end reasons.

    This preprocessor appends derived ``Screen Usage`` rows. It does not remove
    or mutate raw screen/keyguard/app lifecycle events.
    """

    SCREEN_START_EVENTS = {
        InteractionType.SCREEN_INTERACTIVE,
        InteractionType.SCREEN_INTERACTIVE_KEYGUARD_SHOWN,
    }
    SCREEN_STOP_EVENTS = {
        InteractionType.SCREEN_NON_INTERACTIVE,
        InteractionType.DEVICE_SCREEN_OFF,
        InteractionType.SCREEN_NON_INTERACTIVE_KEYGUARD_HIDDEN,
    }
    LOCK_SCREEN_EVENTS = {
        InteractionType.KEYGUARD_SHOWN,
        InteractionType.SCREEN_INTERACTIVE_KEYGUARD_SHOWN,
    }
    UNLOCK_EVENTS = {
        InteractionType.KEYGUARD_HIDDEN,
        InteractionType.USER_UNLOCKED,
        InteractionType.SCREEN_NON_INTERACTIVE_KEYGUARD_HIDDEN,
    }
    FOREGROUND_EVENTS = {
        InteractionType.ACTIVITY_RESUMED,
        InteractionType.FILTERED_APP_RESUMED,
    }
    MEANINGFUL_ACTIVITY_EVENTS = {
        InteractionType.ACTIVITY_RESUMED,
        InteractionType.FILTERED_APP_RESUMED,
        InteractionType.USER_INTERACTION,
        InteractionType.SHORTCUT_INVOCATION,
        InteractionType.CHOOSER_ACTION,
        InteractionType.APP_COMPONENT_USED,
        InteractionType.USER_UNLOCKED,
        InteractionType.KEYGUARD_HIDDEN,
    }

    def preprocess(self, df: pd.DataFrame) -> pd.DataFrame:
        """Append derived screen usage rows when enabled."""
        return self.derive_screen_usage_sessions(df)

    def derive_screen_usage_sessions(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Append screen usage rows derived from screen interactive/non-interactive events.

        Returns the input rows plus derived rows sorted by event timestamp. If
        ``derive_screen_usage_sessions`` is disabled, returns a shallow copy.
        """
        df_copy = df.reset_index(drop=True).copy()
        if not self.options.process_screen_usage_sessions:
            return df_copy

        required_columns = {Column.EVENT_TIMESTAMP, Column.INTERACTION_TYPE}
        missing_columns = required_columns - set(df_copy.columns)
        if missing_columns:
            msg = (
                "Cannot derive screen usage sessions because required columns are "
                f"missing: {', '.join(sorted(missing_columns))}"
            )
            raise ValueError(msg)

        if not df_copy[Column.INTERACTION_TYPE].isin(self.SCREEN_START_EVENTS).any():
            LOGGER.debug("No screen start events found")
            return df_copy

        keyguard_shown_timestamps = [
            pd.Timestamp(timestamp)
            for timestamp in df_copy.loc[
                df_copy[Column.INTERACTION_TYPE].isin(self.LOCK_SCREEN_EVENTS),
                Column.EVENT_TIMESTAMP,
            ]
        ]

        sessions: list[dict[str, Any]] = []
        state: _ScreenSessionState | None = None

        for index, row in df_copy.iterrows():
            interaction_type = row[Column.INTERACTION_TYPE]
            timestamp = pd.Timestamp(row[Column.EVENT_TIMESTAMP])
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
                state.last_meaningful_activity_package = (
                    package_name or state.foreground_app_package
                )

            if interaction_type in self.SCREEN_STOP_EVENTS:
                sessions.append(
                    self._build_session_row(
                        source_df=df_copy,
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
                    source_df=df_copy,
                    state=state,
                    stop_timestamp=None,
                    stop_event_type=None,
                    keyguard_shown_timestamps=keyguard_shown_timestamps,
                )
            )

        if not sessions:
            return df_copy

        result = pd.concat([df_copy, pd.DataFrame(sessions)], ignore_index=True)
        return result.sort_values(Column.EVENT_TIMESTAMP, kind="mergesort").reset_index(
            drop=True
        )

    def _build_session_row(
        self,
        *,
        source_df: pd.DataFrame,
        state: _ScreenSessionState,
        stop_timestamp: pd.Timestamp | None,
        stop_event_type: InteractionType | None,
        keyguard_shown_timestamps: list[pd.Timestamp],
    ) -> dict[str, Any]:
        end_reason = self._classify_end_reason(
            state=state,
            stop_timestamp=stop_timestamp,
            keyguard_shown_timestamps=keyguard_shown_timestamps,
        )

        session_row = {column: pd.NA for column in source_df.columns}
        start_row = source_df.iloc[state.start_index]
        for column in (
            Column.STUDY_ID,
            Column.PARTICIPANT_ID,
            Column.USERNAME,
            Column.POSSIBLE_DEVICE_MODEL,
            Column.PREPROCESSOR_VERSION,
            Column.DATETIME_OF_PREPROCESSING,
        ):
            if column in source_df.columns:
                session_row[column] = start_row.get(column, pd.NA)

        session_row[Column.EVENT_TIMESTAMP] = state.start_timestamp
        session_row[Column.START_TIMESTAMP] = state.start_timestamp
        session_row[Column.STOP_TIMESTAMP] = (
            stop_timestamp if stop_timestamp is not None else pd.NaT
        )
        session_row[Column.INTERACTION_TYPE] = InteractionType.SCREEN_USAGE
        session_row[Column.APP_PACKAGE_NAME] = state.foreground_app_package
        session_row[Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE] = state.foreground_app_package
        session_row[Column.SCREEN_USAGE_END_REASON] = end_reason.reason
        session_row[Column.SCREEN_USAGE_END_REASON_CONFIDENCE] = end_reason.confidence
        session_row[Column.SCREEN_USAGE_STOP_EVENT_TYPE] = stop_event_type
        session_row[Column.SCREEN_USAGE_LAST_ACTIVITY_TIMESTAMP] = (
            state.last_meaningful_activity_timestamp
            if state.last_meaningful_activity_timestamp is not None
            else pd.NaT
        )
        session_row[Column.SCREEN_USAGE_TAIL_GAP_SECONDS] = end_reason.tail_gap_seconds
        session_row[Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL] = end_reason.keep_awake_app_label
        session_row[Column.SCREEN_USAGE_LOCK_SCREEN_ONLY] = end_reason.lock_screen_only

        if state.start_timezone is not None and Column.TIMEZONE in source_df.columns:
            session_row[Column.TIMEZONE] = state.start_timezone

        if stop_timestamp is not None:
            duration_seconds = (stop_timestamp - state.start_timestamp).total_seconds()
            session_row[Column.DURATION_SECONDS] = duration_seconds
            session_row[Column.DURATION_MINUTES] = duration_seconds / 60
        else:
            session_row[Column.DURATION_SECONDS] = pd.NA
            session_row[Column.DURATION_MINUTES] = pd.NA

        self._populate_time_columns(session_row, state.start_timestamp, source_df)
        return session_row

    def _classify_end_reason(
        self,
        *,
        state: _ScreenSessionState,
        stop_timestamp: pd.Timestamp | None,
        keyguard_shown_timestamps: list[pd.Timestamp],
    ) -> _EndReason:
        keep_awake_app_label = self._keep_awake_app_label(state.foreground_app_package)
        lock_screen_only = (
            state.lock_screen_seen
            and not state.unlocked_seen
            and state.foreground_app_package is None
        )

        if stop_timestamp is None:
            return _EndReason(
                ScreenUsageEndReason.MISSING_STOP,
                1.0,
                None,
                keep_awake_app_label,
                lock_screen_only,
            )

        if lock_screen_only:
            return _EndReason(
                ScreenUsageEndReason.LOCK_SCREEN_ONLY,
                0.95,
                None,
                keep_awake_app_label,
                True,
            )

        tail_gap_seconds = self._tail_gap_seconds(
            stop_timestamp, state.last_meaningful_activity_timestamp
        )
        if tail_gap_seconds is None:
            return _EndReason(
                ScreenUsageEndReason.UNKNOWN,
                0.25,
                None,
                keep_awake_app_label,
                False,
            )

        auto_lock_timeout = self.options.screen_usage_auto_lock_timeout_seconds
        auto_lock_tolerance = self.options.screen_usage_auto_lock_tolerance_seconds
        manual_lock_max = self.options.screen_usage_manual_lock_max_tail_gap_seconds
        keyguard_near_stop = self._has_keyguard_near_stop(
            stop_timestamp, keyguard_shown_timestamps
        )

        if keep_awake_app_label and tail_gap_seconds > auto_lock_timeout + auto_lock_tolerance:
            return _EndReason(
                ScreenUsageEndReason.APP_KEPT_AWAKE_OR_EXTENDED,
                0.8,
                tail_gap_seconds,
                keep_awake_app_label,
                False,
            )

        if keyguard_near_stop and tail_gap_seconds <= manual_lock_max:
            return _EndReason(
                ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
                0.9,
                tail_gap_seconds,
                keep_awake_app_label,
                False,
            )

        if tail_gap_seconds <= manual_lock_max:
            return _EndReason(
                ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
                0.85,
                tail_gap_seconds,
                keep_awake_app_label,
                False,
            )

        if abs(tail_gap_seconds - auto_lock_timeout) <= auto_lock_tolerance:
            return _EndReason(
                ScreenUsageEndReason.PROBABLE_AUTO_LOCK,
                0.85,
                tail_gap_seconds,
                keep_awake_app_label,
                False,
            )

        if tail_gap_seconds > auto_lock_timeout + auto_lock_tolerance:
            return _EndReason(
                ScreenUsageEndReason.EXTENDED_IDLE_OR_UNKNOWN,
                0.45,
                tail_gap_seconds,
                keep_awake_app_label,
                False,
            )

        return _EndReason(
            ScreenUsageEndReason.UNKNOWN,
            0.35,
            tail_gap_seconds,
            keep_awake_app_label,
            False,
        )

    def _has_keyguard_near_stop(
        self, stop_timestamp: pd.Timestamp, keyguard_shown_timestamps: list[pd.Timestamp]
    ) -> bool:
        near_stop_seconds = self.options.screen_usage_keyguard_near_stop_seconds
        return any(
            abs((keyguard_timestamp - stop_timestamp).total_seconds()) <= near_stop_seconds
            for keyguard_timestamp in keyguard_shown_timestamps
        )

    def _keep_awake_app_label(self, package_name: str | None) -> str:
        if not package_name:
            return ""
        return self.options.keep_awake_apps_dict.get(package_name, "")

    @staticmethod
    def _tail_gap_seconds(
        stop_timestamp: pd.Timestamp, last_activity_timestamp: pd.Timestamp | None
    ) -> float | None:
        if last_activity_timestamp is None or pd.isna(last_activity_timestamp):
            return None
        return (stop_timestamp - last_activity_timestamp).total_seconds()

    @staticmethod
    def _clean_package_name(value: Any) -> str | None:
        if value is None or pd.isna(value):
            return None
        package_name = str(value).strip()
        return package_name or None

    @staticmethod
    def _populate_time_columns(
        session_row: dict[str, Any], start_timestamp: pd.Timestamp, source_df: pd.DataFrame
    ) -> None:
        if Column.DATE in source_df.columns:
            session_row[Column.DATE] = start_timestamp.date()
        if Column.DAY in source_df.columns:
            session_row[Column.DAY] = (start_timestamp.weekday() + 1) % 7 + 1
        if Column.WEEKDAY_MF in source_df.columns:
            session_row[Column.WEEKDAY_MF] = int(start_timestamp.weekday() < 5)
        if Column.WEEKDAY_MTH in source_df.columns:
            session_row[Column.WEEKDAY_MTH] = int(start_timestamp.weekday() < 4)
        if Column.WEEKDAY_SUTH in source_df.columns:
            session_row[Column.WEEKDAY_SUTH] = int(
                start_timestamp.weekday() < 4 or start_timestamp.weekday() == 6
            )
        if Column.HOUR in source_df.columns:
            session_row[Column.HOUR] = start_timestamp.hour
        if Column.QUARTER in source_df.columns:
            session_row[Column.QUARTER] = start_timestamp.quarter
