from __future__ import annotations

from datetime import UTC, date, datetime
from typing import ClassVar

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column
from chronicle_preprocessing_app.core.preprocessing import study_date_provider as study_date_provider_module
from chronicle_preprocessing_app.core.preprocessing.study_date_provider import (
    StudyDateRangeProvider,
)
from tests.polars_helpers import frame, ts


def test_study_date_provider_matches_numeric_ids_and_keeps_full_end_date() -> None:
    provider = StudyDateRangeProvider(
        {
            "P01-1234": (
                datetime(2026, 3, 7, tzinfo=UTC),
                datetime(2026, 3, 7, tzinfo=UTC),
            )
        }
    )
    df = frame(
        [
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-06 23:59:59.999999", "UTC"),
                "row": "before",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-07 00:00:00", "UTC"),
                "row": "start",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-07 23:59:59.500000", "UTC"),
                "row": "fractional-final-second",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-08 00:00:00", "UTC"),
                "row": "after",
            },
            {
                Column.EVENT_TIMESTAMP: None,
                "row": "missing",
            },
        ]
    )

    filtered = provider.filter_data_to_study_dates(df, "1234", Column.EVENT_TIMESTAMP)

    assert provider.get_study_date_range("1234") is not None
    assert filtered.get_column("row").to_list() == [
        "start",
        "fractional-final-second",
    ]


def test_study_date_provider_treats_date_only_ranges_as_local_data_days() -> None:
    provider = StudyDateRangeProvider({"P01": (date(2026, 3, 7), date(2026, 3, 7))})
    df = frame(
        [
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-06 18:30:00", "America/Chicago"),
                "row": "previous-local-evening",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-07 00:30:00", "America/Chicago"),
                "row": "local-start",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-07 23:30:00", "America/Chicago"),
                "row": "local-end-evening",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-03-08 00:00:00", "America/Chicago"),
                "row": "next-local-midnight",
            },
        ]
    )

    filtered = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)

    assert filtered.get_column("row").to_list() == [
        "local-start",
        "local-end-evening",
    ]


def test_study_date_provider_leaves_data_unchanged_without_date_or_column_match() -> None:
    provider = StudyDateRangeProvider()
    df = pl.DataFrame({"row": ["a", "b"]})

    assert provider.filter_data_to_study_dates(df, "P01").equals(df)
    assert provider.filter_data_to_study_dates(df, "P01", "missing").equals(df)


# ---------------------------------------------------------------------------
# is_available
# ---------------------------------------------------------------------------


def test_is_available_false_when_empty_map_and_no_internal_modules() -> None:
    from chronicle_preprocessing_app.core.preprocessing.study_date_provider import (
        INTERNAL_MODULES_AVAILABLE,
    )

    provider = StudyDateRangeProvider()
    if INTERNAL_MODULES_AVAILABLE:
        assert provider.is_available is True
    else:
        assert provider.is_available is False


def test_is_available_true_when_map_has_entries() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 31, tzinfo=UTC))})
    assert provider.is_available is True


# ---------------------------------------------------------------------------
# set_study_date_map / set_study_dates_for_participant
# ---------------------------------------------------------------------------


def test_set_study_date_map_replaces_existing_map() -> None:
    provider = StudyDateRangeProvider({"OLD": (datetime(2025, 1, 1, tzinfo=UTC), datetime(2025, 1, 31, tzinfo=UTC))})
    new_map = {"NEW": (datetime(2026, 5, 1, tzinfo=UTC), datetime(2026, 5, 31, tzinfo=UTC))}
    provider.set_study_date_map(new_map)

    assert provider.get_study_date_range("OLD") is None
    assert provider.get_study_date_range("NEW") is not None


