"""Study date range lookups for Polars dataframes."""

from __future__ import annotations

import datetime
import logging
import re
from typing import Any

import polars as pl

LOGGER = logging.getLogger(__name__)


def _extract_numerical_id(participant_id: str) -> str | None:
    if not participant_id:
        return None
    match = re.search(r"P\d+-(\d+)", str(participant_id))
    if match:
        return match.group(1)
    if str(participant_id).isdigit():
        return str(participant_id)
    return None


def _coerce_to_datetime(
    value: Any,
    timestamp_dtype: pl.DataType | type[pl.DataType] | None = None,
) -> Any:
    if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
        if isinstance(timestamp_dtype, pl.Datetime):
            return pl.select(
                pl.datetime(
                    value.year,
                    value.month,
                    value.day,
                    time_unit=timestamp_dtype.time_unit,
                    time_zone=timestamp_dtype.time_zone,
                )
            ).item()
        if timestamp_dtype is None:
            return datetime.datetime(value.year, value.month, value.day, tzinfo=datetime.UTC)
        return datetime.datetime(value.year, value.month, value.day)
    return value


try:
    from chronicle_preprocessing_internal import (
        ParticipantID,
        ProjectOneProjectTwoTrackingSheet,
        TECHParticipantID,
        TrackingSheet,
    )

    INTERNAL_MODULES_AVAILABLE = True
except ImportError:
    INTERNAL_MODULES_AVAILABLE = False
    LOGGER.debug("Internal modules not available - study date range lookup disabled")


class StudyDateRangeProvider:
    """Resolve study date ranges from injected maps or internal tracking sheets."""

    def __init__(self, study_date_map: dict[str, tuple[Any, Any]] | None = None) -> None:
        self._study_date_map = study_date_map or {}
        self._tracking_sheet_cache: dict[str, Any] = {}

    @property
    def is_available(self) -> bool:
        return bool(self._study_date_map) or INTERNAL_MODULES_AVAILABLE

    def set_study_date_map(self, study_date_map: dict[str, tuple[Any, Any]]) -> None:
        self._study_date_map = study_date_map

    def set_study_dates_for_participant(
        self,
        participant_id: str,
        start_date: Any,
        end_date: Any,
    ) -> None:
        self._study_date_map[participant_id] = (start_date, end_date)

    def get_study_date_range(self, participant_id: str) -> tuple[Any, Any] | None:
        if participant_id in self._study_date_map:
            return self._study_date_map[participant_id]

        numerical_id = _extract_numerical_id(participant_id)
        if numerical_id:
            for map_key, dates in self._study_date_map.items():
                if _extract_numerical_id(map_key) == numerical_id:
                    return dates

        if not INTERNAL_MODULES_AVAILABLE:
            return None

        try:
            validated_id = ParticipantID.validate_participant_id(participant_id)
            if isinstance(validated_id, TECHParticipantID):
                cache_key = "ProjectOneProjectTwoTrackingSheet"
                if cache_key not in self._tracking_sheet_cache:
                    self._tracking_sheet_cache[cache_key] = ProjectOneProjectTwoTrackingSheet(
                        force_redownload=False
                    )
                date_tracking_sheet = self._tracking_sheet_cache[cache_key]
                study_date_range = date_tracking_sheet.get_specific_participant_study_date_range(
                    participant_id=validated_id
                )
            else:
                cache_key = type(validated_id).__name__
                if cache_key not in self._tracking_sheet_cache:
                    self._tracking_sheet_cache[cache_key] = (
                        TrackingSheet.get_correct_tracking_sheet_for_participant(validated_id)
                    )
                tracking_sheet = self._tracking_sheet_cache[cache_key]
                study_date_range = tracking_sheet.get_specific_participant_study_date_range(
                    participant_id=validated_id
                )

            if study_date_range is None or len(study_date_range) == 0:
                return None
            return study_date_range.min(), study_date_range.max()
        except Exception as exc:
            LOGGER.warning("Failed to get study date range for %s: %s", participant_id, exc)
            return None

    def filter_data_to_study_dates(
        self,
        df: pl.DataFrame,
        participant_id: str,
        timestamp_column: str = "event_timestamp",
    ) -> pl.DataFrame:
        if df.is_empty():
            return df

        date_range = self.get_study_date_range(participant_id)
        if date_range is None or timestamp_column not in df.columns:
            return df

        start_date, end_date = date_range
        timestamp_dtype = df.schema[timestamp_column]
        start_scalar = pl.Series(
            [_coerce_to_datetime(start_date, timestamp_dtype)], dtype=timestamp_dtype
        ).item()
        end_scalar = pl.Series(
            [_coerce_to_datetime(end_date, timestamp_dtype)], dtype=timestamp_dtype
        ).item()
        exclusive_end_value = end_scalar + datetime.timedelta(days=1)

        return df.filter(
            pl.col(timestamp_column).is_not_null()
            & (pl.col(timestamp_column) >= start_scalar)
            & (pl.col(timestamp_column) < exclusive_end_value)
        )
