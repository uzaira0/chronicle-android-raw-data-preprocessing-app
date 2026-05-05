from __future__ import annotations

from datetime import UTC, datetime

import polars as pl
from hypothesis import given, settings
from hypothesis import strategies as st

from chronicle_preprocessing_app.config.constants import Column, InteractionType, TimestampFormat
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import TimestampPreprocessor
from tests.polars_helpers import ts

# ---------------------------------------------------------------------------
# Shared strategies
# ---------------------------------------------------------------------------

_timestamp_str = st.one_of(
    st.just(None),
    st.just(""),
    st.just("  "),
    st.text(min_size=0, max_size=5),
    st.just("2026-01-01T00:00:00Z"),
    st.just("2026-01-01 00:00:00"),
    st.just("2026-01-01T00:00:00+00:00"),
    st.just("not-a-date"),
)

_timestamp_list = st.lists(_timestamp_str, min_size=0, max_size=20)


def _options(**overrides: object) -> PreprocessingOptions:
    values: dict[str, object] = {"raw_data_folder": "", "use_app_codebook": False}
    values.update(overrides)
    return PreprocessingOptions(**values)


def _preprocessor(**overrides: object) -> TimestampPreprocessor:
    return TimestampPreprocessor(_options(**overrides))


def _event_df(values: list[object]) -> pl.DataFrame:
    return pl.DataFrame({Column.EVENT_TIMESTAMP: values})


# ---------------------------------------------------------------------------
# Original tests (kept)
# ---------------------------------------------------------------------------


@settings(max_examples=75)
@given(st.datetimes(timezones=st.just(UTC)).filter(lambda value: value.year >= 1900 and value.microsecond <= 999_999))
def test_fix_timestamp_format_preserves_utc_instants_with_z_suffix(value) -> None:
    formatted = TimestampPreprocessor.fix_timestamp_format(value.isoformat().replace("+00:00", "Z"))

    assert formatted is not None
    assert formatted.endswith("+00:00")
    assert formatted.startswith(value.strftime("%Y-%m-%dT%H:%M:%S"))


@settings(max_examples=75)
@given(st.text().filter(lambda value: not value.strip()))
def test_fix_timestamp_format_treats_blank_strings_as_missing(value: str) -> None:
    assert TimestampPreprocessor.fix_timestamp_format(value) is None


# ---------------------------------------------------------------------------
# fix_timestamp_format — new property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_timestamp_str)
def test_fix_timestamp_format_returns_none_or_non_z_terminated(value: object) -> None:
    """Any non-None result must not end with bare 'Z'."""
    result = TimestampPreprocessor.fix_timestamp_format(value)  # type: ignore[arg-type]
    if result is not None:
        assert not result.endswith("Z"), f"Result {result!r} still has Z suffix"


@settings(max_examples=100)
@given(st.datetimes(timezones=st.just(UTC)).filter(lambda d: d.year >= 1900 and d.microsecond <= 999_999))
def test_fix_timestamp_format_z_suffix_becomes_plus_zero(value) -> None:
    """Any string ending in Z must become a string ending in +00:00."""
    z_str = value.isoformat().replace("+00:00", "Z")
    result = TimestampPreprocessor.fix_timestamp_format(z_str)
    assert result is not None
    assert result.endswith("+00:00")


def test_fix_timestamp_format_on_none_returns_none() -> None:
    assert TimestampPreprocessor.fix_timestamp_format(None) is None  # type: ignore[arg-type]


@settings(max_examples=100)
@given(st.text().filter(lambda s: not s.strip()))
def test_fix_timestamp_format_whitespace_only_returns_none(value: str) -> None:
    assert TimestampPreprocessor.fix_timestamp_format(value) is None


# ---------------------------------------------------------------------------
# correct_timestamp_column
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_timestamp_list)
def test_correct_timestamp_column_drops_internal_scratch_columns(values: list[object]) -> None:
    """Output must never contain the _original or _cleaned scratch columns added during correction.

    The method temporarily creates `<col>_original` and `<col>_cleaned` and must drop them.
    `<col>_invalid_original` is a legitimate output column and must be allowed.
    """
    df = _event_df(values)
    result = _preprocessor().correct_timestamp_column(df)
    scratch_suffixes = ("_original", "_cleaned")
    allowed_suffix = "_invalid_original"
    for col in result.columns:
        if col.endswith(allowed_suffix):
            continue
        for suffix in scratch_suffixes:
            assert not col.endswith(suffix), f"Scratch column {col!r} was not dropped"


@settings(max_examples=100)
@given(_timestamp_list)
def test_correct_timestamp_column_null_count_never_decreases(values: list[object]) -> None:
    """Null count in the event timestamp column must not decrease after correction."""
    df = _event_df(values)
    original_null_count = df[Column.EVENT_TIMESTAMP].null_count()
    result = _preprocessor().correct_timestamp_column(df)
    result_null_count = result[Column.EVENT_TIMESTAMP].null_count()
    assert result_null_count >= original_null_count, f"Null count decreased from {original_null_count} to {result_null_count}"


@settings(max_examples=100)
@given(_timestamp_list)
def test_correct_timestamp_column_preserves_row_count(values: list[object]) -> None:
    df = _event_df(values)
    result = _preprocessor().correct_timestamp_column(df)
    assert result.height == df.height


