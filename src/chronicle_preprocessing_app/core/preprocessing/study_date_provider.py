"""Study date range provider for Chronicle preprocessing.

This module provides study date range lookups, supporting multiple sources:
1. Injected study date map (from pipeline/orchestrator) - highest priority
2. Tracking sheets (internal modules) - fallback

This separation of concerns allows:
- Placeholder entries for missing dates (requires study date range)
- Filtering data to study dates only (requires study date range)
- Survey data processing (requires survey data files)

These are independent concerns that should not be coupled together.
"""

from __future__ import annotations

import logging
import re

import pandas as pd

LOGGER = logging.getLogger(__name__)


def _extract_numerical_id(participant_id: str) -> str | None:
    """Extract numerical ID from various participant ID formats.

    Handles formats like:
    - P1-1234-A -> 1234
    - P1-1234-A-D1 -> 1234
    - 1234 -> 1234

    Args:
        participant_id: Participant ID in any format

    Returns:
        Numerical ID string or None if extraction fails
    """
    if not participant_id:
        return None
    # Match P followed by digit, hyphen, digits (the numerical ID), then anything
    match = re.search(r"P\d+-(\d+)", str(participant_id))
    if match:
        return match.group(1)
    # If already just digits, return as is
    if str(participant_id).isdigit():
        return str(participant_id)
    return None

