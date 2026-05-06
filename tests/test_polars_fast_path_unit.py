"""
Focused unit tests for individual private methods of PolarsFastPathPreprocessor.

These complement the integration-style tests in test_polars_fast_path.py by targeting
each private method with specific, minimal inputs that make assertions obvious.
"""

from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import (
    AppCodebookColumn,
    Column,
    InteractionType,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_preprocessor(**kwargs) -> PolarsFastPathPreprocessor:
    return PolarsFastPathPreprocessor(PreprocessingOptions(**kwargs))


def _usage_df(
    *,
    interaction_types: list[str],
    app_packages: list[str] | None = None,
    start_timestamps_ns: list[int] | None = None,
    stop_timestamps_ns: list[int] | None = None,
    data_time_gap_hours: list[float] | None = None,
    duration_minutes: list[float] | None = None,
) -> pl.DataFrame:
    """Build a minimal DataFrame that already has usage rows (post-algorithm shape)."""
    n = len(interaction_types)
    packages = app_packages or ["com.example.app"] * n

    _epoch_ns = 1_000_000_000_000_000_000  # 2001-09-09 in ns
    _interval = 60 * 1_000_000_000  # 1 minute in ns
    starts = start_timestamps_ns or [_epoch_ns + i * 3 * _interval for i in range(n)]
    stops = stop_timestamps_ns or [s + _interval for s in starts]

    start_series = pl.from_epoch(pl.Series("s", starts), time_unit="ns").dt.replace_time_zone("UTC")
    stop_series = pl.from_epoch(pl.Series("s", stops), time_unit="ns").dt.replace_time_zone("UTC")

    base_ts_ns = _epoch_ns
    event_ts = pl.from_epoch(
        pl.Series("e", [base_ts_ns + i * _interval for i in range(n)]),
        time_unit="ns",
    ).dt.replace_time_zone("UTC")

    return pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: event_ts,
            Column.INTERACTION_TYPE: interaction_types,
            Column.APP_PACKAGE_NAME: packages,
            Column.START_TIMESTAMP: start_series,
            Column.STOP_TIMESTAMP: stop_series,
            Column.DATA_TIME_GAP_HOURS: data_time_gap_hours or [0.0] * n,
            Column.DURATION_MINUTES: duration_minutes or [1.0] * n,
        }
    )


# ---------------------------------------------------------------------------
# _correct_username_column
# ---------------------------------------------------------------------------