def test_set_study_dates_for_participant_adds_entry() -> None:
    provider = StudyDateRangeProvider()
    provider.set_study_dates_for_participant("P99", datetime(2026, 6, 1, tzinfo=UTC), datetime(2026, 6, 30, tzinfo=UTC))
    result = provider.get_study_date_range("P99")
    assert result is not None
    assert result[0] == datetime(2026, 6, 1, tzinfo=UTC)
    assert result[1] == datetime(2026, 6, 30, tzinfo=UTC)


def test_set_study_dates_for_participant_overwrites_existing_entry() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2025, 1, 1, tzinfo=UTC), datetime(2025, 12, 31, tzinfo=UTC))})
    provider.set_study_dates_for_participant("P01", datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 31, tzinfo=UTC))
    result = provider.get_study_date_range("P01")
    assert result is not None
    assert result[0].year == 2026


# ---------------------------------------------------------------------------
# get_study_date_range
# ---------------------------------------------------------------------------


def test_get_study_date_range_returns_none_for_unknown_participant() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 31, tzinfo=UTC))})
    assert provider.get_study_date_range("UNKNOWN-999") is None


def test_get_study_date_range_finds_by_exact_id() -> None:
    provider = StudyDateRangeProvider({"EXACT-42": (datetime(2026, 4, 1, tzinfo=UTC), datetime(2026, 4, 30, tzinfo=UTC))})
    result = provider.get_study_date_range("EXACT-42")
    assert result is not None
    assert result[0].month == 4


def test_get_study_date_range_finds_by_numeric_id_extraction() -> None:
    provider = StudyDateRangeProvider({"P01-5678": (datetime(2026, 2, 1, tzinfo=UTC), datetime(2026, 2, 28, tzinfo=UTC))})
    # Numeric portion "5678" should match the key "P01-5678"
    result = provider.get_study_date_range("5678")
    assert result is not None
    assert result[0].month == 2


def test_get_study_date_range_cross_prefix_numeric_match() -> None:
    provider = StudyDateRangeProvider({"P02-9900": (datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 31, tzinfo=UTC))})
    # P03-9900 extracts "9900" and P02-9900 also extracts "9900" → match
    result = provider.get_study_date_range("P03-9900")
    assert result is not None