@settings(max_examples=100)
@given(_timestamp_list)
def test_correct_timestamp_column_invalid_original_only_where_input_was_non_null(
    values: list[object],
) -> None:
    """If _invalid_original appears, its non-null rows correspond to originally non-null inputs."""
    df = _event_df(values)
    result = _preprocessor().correct_timestamp_column(df)
    invalid_col = f"{Column.EVENT_TIMESTAMP}_invalid_original"
    if invalid_col not in result.columns:
        return
    # Each non-null value in the invalid column must come from a row that was non-null originally
    original_series = df[Column.EVENT_TIMESTAMP]
    invalid_series = result[invalid_col]
    for i, (orig, inv) in enumerate(zip(original_series.to_list(), invalid_series.to_list(), strict=False)):
        if inv is not None:
            assert orig is not None, f"Row {i}: invalid_original is non-null but original was null"


# ---------------------------------------------------------------------------
# mark_data_time_gaps
# ---------------------------------------------------------------------------

# Polars datetime[ns] overflows beyond ~2262-04-11; keep well within microsecond range.
_utc_timestamps = st.lists(
    st.datetimes(
        min_value=datetime(1900, 1, 1),
        max_value=datetime(2200, 12, 31),
        timezones=st.just(UTC),
    ),
    min_size=0,
    max_size=20,
).map(sorted)


def _datetime_df(timestamps: list) -> pl.DataFrame:
    return pl.DataFrame(
        {Column.EVENT_TIMESTAMP: timestamps},
        schema={Column.EVENT_TIMESTAMP: pl.Datetime("us", "UTC")},
    )


@settings(max_examples=100)
@given(_utc_timestamps)
def test_mark_data_time_gaps_gap_column_is_non_negative(timestamps: list) -> None:
    df = _datetime_df(timestamps)
    result = _preprocessor().mark_data_time_gaps(df)
    if Column.DATA_TIME_GAP_HOURS in result.columns:
        gaps = result[Column.DATA_TIME_GAP_HOURS].drop_nulls()
        assert (gaps >= 0).all(), "Found negative gap values"


@settings(max_examples=100)
@given(_utc_timestamps.filter(lambda ts_list: len(ts_list) >= 1))
def test_mark_data_time_gaps_first_row_is_zero(timestamps: list) -> None:
    df = _datetime_df(timestamps)
    result = _preprocessor().mark_data_time_gaps(df)
    if Column.DATA_TIME_GAP_HOURS in result.columns:
        first_gap = result[Column.DATA_TIME_GAP_HOURS][0]
        assert first_gap == 0.0, f"First gap was {first_gap}, expected 0.0"


# ---------------------------------------------------------------------------
# format_timestamps_as_strings
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_utc_timestamps.filter(lambda ts_list: len(ts_list) >= 1))
def test_format_timestamps_as_strings_output_schema_is_string(timestamps: list) -> None:
    """After formatting, the column dtype must be pl.String."""
    df = _datetime_df(timestamps)
    result = _preprocessor().format_timestamps_as_strings(df, [Column.EVENT_TIMESTAMP])
    assert result.schema[Column.EVENT_TIMESTAMP] == pl.String


# ---------------------------------------------------------------------------
# unalign_duplicate_timestamps
# ---------------------------------------------------------------------------


def _datetime_df_full(timestamps: list) -> pl.DataFrame:
    """Build a df with all columns required by _unalign_duplicate_timestamps."""
    n = len(timestamps)
    return pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series(timestamps, dtype=pl.Datetime("us", "UTC")),
            Column.INTERACTION_TYPE: pl.Series([str(InteractionType.ACTIVITY_RESUMED)] * n, dtype=pl.String),
            Column.APP_PACKAGE_NAME: pl.Series(["com.example.a"] * n, dtype=pl.String),
        }
    )


@settings(max_examples=100)
@given(_utc_timestamps)
def test_unalign_duplicate_timestamps_preserves_row_count(timestamps: list) -> None:
    """Row count may decrease only if exact dupes (ts+type+package) are removed."""
    df = _datetime_df_full(timestamps)
    result = _preprocessor().unalign_duplicate_timestamps(df)
    assert result.height <= df.height


@settings(max_examples=100)
@given(_utc_timestamps)
def test_unalign_duplicate_timestamps_produces_distinct_timestamps(timestamps: list) -> None:
    """After unaligning, all timestamps in the column should be distinct."""
    df = _datetime_df_full(timestamps)
    result = _preprocessor().unalign_duplicate_timestamps(df)
    if Column.EVENT_TIMESTAMP in result.columns and result.height > 0:
        ts_series = result[Column.EVENT_TIMESTAMP].drop_nulls()
        assert ts_series.n_unique() == len(ts_series), "Timestamps are not all distinct"


# ---------------------------------------------------------------------------
# check_for_disordered_timestamps
# ---------------------------------------------------------------------------


def test_check_for_disordered_timestamps_never_raises_on_empty_df() -> None:
    """Must not raise for empty dataframe regardless of column presence."""
    empty_df = pl.DataFrame(
        {
            Column.START_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us", "UTC")),
            Column.STOP_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us", "UTC")),
        }
    )
    TimestampPreprocessor.check_for_disordered_timestamps(empty_df)


@settings(max_examples=100)
@given(_utc_timestamps)
def test_check_for_disordered_timestamps_never_raises_on_empty_df_property(
    timestamps: list,
) -> None:
    """With no start/stop columns, should always silently return."""
    df = _datetime_df(timestamps)
    # df has no START_TIMESTAMP / STOP_TIMESTAMP columns → must not raise
    TimestampPreprocessor.check_for_disordered_timestamps(df)


# ---------------------------------------------------------------------------
# correct_timestamps (full pipeline)
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_utc_timestamps)
def test_correct_timestamps_pipeline_row_count_does_not_exceed_input(timestamps: list) -> None:
    """Full pipeline (on pre-parsed datetimes) may drop exact-duplicate rows but never adds rows."""
    df = _datetime_df_full(timestamps)
    result = _preprocessor().correct_timestamps(df)
    assert result.height <= df.height