class TestCorrectUsernameColumn:
    def test_replaces_target_child_literal(self) -> None:
        df = pl.DataFrame(
            {
                Column.USERNAME: ["Target child", "other_user"],
                Column.PARTICIPANT_ID: ["P01", "P01"],
            }
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._correct_username_column(df)
        assert result.get_column(Column.USERNAME).to_list() == ["Target Child", "other_user"]

    def test_non_target_child_unchanged(self) -> None:
        df = pl.DataFrame(
            {
                Column.USERNAME: ["Alice", "Bob"],
                Column.PARTICIPANT_ID: ["P01", "P01"],
            }
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._correct_username_column(df)
        assert result.get_column(Column.USERNAME).to_list() == ["Alice", "Bob"]

    def test_no_username_column_returns_df_unchanged(self) -> None:
        df = pl.DataFrame({Column.PARTICIPANT_ID: ["P01"]})
        preprocessor = _make_preprocessor()
        result = preprocessor._correct_username_column(df)
        assert Column.USERNAME not in result.columns
        assert result.equals(df)

    def test_mixed_rows_only_matching_value_replaced(self) -> None:
        df = pl.DataFrame(
            {
                Column.USERNAME: ["Target child", "Target child", "caregiver"],
                Column.PARTICIPANT_ID: ["P01", "P01", "P01"],
            }
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._correct_username_column(df)
        assert result.get_column(Column.USERNAME).to_list() == [
            "Target Child",
            "Target Child",
            "caregiver",
        ]


# ---------------------------------------------------------------------------
# _label_filtered_apps
# ---------------------------------------------------------------------------


class TestLabelFilteredApps:
    def test_no_filter_configured_returns_unchanged(self) -> None:
        df = pl.DataFrame(
            {
                Column.APP_PACKAGE_NAME: ["com.example.app"],
                Column.APPLICATION_LABEL: ["Example"],
                Column.INTERACTION_TYPE: [str(InteractionType.ACTIVITY_RESUMED)],
            }
        )
        preprocessor = _make_preprocessor(use_filter_file=False)
        result = preprocessor._label_filtered_apps(df)
        assert result.equals(df)

    def test_filter_renames_matching_interaction_types(self) -> None:
        df = pl.DataFrame(
            {
                Column.APP_PACKAGE_NAME: ["com.filtered.app"],
                Column.APPLICATION_LABEL: ["Filtered App"],
                Column.INTERACTION_TYPE: [str(InteractionType.ACTIVITY_RESUMED)],
            }
        )
        preprocessor = _make_preprocessor(
            use_filter_file=True,
            apps_to_filter_dict={"com.filtered.app": "Filtered App"},
        )
        result = preprocessor._label_filtered_apps(df)
        assert result.get_column(Column.INTERACTION_TYPE).to_list() == [str(InteractionType.FILTERED_APP_RESUMED)]

    def test_filter_renames_paused_and_stopped_and_destroyed(self) -> None:
        paused_stopped_map = {
            str(InteractionType.ACTIVITY_PAUSED): str(InteractionType.FILTERED_APP_PAUSED),
            str(InteractionType.ACTIVITY_STOPPED): str(InteractionType.FILTERED_APP_STOPPED),
            str(InteractionType.ACTIVITY_DESTROYED): str(InteractionType.FILTERED_APP_DESTROYED),
        }
        for original_type, expected_type in paused_stopped_map.items():
            df = pl.DataFrame(
                {
                    Column.APP_PACKAGE_NAME: ["com.filtered.app"],
                    Column.APPLICATION_LABEL: ["Filtered App"],
                    Column.INTERACTION_TYPE: [original_type],
                }
            )
            preprocessor = _make_preprocessor(
                use_filter_file=True,
                apps_to_filter_dict={"com.filtered.app": "Filtered App"},
            )
            result = preprocessor._label_filtered_apps(df)
            assert result.get_column(Column.INTERACTION_TYPE).to_list()[0] == expected_type, f"Expected {expected_type} for {original_type}"

    def test_non_filtered_app_interaction_type_unchanged(self) -> None:
        df = pl.DataFrame(
            {
                Column.APP_PACKAGE_NAME: ["com.other.app", "com.filtered.app"],
                Column.APPLICATION_LABEL: ["Other App", "Filtered App"],
                Column.INTERACTION_TYPE: [
                    str(InteractionType.ACTIVITY_RESUMED),
                    str(InteractionType.ACTIVITY_RESUMED),
                ],
            }
        )
        preprocessor = _make_preprocessor(
            use_filter_file=True,
            apps_to_filter_dict={"com.filtered.app": "Filtered App"},
        )
        result = preprocessor._label_filtered_apps(df)
        types = result.get_column(Column.INTERACTION_TYPE).to_list()
        # Non-filtered app stays ACTIVITY_RESUMED
        assert str(InteractionType.ACTIVITY_RESUMED) in types
        # Filtered app becomes FILTERED_APP_RESUMED
        assert str(InteractionType.FILTERED_APP_RESUMED) in types

    def test_empty_filter_dict_returns_unchanged(self) -> None:
        df = pl.DataFrame(
            {
                Column.APP_PACKAGE_NAME: ["com.example.app"],
                Column.APPLICATION_LABEL: ["Example"],
                Column.INTERACTION_TYPE: [str(InteractionType.ACTIVITY_RESUMED)],
            }
        )
        preprocessor = _make_preprocessor(
            use_filter_file=True,
            apps_to_filter_dict={},
        )
        result = preprocessor._label_filtered_apps(df)
        assert result.equals(df)

    def test_temp_columns_dropped_after_labeling(self) -> None:
        df = pl.DataFrame(
            {
                Column.APP_PACKAGE_NAME: ["com.filtered.app"],
                Column.APPLICATION_LABEL: ["Filtered App"],
                Column.INTERACTION_TYPE: [str(InteractionType.ACTIVITY_RESUMED)],
            }
        )
        preprocessor = _make_preprocessor(
            use_filter_file=True,
            apps_to_filter_dict={"com.filtered.app": "Filtered App"},
        )
        result = preprocessor._label_filtered_apps(df)
        assert "__filter_candidate" not in result.columns
        assert "__valid_filter_match" not in result.columns


# ---------------------------------------------------------------------------
# _add_app_usage_detail_columns
# ---------------------------------------------------------------------------


class TestAddAppUsageDetailColumns:
    def _make_ns(self, hour_offsets: list[float]) -> list[int]:
        base = 1_700_000_000_000_000_000
        return [base + int(h * 3_600_000_000_000) for h in hour_offsets]

    def test_first_usage_row_gets_engage_flags(self) -> None:
        """The very first usage session always gets engage_30=1 and engage_custom=1."""
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._add_app_usage_detail_columns(df)
        assert result.get_column(Column.ANY_APP_NEW_ENGAGE_30S).to_list() == [1]
        assert result.get_column(Column.VALID_APP_NEW_ENGAGE_30S).to_list() == [1]

    def test_gap_over_30s_triggers_engage_30(self) -> None:
        """A gap > 30 s between stop of previous and start of current → engage_30 = 1."""
        # Two APP_USAGE rows; second start is 2 minutes after first stop.
        start_ns = self._make_ns([0.0, 3.0])  # hour 0 and hour 3
        stop_ns = self._make_ns([1.0, 4.0])  # 1-hour sessions
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE), str(InteractionType.APP_USAGE)],
            start_timestamps_ns=start_ns,
            stop_timestamps_ns=stop_ns,
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._add_app_usage_detail_columns(df)
        engage_30 = result.get_column(Column.ANY_APP_NEW_ENGAGE_30S).to_list()
        assert engage_30[0] == 1  # first row always 1
        assert engage_30[1] == 1  # gap = 2 h > 30 s → 1

    def test_gap_under_30s_does_not_trigger_engage_30(self) -> None:
        """A gap < 30 s between sessions → engage_30 = 0 for second row."""
        # 10-second gap between sessions
        _10s_ns = 10_000_000_000
        start_ns = self._make_ns([0.0])
        stop_ns = [start_ns[0] + _10s_ns]
        start2 = [stop_ns[0] + _10s_ns]  # 10 s gap
        stop2 = [start2[0] + _10s_ns]
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE), str(InteractionType.APP_USAGE)],
            start_timestamps_ns=start_ns + start2,
            stop_timestamps_ns=stop_ns + stop2,
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._add_app_usage_detail_columns(df)
        engage_30 = result.get_column(Column.ANY_APP_NEW_ENGAGE_30S).to_list()
        assert engage_30[0] == 1  # first always 1
        assert engage_30[1] == 0  # gap < 30 s

    def test_switched_app_flag_set_when_different_package(self) -> None:
        start_ns = self._make_ns([0.0, 2.0])
        stop_ns = self._make_ns([1.0, 3.0])
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE), str(InteractionType.APP_USAGE)],
            app_packages=["com.app.a", "com.app.b"],
            start_timestamps_ns=start_ns,
            stop_timestamps_ns=stop_ns,
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._add_app_usage_detail_columns(df)
        switched = result.get_column(Column.ANY_APP_SWITCHED_APP).to_list()
        assert switched[0] == 0  # no previous
        assert switched[1] == 1  # different package

    def test_switched_app_flag_not_set_for_same_package(self) -> None:
        start_ns = self._make_ns([0.0, 2.0])
        stop_ns = self._make_ns([1.0, 3.0])
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE), str(InteractionType.APP_USAGE)],
            app_packages=["com.same.app", "com.same.app"],
            start_timestamps_ns=start_ns,
            stop_timestamps_ns=stop_ns,
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._add_app_usage_detail_columns(df)
        switched = result.get_column(Column.ANY_APP_SWITCHED_APP).to_list()
        assert switched[1] == 0

    def test_gap_hours_column_computed_from_start_stop_diff(self) -> None:
        """any_app_usage_time_gap_hours = (start[i] - stop[i-1]) / 3600."""
        # 1-hour gap between stop of row 0 and start of row 1
        start_ns = self._make_ns([0.0, 2.0])  # starts at h0 and h2
        stop_ns = self._make_ns([1.0, 3.0])  # stops at h1 and h3, so gap = 1 h
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE), str(InteractionType.APP_USAGE)],
            start_timestamps_ns=start_ns,
            stop_timestamps_ns=stop_ns,
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._add_app_usage_detail_columns(df)
        gap = result.get_column(Column.ANY_APP_USAGE_TIME_GAP_HOURS).to_list()
        assert gap[0] == pytest.approx(0.0)
        assert gap[1] == pytest.approx(1.0, abs=1e-4)

    def test_custom_engagement_duration_respected(self) -> None:
        """engage_custom uses the configured custom duration, not 30 s."""
        # gap = 20 s → above 10 s custom threshold, below 30 s standard
        _10s_ns = 10_000_000_000
        _20s_ns = 20_000_000_000
        start_ns = self._make_ns([0.0])
        stop_ns = [start_ns[0] + _10s_ns]
        start2 = [stop_ns[0] + _20s_ns]  # 20 s gap
        stop2 = [start2[0] + _10s_ns]
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE), str(InteractionType.APP_USAGE)],
            start_timestamps_ns=start_ns + start2,
            stop_timestamps_ns=stop_ns + stop2,
        )
        preprocessor = _make_preprocessor(custom_app_engagement_duration=10)  # 10 s threshold
        result = preprocessor._add_app_usage_detail_columns(df)
        custom_col = Column.ANY_APP_NEW_ENGAGE_CUSTOM.format(10)
        engage_custom = result.get_column(custom_col).to_list()
        # 20 s gap > 10 s custom threshold → engage_custom = 1
        assert engage_custom[1] == 1
        # but engage_30 = 0 because 20 s < 30 s
        engage_30 = result.get_column(Column.ANY_APP_NEW_ENGAGE_30S).to_list()
        assert engage_30[1] == 0

    def test_filtered_app_usage_counted_in_any_but_not_valid(self) -> None:
        """FILTERED_APP_USAGE rows count toward any_* metrics but not valid_*."""
        start_ns = self._make_ns([0.0, 2.0])
        stop_ns = self._make_ns([1.0, 3.0])
        df = _usage_df(
            interaction_types=[
                str(InteractionType.APP_USAGE),
                str(InteractionType.FILTERED_APP_USAGE),
            ],
            start_timestamps_ns=start_ns,
            stop_timestamps_ns=stop_ns,
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._add_app_usage_detail_columns(df)
        # any_app columns should reflect 2 rows
        any_engage = result.get_column(Column.ANY_APP_NEW_ENGAGE_30S).to_list()
        valid_engage = result.get_column(Column.VALID_APP_NEW_ENGAGE_30S).to_list()
        # row 0 is APP_USAGE — valid and any
        assert any_engage[0] == 1
        assert valid_engage[0] == 1
        # row 1 is FILTERED_APP_USAGE — any only, not valid
        assert any_engage[1] == 1  # gap > 30 s
        assert valid_engage[1] == 0  # not a valid row at index 1


# ---------------------------------------------------------------------------
# _mark_app_usage_flags
# ---------------------------------------------------------------------------


class TestMarkAppUsageFlags:
    def test_no_gap_no_duration_gives_empty_flags(self) -> None:
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
            data_time_gap_hours=[0.0],
            duration_minutes=[0.5],  # 0.5 min = 30 s < 1 hr threshold
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._mark_app_usage_flags(df)
        assert result.get_column(Column.ANY_APP_USAGE_FLAGS).to_list() == ["[]"]

    def test_gap_above_threshold_adds_gap_flag(self) -> None:
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
            data_time_gap_hours=[2.5],
            duration_minutes=[0.5],
        )
        preprocessor = _make_preprocessor(long_data_time_gap_thresholds=[1, 2, 3])
        result = preprocessor._mark_app_usage_flags(df)
        flags = result.get_column(Column.ANY_APP_USAGE_FLAGS).to_list()[0]
        assert ">2-HR TIME GAP" in flags

    def test_duration_above_threshold_adds_duration_flag(self) -> None:
        # 90 minutes = 1.5 hours → above 1-hr threshold
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
            data_time_gap_hours=[0.0],
            duration_minutes=[90.0],
        )
        preprocessor = _make_preprocessor(long_usage_duration_thresholds=[1, 2])
        result = preprocessor._mark_app_usage_flags(df)
        flags = result.get_column(Column.ANY_APP_USAGE_FLAGS).to_list()[0]
        assert ">1-HR APP USAGE" in flags

    def test_both_gap_and_duration_flags_combined(self) -> None:
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
            data_time_gap_hours=[3.0],
            duration_minutes=[90.0],
        )
        preprocessor = _make_preprocessor(
            long_data_time_gap_thresholds=[1],
            long_usage_duration_thresholds=[1],
        )
        result = preprocessor._mark_app_usage_flags(df)
        flags = result.get_column(Column.ANY_APP_USAGE_FLAGS).to_list()[0]
        assert ">1-HR TIME GAP" in flags
        assert ">1-HR APP USAGE" in flags

    def test_highest_threshold_wins_when_multiple_breached(self) -> None:
        """If 3-hr gap breaches both 1-hr and 3-hr thresholds, flag shows the higher."""
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
            data_time_gap_hours=[3.5],
            duration_minutes=[0.5],
        )
        preprocessor = _make_preprocessor(long_data_time_gap_thresholds=[1, 2, 3])
        result = preprocessor._mark_app_usage_flags(df)
        flags = result.get_column(Column.ANY_APP_USAGE_FLAGS).to_list()[0]
        assert ">3-HR TIME GAP" in flags
        assert ">1-HR TIME GAP" not in flags

    def test_temp_columns_dropped(self) -> None:
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
        )
        preprocessor = _make_preprocessor()
        result = preprocessor._mark_app_usage_flags(df)
        assert "__chronicle_time_gap_flag" not in result.columns
        assert "__chronicle_duration_flag" not in result.columns