# Check for internal modules availability
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
    """Provides study date range lookups from multiple sources.
    
    This class supports two sources for study date ranges:
    1. Injected study date map (from pipeline) - takes priority
    2. Tracking sheets (internal modules) - fallback

    It is responsible for:
    - Looking up study date ranges for participants from tracking sheets
    - Caching tracking sheet instances for performance
    - Filtering data to study date ranges
    
    It is intentionally separate from SurveyDataPreprocessor to maintain
    separation of concerns. Study date ranges come from tracking sheets,
    not from survey data.
    """

    def __init__(
        self,
        study_date_map: dict[str, tuple[pd.Timestamp, pd.Timestamp]] | None = None,
    ) -> None:
        """Initialize the study date range provider.

        Args:
            study_date_map: Optional pre-computed map of participant_id -> (start_date, end_date).
                           If provided, this takes priority over tracking sheet lookups.
                           This allows the pipeline to inject study dates without internal modules.
        """
        self._study_date_map = study_date_map or {}
        self._tracking_sheet_cache: dict = {}

    @property
    def is_available(self) -> bool:
        """Check if study date range lookups are available.
        
        Returns:
            True if internal modules are available, False otherwise
        """
        return bool(self._study_date_map) or INTERNAL_MODULES_AVAILABLE

    def set_study_date_map(
        self, study_date_map: dict[str, tuple[pd.Timestamp, pd.Timestamp]]
    ) -> None:
        """Set or update the injected study date map.

        Args:
            study_date_map: Map of participant_id -> (start_date, end_date)
        """
        self._study_date_map = study_date_map
        LOGGER.info(f"Study date map set with {len(study_date_map)} entries")

    def set_study_dates_for_participant(
        self,
        participant_id: str,
        start_date: pd.Timestamp,
        end_date: pd.Timestamp,
    ) -> None:
        """Set study dates for a specific participant.

        Args:
            participant_id: Participant ID
            start_date: Study start date
            end_date: Study end date
        """
        self._study_date_map[participant_id] = (start_date, end_date)
        LOGGER.debug(f"Set study dates for {participant_id}: {start_date} to {end_date}")

    def get_study_date_range(
        self, participant_id: str
    ) -> tuple[pd.Timestamp, pd.Timestamp] | None:
        """Get the study date range for a participant.

        Priority order:
        1. Injected study date map (from pipeline)
        2. Tracking sheets (internal modules)

        Args:
            participant_id: Participant ID string

        Returns:
            Tuple of (start_date, end_date) or None if not available
        """
        # Priority 1: Check injected map (exact match)
        if participant_id in self._study_date_map:
            start_date, end_date = self._study_date_map[participant_id]
            LOGGER.debug(
                f"Got study date range for {participant_id} from injected map: "
                f"{start_date} to {end_date}"
            )
            return start_date, end_date

        # Priority 2: Try numerical ID matching (handles device_id -> redcap_id mismatch)
        # e.g., P1-1234-A-D1 (device_id) -> P1-1234-A (redcap_id) via numerical ID 1234
        numerical_id = _extract_numerical_id(participant_id)
        if numerical_id:
            for map_key, dates in self._study_date_map.items():
                map_numerical = _extract_numerical_id(map_key)
                if map_numerical == numerical_id:
                    start_date, end_date = dates
                    LOGGER.debug(
                        f"Got study date range for {participant_id} via numerical ID match "
                        f"({numerical_id} -> {map_key}): {start_date} to {end_date}"
                    )
                    return start_date, end_date

        # Priority 3: Fall back to tracking sheets (Selenium/REDCap)
        if not INTERNAL_MODULES_AVAILABLE:
            LOGGER.debug(
                f"No injected dates for {participant_id} and internal modules not available"
            )
            return None

        try:
            # Validate participant ID
            validated_id = ParticipantID.validate_participant_id(participant_id)

            # Check if this is a TECH participant - use ProjectOneProjectTwoTrackingSheet
            if isinstance(validated_id, TECHParticipantID):
                # Use cached ProjectOneProjectTwoTrackingSheet for TECH date ranges
                cache_key = "ProjectOneProjectTwoTrackingSheet"
                if cache_key not in self._tracking_sheet_cache:
                    LOGGER.debug(
                        "Creating and caching ProjectOneProjectTwoTrackingSheet for TECH participants"
                    )
                    self._tracking_sheet_cache[cache_key] = ProjectOneProjectTwoTrackingSheet(
                        force_redownload=False
                    )
                date_tracking_sheet = self._tracking_sheet_cache[cache_key]
                study_date_range = date_tracking_sheet.get_specific_participant_study_date_range(
                    participant_id=validated_id
                )
            else:
                # Use cached tracking sheet for non-TECH participants (GNSM)
                cache_key = type(validated_id).__name__
                if cache_key not in self._tracking_sheet_cache:
                    self._tracking_sheet_cache[cache_key] = (
                        TrackingSheet.get_correct_tracking_sheet_for_participant(validated_id)
                    )
                tracking_sheet = self._tracking_sheet_cache[cache_key]
                study_date_range = tracking_sheet.get_specific_participant_study_date_range(
                    participant_id=validated_id
                )

            if study_date_range is not None and len(study_date_range) > 0:
                start_date = study_date_range.min()
                end_date = study_date_range.max()
                LOGGER.debug(
                    f"Got study date range for {participant_id}: {start_date} to {end_date}"
                )
                return start_date, end_date
            else:
                LOGGER.warning(f"No study date range found for participant {participant_id}")
                return None

        except Exception as e:
            LOGGER.warning(f"Failed to get study date range for {participant_id}: {e}")
            return None

    def filter_data_to_study_dates(
        self, 
        df: pd.DataFrame, 
        participant_id: str,
        timestamp_column: str = "event_timestamp"
    ) -> pd.DataFrame:
        """Filter DataFrame to only include data within study date range.

        Args:
            df: DataFrame to filter
            participant_id: Participant ID for study date lookup
            timestamp_column: Name of the timestamp column to filter on

        Returns:
            Filtered DataFrame (or original if no date range available)
        """
        if df.empty:
            return df

        # Get study date range
        date_range = self.get_study_date_range(participant_id)
        if date_range is None:
            LOGGER.warning(
                f"No study date range available for {participant_id}, returning unfiltered data"
            )
            return df

        start_date, end_date = date_range

        if timestamp_column not in df.columns:
            LOGGER.warning(
                f"Timestamp column '{timestamp_column}' not found in DataFrame, "
                f"returning unfiltered data"
            )
            return df

        # Ensure timestamp column is datetime
        ts_col = df[timestamp_column]
        if not pd.api.types.is_datetime64_any_dtype(ts_col):
            LOGGER.warning(
                f"Timestamp column '{timestamp_column}' is not datetime type, "
                f"returning unfiltered data"
            )
            return df

        # Make sure study date range has compatible timezone
        if ts_col.dt.tz is not None:
            if start_date.tz is None:
                start_date = start_date.tz_localize(ts_col.dt.tz)
            else:
                start_date = start_date.tz_convert(ts_col.dt.tz)
            if end_date.tz is None:
                end_date = end_date.tz_localize(ts_col.dt.tz)
            else:
                end_date = end_date.tz_convert(ts_col.dt.tz)

        # Extend end_date to end of day
        end_date = end_date + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)

        # Filter
        original_count = len(df)
        filtered_df = df[(ts_col >= start_date) & (ts_col <= end_date)].copy()
        filtered_count = len(filtered_df)

        LOGGER.info(
            f"Filtered {participant_id} data to study dates "
            f"({start_date.date()} to {end_date.date()}): "
            f"{original_count} -> {filtered_count} rows"
        )

        return filtered_df

    def clear_cache(self) -> None:
        """Clear the tracking sheet cache."""
        self._tracking_sheet_cache.clear()
        LOGGER.debug("Tracking sheet cache cleared")