def test_get_study_date_range_uses_cached_tech_tracking_sheet(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeTechParticipantID:
        def __init__(self, raw_id: str) -> None:
            self.raw_id = raw_id

    class FakeParticipantID:
        @staticmethod
        def validate_participant_id(participant_id: str) -> FakeTechParticipantID:
            return FakeTechParticipantID(participant_id)

    class FakeProjectOneProjectTwoTrackingSheet:
        init_count = 0
        requested_ids: ClassVar[list[str]] = []

        def __init__(self, *, force_redownload: bool) -> None:
            FakeProjectOneProjectTwoTrackingSheet.init_count += 1
            self.force_redownload = force_redownload

        def get_specific_participant_study_date_range(self, *, participant_id: FakeTechParticipantID) -> pl.Series:
            FakeProjectOneProjectTwoTrackingSheet.requested_ids.append(participant_id.raw_id)
            return pl.Series([date(2026, 2, 5), date(2026, 2, 7)])

    monkeypatch.setattr(study_date_provider_module, "INTERNAL_MODULES_AVAILABLE", True)
    monkeypatch.setattr(study_date_provider_module, "ParticipantID", FakeParticipantID, raising=False)
    monkeypatch.setattr(study_date_provider_module, "TECHParticipantID", FakeTechParticipantID, raising=False)
    monkeypatch.setattr(
        study_date_provider_module,
        "ProjectOneProjectTwoTrackingSheet",
        FakeProjectOneProjectTwoTrackingSheet,
        raising=False,
    )

    provider = StudyDateRangeProvider()

    assert provider.get_study_date_range("TECH-001") == (date(2026, 2, 5), date(2026, 2, 7))
    assert provider.get_study_date_range("TECH-002") == (date(2026, 2, 5), date(2026, 2, 7))
    assert FakeProjectOneProjectTwoTrackingSheet.init_count == 1
    assert FakeProjectOneProjectTwoTrackingSheet.requested_ids == ["TECH-001", "TECH-002"]


def test_get_study_date_range_uses_cached_standard_tracking_sheet(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeTechParticipantID:
        pass

    class FakeStandardParticipantID:
        def __init__(self, raw_id: str) -> None:
            self.raw_id = raw_id

    class FakeParticipantID:
        @staticmethod
        def validate_participant_id(participant_id: str) -> FakeStandardParticipantID:
            return FakeStandardParticipantID(participant_id)

    class FakeTrackingSheet:
        factory_ids: ClassVar[list[str]] = []
        requested_ids: ClassVar[list[str]] = []

        @staticmethod
        def get_correct_tracking_sheet_for_participant(participant_id: FakeStandardParticipantID) -> FakeTrackingSheet:
            FakeTrackingSheet.factory_ids.append(participant_id.raw_id)
            return FakeTrackingSheet()

        def get_specific_participant_study_date_range(self, *, participant_id: FakeStandardParticipantID) -> pl.Series:
            FakeTrackingSheet.requested_ids.append(participant_id.raw_id)
            return pl.Series([datetime(2026, 4, 3, tzinfo=UTC), datetime(2026, 4, 9, tzinfo=UTC)])

    monkeypatch.setattr(study_date_provider_module, "INTERNAL_MODULES_AVAILABLE", True)
    monkeypatch.setattr(study_date_provider_module, "ParticipantID", FakeParticipantID, raising=False)
    monkeypatch.setattr(study_date_provider_module, "TECHParticipantID", FakeTechParticipantID, raising=False)
    monkeypatch.setattr(study_date_provider_module, "TrackingSheet", FakeTrackingSheet, raising=False)

    provider = StudyDateRangeProvider()

    assert provider.get_study_date_range("P01-111") == (datetime(2026, 4, 3, tzinfo=UTC), datetime(2026, 4, 9, tzinfo=UTC))
    assert provider.get_study_date_range("P01-222") == (datetime(2026, 4, 3, tzinfo=UTC), datetime(2026, 4, 9, tzinfo=UTC))
    assert FakeTrackingSheet.factory_ids == ["P01-111"]
    assert FakeTrackingSheet.requested_ids == ["P01-111", "P01-222"]


# ---------------------------------------------------------------------------
# filter_data_to_study_dates — structural edge cases
# ---------------------------------------------------------------------------


def test_filter_returns_empty_df_unchanged() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 31, tzinfo=UTC))})
    empty_df = pl.DataFrame({Column.EVENT_TIMESTAMP: []}).cast({Column.EVENT_TIMESTAMP: pl.Datetime("us", "UTC")})
    result = provider.filter_data_to_study_dates(empty_df, "P01", Column.EVENT_TIMESTAMP)
    assert result.is_empty()


def test_filter_returns_df_unchanged_when_no_date_range_for_participant() -> None:
    provider = StudyDateRangeProvider()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-05-01 10:00:00", "UTC"), "v": 1}])
    result = provider.filter_data_to_study_dates(df, "NOBODY", Column.EVENT_TIMESTAMP)
    assert result.equals(df)


def test_filter_returns_df_unchanged_when_column_not_in_df() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 5, 1, tzinfo=UTC), datetime(2026, 5, 31, tzinfo=UTC))})
    df = pl.DataFrame({"value": [1, 2, 3]})
    result = provider.filter_data_to_study_dates(df, "P01", "nonexistent_column")
    assert result.equals(df)


# ---------------------------------------------------------------------------
# filter_data_to_study_dates — boundary / date filtering
# ---------------------------------------------------------------------------