# ---------------------------------------------------------------------------
# _remove_selected_interaction_types
# ---------------------------------------------------------------------------


class TestRemoveSelectedInteractionTypes:
    def test_no_configured_types_returns_unchanged(self) -> None:
        df = _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE), str(InteractionType.END_OF_USAGE_MISSING)],
        )
        preprocessor = _make_preprocessor(interaction_types_to_remove=set())
        result = preprocessor._remove_selected_interaction_types(df)
        assert len(result) == 2

    def test_removes_specified_type(self) -> None:
        df = _usage_df(
            interaction_types=[
                str(InteractionType.APP_USAGE),
                str(InteractionType.END_OF_USAGE_MISSING),
                str(InteractionType.APP_USAGE),
            ],
        )
        preprocessor = _make_preprocessor(
            interaction_types_to_remove={InteractionType.END_OF_USAGE_MISSING},
        )
        result = preprocessor._remove_selected_interaction_types(df)
        remaining = result.get_column(Column.INTERACTION_TYPE).to_list()
        assert str(InteractionType.END_OF_USAGE_MISSING) not in remaining
        assert len(remaining) == 2

    def test_other_types_remain(self) -> None:
        df = _usage_df(
            interaction_types=[
                str(InteractionType.APP_USAGE),
                str(InteractionType.END_OF_USAGE_MISSING),
            ],
        )
        preprocessor = _make_preprocessor(
            interaction_types_to_remove={InteractionType.END_OF_USAGE_MISSING},
        )
        result = preprocessor._remove_selected_interaction_types(df)
        assert str(InteractionType.APP_USAGE) in result.get_column(Column.INTERACTION_TYPE).to_list()

    def test_large_gap_row_preserved_even_if_type_to_remove(self) -> None:
        """Rows whose data_time_gap_hours >= threshold are kept even for removed types."""
        df = _usage_df(
            interaction_types=[
                str(InteractionType.END_OF_USAGE_MISSING),
                str(InteractionType.END_OF_USAGE_MISSING),
            ],
            data_time_gap_hours=[0.0, 99.0],  # second row has huge gap
        )
        preprocessor = _make_preprocessor(
            interaction_types_to_remove={InteractionType.END_OF_USAGE_MISSING},
            long_data_time_gap_thresholds=[1],
        )
        result = preprocessor._remove_selected_interaction_types(df)
        # Row with gap=99 h should be retained despite being a "removed" type
        assert len(result) == 1
        assert result.get_column(Column.DATA_TIME_GAP_HOURS).to_list()[0] == pytest.approx(99.0)


# ---------------------------------------------------------------------------
# _enrich_with_app_codebook_data
# ---------------------------------------------------------------------------


class TestEnrichWithAppCodebookData:
    def _minimal_post_algo_df(self, package: str = "com.example.app") -> pl.DataFrame:
        return _usage_df(
            interaction_types=[str(InteractionType.APP_USAGE)],
            app_packages=[package],
        )

    def test_use_codebook_false_returns_unchanged(self) -> None:
        df = self._minimal_post_algo_df()
        preprocessor = _make_preprocessor(use_app_codebook=False)
        result = preprocessor._enrich_with_app_codebook_data(df)
        assert result.equals(df)

    def test_use_codebook_true_no_codebook_object_adds_null_columns(self) -> None:
        df = self._minimal_post_algo_df()
        preprocessor = _make_preprocessor(use_app_codebook=True)
        # app_codebook defaults to None
        result = preprocessor._enrich_with_app_codebook_data(df)
        assert Column.BROAD_APP_CATEGORY in result.columns
        assert result.get_column(Column.BROAD_APP_CATEGORY).to_list() == ["Unknown"]
        assert Column.GENRE_ID_SCRAPED in result.columns
        assert result.get_column(Column.GENRE_ID_SCRAPED).to_list() == ["Unknown"]

    def test_codebook_match_populates_columns(self) -> None:
        df = self._minimal_post_algo_df(package="com.test.app")
        codebook = pl.DataFrame(
            {
                AppCodebookColumn.APP_PACKAGE_NAME: ["com.test.app"],
                AppCodebookColumn.PLAY_STORE_BROAD_APP_CATEGORY: ["Games"],
                AppCodebookColumn.PLAY_STORE_GENRE_ID: ["GAME"],
            }
        )
        preprocessor = PolarsFastPathPreprocessor(
            PreprocessingOptions(use_app_codebook=True),
            app_codebook=codebook,
        )
        result = preprocessor._enrich_with_app_codebook_data(df)
        assert result.get_column(Column.BROAD_APP_CATEGORY).to_list() == ["Games"]

    def test_codebook_no_match_falls_back_to_unknown(self) -> None:
        df = self._minimal_post_algo_df(package="com.unknown.app")
        codebook = pl.DataFrame(
            {
                AppCodebookColumn.APP_PACKAGE_NAME: ["com.other.app"],
                AppCodebookColumn.PLAY_STORE_BROAD_APP_CATEGORY: ["Games"],
                AppCodebookColumn.PLAY_STORE_GENRE_ID: ["GAME"],
            }
        )
        preprocessor = PolarsFastPathPreprocessor(
            PreprocessingOptions(use_app_codebook=True),
            app_codebook=codebook,
        )
        result = preprocessor._enrich_with_app_codebook_data(df)
        assert result.get_column(Column.BROAD_APP_CATEGORY).to_list() == ["Unknown"]
        assert result.get_column(Column.GENRE_ID_SCRAPED).to_list() == ["Unknown"]

    def test_codebook_genre_consensus_collapses_to_genre_id_scraped(self) -> None:
        """When all genre sources agree, they collapse to GENRE_ID_SCRAPED and sources go null."""
        df = self._minimal_post_algo_df(package="com.agree.app")
        codebook = pl.DataFrame(
            {
                AppCodebookColumn.APP_PACKAGE_NAME: ["com.agree.app"],
                AppCodebookColumn.PLAY_STORE_GENRE_ID: ["EDUCATION"],
                AppCodebookColumn.USC_GENRE_ID: ["EDUCATION"],
            }
        )
        preprocessor = PolarsFastPathPreprocessor(
            PreprocessingOptions(use_app_codebook=True),
            app_codebook=codebook,
        )
        result = preprocessor._enrich_with_app_codebook_data(df)
        assert result.get_column(Column.GENRE_ID_SCRAPED).to_list() == ["EDUCATION"]
        # Source columns should be null when unanimous
        assert result.get_column(Column.PLAY_STORE_GENRE_ID).to_list() == [None]
        assert result.get_column(Column.USC_GENRE_ID).to_list() == [None]

    def test_codebook_genre_disagreement_leaves_source_columns_intact(self) -> None:
        df = self._minimal_post_algo_df(package="com.disagree.app")
        codebook = pl.DataFrame(
            {
                AppCodebookColumn.APP_PACKAGE_NAME: ["com.disagree.app"],
                AppCodebookColumn.PLAY_STORE_GENRE_ID: ["NEWS_AND_MAGAZINES"],
                AppCodebookColumn.USC_GENRE_ID: ["SOCIAL"],
            }
        )
        preprocessor = PolarsFastPathPreprocessor(
            PreprocessingOptions(use_app_codebook=True),
            app_codebook=codebook,
        )
        result = preprocessor._enrich_with_app_codebook_data(df)
        assert result.get_column(Column.GENRE_ID_SCRAPED).to_list() == [None]
        assert result.get_column(Column.PLAY_STORE_GENRE_ID).to_list() == ["NEWS_AND_MAGAZINES"]
        assert result.get_column(Column.USC_GENRE_ID).to_list() == ["SOCIAL"]