def test_filter_removes_events_before_start_date() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 5, 10, tzinfo=UTC), datetime(2026, 5, 20, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-05-09 23:59:59", "UTC"), "v": "before"},
            {Column.EVENT_TIMESTAMP: ts("2026-05-10 00:00:00", "UTC"), "v": "on-start"},
            {Column.EVENT_TIMESTAMP: ts("2026-05-15 12:00:00", "UTC"), "v": "middle"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    assert "before" not in result["v"].to_list()
    assert "on-start" in result["v"].to_list()
    assert "middle" in result["v"].to_list()


def test_filter_removes_events_after_end_date_plus_one_day() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 5, 10, tzinfo=UTC), datetime(2026, 5, 20, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-05-20 23:59:59", "UTC"), "v": "last-second"},
            {Column.EVENT_TIMESTAMP: ts("2026-05-21 00:00:00", "UTC"), "v": "midnight-after"},
            {Column.EVENT_TIMESTAMP: ts("2026-05-21 01:00:00", "UTC"), "v": "after"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    assert "last-second" in result["v"].to_list()
    assert "midnight-after" not in result["v"].to_list()
    assert "after" not in result["v"].to_list()


def test_filter_same_day_range_keeps_only_that_days_events() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 3, 15, tzinfo=UTC), datetime(2026, 3, 15, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-03-14 23:59:59", "UTC"), "v": "day-before"},
            {Column.EVENT_TIMESTAMP: ts("2026-03-15 00:00:00", "UTC"), "v": "start-of-day"},
            {Column.EVENT_TIMESTAMP: ts("2026-03-15 12:00:00", "UTC"), "v": "noon"},
            {Column.EVENT_TIMESTAMP: ts("2026-03-15 23:59:59", "UTC"), "v": "end-of-day"},
            {Column.EVENT_TIMESTAMP: ts("2026-03-16 00:00:00", "UTC"), "v": "next-day"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    rows = result["v"].to_list()
    assert "day-before" not in rows
    assert "start-of-day" in rows
    assert "noon" in rows
    assert "end-of-day" in rows
    assert "next-day" not in rows


def test_filter_three_day_range_keeps_middle_day() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 6, 1, tzinfo=UTC), datetime(2026, 6, 3, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-05-31 23:00:00", "UTC"), "v": "before"},
            {Column.EVENT_TIMESTAMP: ts("2026-06-01 08:00:00", "UTC"), "v": "day1"},
            {Column.EVENT_TIMESTAMP: ts("2026-06-02 12:00:00", "UTC"), "v": "day2-middle"},
            {Column.EVENT_TIMESTAMP: ts("2026-06-03 20:00:00", "UTC"), "v": "day3"},
            {Column.EVENT_TIMESTAMP: ts("2026-06-04 00:00:00", "UTC"), "v": "after"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    rows = result["v"].to_list()
    assert "before" not in rows
    assert "day1" in rows
    assert "day2-middle" in rows
    assert "day3" in rows
    assert "after" not in rows


def test_filter_null_timestamps_do_not_crash() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 5, 1, tzinfo=UTC), datetime(2026, 5, 31, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-05-10 09:00:00", "UTC"), "v": "valid"},
            {Column.EVENT_TIMESTAMP: None, "v": "null"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    # Null rows are dropped by the is_not_null filter — no crash, valid row kept
    assert "valid" in result["v"].to_list()
    assert result.height >= 1


def test_filter_accepts_date_objects_via_coerce() -> None:
    import datetime as dt

    start_date = dt.date(2026, 8, 1)
    end_date = dt.date(2026, 8, 31)
    provider = StudyDateRangeProvider({"P01": (start_date, end_date)})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-07-31 23:59:59", "UTC"), "v": "before"},
            {Column.EVENT_TIMESTAMP: ts("2026-08-15 10:00:00", "UTC"), "v": "in-range"},
            {Column.EVENT_TIMESTAMP: ts("2026-09-01 00:00:00", "UTC"), "v": "after"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    rows = result["v"].to_list()
    assert "before" not in rows
    assert "in-range" in rows
    assert "after" not in rows


def test_filter_with_tz_aware_column_and_utc_bounds() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 4, 10, tzinfo=UTC), datetime(2026, 4, 12, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-04-09 23:00:00", "UTC"), "v": "before"},
            {Column.EVENT_TIMESTAMP: ts("2026-04-10 06:00:00", "UTC"), "v": "in1"},
            {Column.EVENT_TIMESTAMP: ts("2026-04-12 18:00:00", "UTC"), "v": "in2"},
            {Column.EVENT_TIMESTAMP: ts("2026-04-13 00:00:00", "UTC"), "v": "after"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    rows = result["v"].to_list()
    assert "before" not in rows
    assert "in1" in rows
    assert "in2" in rows
    assert "after" not in rows


def test_filter_multi_day_range_inclusive_on_both_ends() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 9, 1, tzinfo=UTC), datetime(2026, 9, 5, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-09-01 00:00:00", "UTC"), "v": "start"},
            {Column.EVENT_TIMESTAMP: ts("2026-09-05 23:59:59", "UTC"), "v": "end"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    rows = result["v"].to_list()
    assert "start" in rows
    assert "end" in rows


def test_filter_exclusive_end_boundary_excludes_midnight_of_next_day() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 10, 1, tzinfo=UTC), datetime(2026, 10, 3, tzinfo=UTC))})
    # exclusive end is 2026-10-04 00:00:00; that exact moment must be excluded
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-10-03 23:59:59", "UTC"), "v": "last-valid"},
            {Column.EVENT_TIMESTAMP: ts("2026-10-04 00:00:00", "UTC"), "v": "exclusive-end"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    rows = result["v"].to_list()
    assert "last-valid" in rows
    assert "exclusive-end" not in rows


def test_filter_inclusive_start_boundary_includes_exact_start_datetime() -> None:
    provider = StudyDateRangeProvider({"P01": (datetime(2026, 11, 5, tzinfo=UTC), datetime(2026, 11, 10, tzinfo=UTC))})
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-11-04 23:59:59.999999", "UTC"), "v": "one-us-before"},
            {Column.EVENT_TIMESTAMP: ts("2026-11-05 00:00:00", "UTC"), "v": "exact-start"},
        ]
    )
    result = provider.filter_data_to_study_dates(df, "P01", Column.EVENT_TIMESTAMP)
    rows = result["v"].to_list()
    assert "one-us-before" not in rows
    assert "exact-start" in rows


# ---------------------------------------------------------------------------
# _coerce_to_datetime helper
# ---------------------------------------------------------------------------


def test_coerce_to_datetime_converts_date_to_utc_midnight() -> None:
    import datetime as dt

    from chronicle_preprocessing_app.core.preprocessing.study_date_provider import (
        _coerce_to_datetime,
    )

    d = dt.date(2026, 7, 4)
    result = _coerce_to_datetime(d)
    assert isinstance(result, dt.datetime)
    assert result.year == 2026
    assert result.month == 7
    assert result.day == 4
    assert result.hour == 0
    assert result.minute == 0
    assert result.tzinfo == dt.timezone.utc


def test_coerce_to_datetime_passes_through_datetime_unchanged() -> None:
    import datetime as dt

    from chronicle_preprocessing_app.core.preprocessing.study_date_provider import (
        _coerce_to_datetime,
    )

    original = dt.datetime(2026, 7, 4, 15, 30, tzinfo=dt.timezone.utc)
    result = _coerce_to_datetime(original)
    assert result is original


def test_coerce_to_datetime_passes_through_non_date_values() -> None:
    from chronicle_preprocessing_app.core.preprocessing.study_date_provider import (
        _coerce_to_datetime,
    )

    assert _coerce_to_datetime("2026-01-01") == "2026-01-01"
    assert _coerce_to_datetime(None) is None
    assert _coerce_to_datetime(42) == 42