# ---------------------------------------------------------------------------
# _mark_data_time_gaps
# ---------------------------------------------------------------------------


class TestMarkDataTimeGaps:
    def test_single_row_gap_is_zero(self) -> None:
        ts = pl.from_epoch(pl.Series("ts", [1_700_000_000_000_000_000]), time_unit="ns").dt.replace_time_zone("UTC")
        df = pl.DataFrame({Column.EVENT_TIMESTAMP: ts})
        preprocessor = _make_preprocessor()
        result = preprocessor._mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
        assert result.get_column(Column.DATA_TIME_GAP_HOURS).to_list() == [pytest.approx(0.0)]

    def test_gap_between_two_rows_is_correct(self) -> None:
        base_ns = 1_700_000_000_000_000_000
        one_hour_ns = 3_600_000_000_000
        ts = pl.from_epoch(
            pl.Series("ts", [base_ns, base_ns + one_hour_ns]),
            time_unit="ns",
        ).dt.replace_time_zone("UTC")
        df = pl.DataFrame({Column.EVENT_TIMESTAMP: ts})
        preprocessor = _make_preprocessor()
        result = preprocessor._mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
        gaps = result.get_column(Column.DATA_TIME_GAP_HOURS).to_list()
        assert gaps[0] == pytest.approx(0.0)
        assert gaps[1] == pytest.approx(1.0, abs=0.01)

    def test_gap_column_rounded_to_two_decimal_places(self) -> None:
        base_ns = 1_700_000_000_000_000_000
        odd_gap_ns = int(1.337 * 3_600_000_000_000)
        ts = pl.from_epoch(
            pl.Series("ts", [base_ns, base_ns + odd_gap_ns]),
            time_unit="ns",
        ).dt.replace_time_zone("UTC")
        df = pl.DataFrame({Column.EVENT_TIMESTAMP: ts})
        preprocessor = _make_preprocessor()
        result = preprocessor._mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
        gap = result.get_column(Column.DATA_TIME_GAP_HOURS).to_list()[1]
        # should be rounded to 2 decimal places
        assert round(gap, 2) == gap


# ---------------------------------------------------------------------------
# _get_participant_id
# ---------------------------------------------------------------------------


class TestGetParticipantId:
    def test_single_row_returns_index_zero(self) -> None:
        df = pl.DataFrame({Column.PARTICIPANT_ID: ["P01"]})
        preprocessor = _make_preprocessor()
        assert preprocessor._get_participant_id(df) == "P01"

    def test_multiple_rows_returns_index_one(self) -> None:
        df = pl.DataFrame({Column.PARTICIPANT_ID: ["header", "P02", "P02"]})
        preprocessor = _make_preprocessor()
        assert preprocessor._get_participant_id(df) == "P02"
