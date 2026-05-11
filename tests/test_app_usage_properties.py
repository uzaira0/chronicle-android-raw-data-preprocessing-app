"""Property-based tests for the app-usage preprocessing algorithm."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import polars as pl
from hypothesis import given, settings
from hypothesis import strategies as st

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms import (
    OptimizedAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.app_usage_preprocessor import (
    AppUsagePreprocessor,
)
from tests.polars_helpers import frame
from tests.polars_helpers import options as _base_options

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UTC = ZoneInfo("UTC")

_INTERACTION_TYPES = st.sampled_from(
    [
        str(InteractionType.ACTIVITY_RESUMED),
        str(InteractionType.ACTIVITY_PAUSED),
        str(InteractionType.ACTIVITY_STOPPED),
        str(InteractionType.SCREEN_NON_INTERACTIVE),
    ]
)

_PACKAGES = st.sampled_from(["com.example.a", "com.example.b", "android"])


def _options(**overrides: object) -> PreprocessingOptions:
    return _base_options(
        **{
            "same_app_interaction_types_to_stop_usage_at": {InteractionType.ACTIVITY_PAUSED},
            "other_interaction_types_to_stop_usage_at": {
                InteractionType.ACTIVITY_RESUMED,
                InteractionType.FILTERED_APP_RESUMED,
                InteractionType.FILTERED_APP_USAGE,
                InteractionType.DEVICE_SHUTDOWN,
            },
            "use_activity_stopped_as_fallback": True,
            "apply_threshold_to_activity_stopped_fallback": True,
            "long_duration_threshold_hours": 12,
            **overrides,
        }
    )


def _run_algorithm(df: pl.DataFrame, options: PreprocessingOptions) -> pl.DataFrame:
    algorithm = OptimizedAppUsageAlgorithm(options)
    resumed_mask = df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_RESUMED)
    same_app_stop_mask = df.get_column(Column.INTERACTION_TYPE).is_in([str(v) for v in options.same_app_interaction_types_to_stop_usage_at])
    other_stop_mask = df.get_column(Column.INTERACTION_TYPE).is_in([str(v) for v in options.other_interaction_types_to_stop_usage_at])
    stopped_mask = df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_STOPPED)
    return algorithm.process_app_usage(
        df,
        resumed_mask,
        same_app_stop_mask,
        other_stop_mask,
        stopped_mask,
    )


_DATETIME_SCHEMA: dict[str, pl.DataType] = {
    Column.EVENT_TIMESTAMP: pl.Datetime("us", "UTC"),
    Column.START_TIMESTAMP: pl.Datetime("us", "UTC"),
    Column.STOP_TIMESTAMP: pl.Datetime("us", "UTC"),
    Column.INTERACTION_TYPE: pl.String,
    Column.APP_PACKAGE_NAME: pl.String,
    Column.TIMEZONE: pl.String,
}

_EMPTY_DF = pl.DataFrame(
    {
        Column.EVENT_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us", "UTC")),
        Column.INTERACTION_TYPE: pl.Series([], dtype=pl.String),
        Column.APP_PACKAGE_NAME: pl.Series([], dtype=pl.String),
        Column.START_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us", "UTC")),
        Column.STOP_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us", "UTC")),
        Column.TIMEZONE: pl.Series([], dtype=pl.String),
    }
)


@st.composite
def event_df(draw: st.DrawFn) -> pl.DataFrame:
    n: int = draw(st.integers(min_value=0, max_value=20))
    if n == 0:
        return _EMPTY_DF

    raw_timestamps: list[datetime] = draw(
        st.lists(
            st.datetimes(
                min_value=datetime(2020, 1, 1),
                max_value=datetime(2026, 12, 31),
            ).map(lambda d: d.replace(tzinfo=_UTC)),
            min_size=n,
            max_size=n,
        )
    )
    timestamps = sorted(raw_timestamps)
    rows: list[dict[str, object]] = []
    for timestamp in timestamps:
        it: str = draw(_INTERACTION_TYPES)
        pkg: str = draw(_PACKAGES)
        rows.append(
            {
                Column.EVENT_TIMESTAMP: timestamp,
                Column.INTERACTION_TYPE: it,
                Column.APP_PACKAGE_NAME: pkg,
                Column.START_TIMESTAMP: None,
                Column.STOP_TIMESTAMP: None,
                Column.TIMEZONE: "UTC",
            }
        )
    return frame(rows)


# ---------------------------------------------------------------------------
# Property tests
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(event_df())
def test_output_row_count_ge_activity_resumed_count(df: pl.DataFrame) -> None:
    """Algorithm must produce at least as many rows as there are ACTIVITY_RESUMED events."""
    options = _options()
    result = _run_algorithm(df, options)
    resumed_count = (df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_RESUMED)).sum()
    assert result.height >= resumed_count, f"Output has {result.height} rows but input had {resumed_count} ACTIVITY_RESUMED rows"


@settings(max_examples=100)
@given(event_df())
def test_app_usage_rows_have_non_null_package_name(df: pl.DataFrame) -> None:
    """All APP_USAGE rows must have a non-null app package name."""
    options = _options()
    result = _run_algorithm(df, options)
    app_usage_rows = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    if app_usage_rows.height == 0:
        return
    null_count = app_usage_rows[Column.APP_PACKAGE_NAME].null_count()
    assert null_count == 0, f"Found {null_count} null package names in APP_USAGE rows"


@settings(max_examples=100)
@given(event_df())
def test_app_usage_rows_have_non_null_start_timestamp(df: pl.DataFrame) -> None:
    """All APP_USAGE rows must have a non-null start timestamp."""
    options = _options()
    result = _run_algorithm(df, options)
    app_usage_rows = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    if app_usage_rows.height == 0:
        return
    null_count = app_usage_rows[Column.START_TIMESTAMP].null_count()
    assert null_count == 0, f"Found {null_count} null START_TIMESTAMP in APP_USAGE rows"


def test_empty_input_produces_empty_or_no_app_usage_rows() -> None:
    """Empty input dataframe must produce no APP_USAGE rows."""
    options = _options()
    result = _run_algorithm(_EMPTY_DF, options)
    app_usage_rows = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    assert app_usage_rows.height == 0


@settings(max_examples=100)
@given(
    st.lists(
        st.datetimes(
            min_value=datetime(2020, 1, 1),
            max_value=datetime(2026, 12, 31),
        ).map(lambda d: d.replace(tzinfo=_UTC)),
        min_size=0,
        max_size=20,
    ).map(sorted)
)
def test_all_paused_input_has_no_app_usage_rows(timestamps: list[datetime]) -> None:
    """All-ACTIVITY_PAUSED input must produce zero APP_USAGE rows (no starts)."""
    options = _options()
    if not timestamps:
        df = _EMPTY_DF
    else:
        rows = [
            {
                Column.EVENT_TIMESTAMP: t,
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.a",
                Column.START_TIMESTAMP: None,
                Column.STOP_TIMESTAMP: None,
                Column.TIMEZONE: "UTC",
            }
            for t in timestamps
        ]
        df = frame(rows)
    result = _run_algorithm(df, options)
    app_usage_rows = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    assert app_usage_rows.height == 0


@settings(max_examples=50)
@given(event_df().filter(lambda d: d.height > 0))
def test_algorithm_is_deterministic(df: pl.DataFrame) -> None:
    """Same input must produce identical output on two consecutive calls."""
    options = _options()
    result_a = _run_algorithm(df.clone(), options)
    result_b = _run_algorithm(df.clone(), options)
    assert result_a.equals(result_b), "Algorithm produced different results on identical input"


@settings(max_examples=100)
@given(event_df())
def test_interaction_type_values_are_not_raw_unknown_importance(df: pl.DataFrame) -> None:
    """No row should have an INTERACTION_TYPE string starting with 'Unknown importance:'."""
    options = _options()
    result = _run_algorithm(df, options)
    if result.height == 0:
        return
    # Cast to String to handle Object dtype returned for empty inputs
    result_str = result.with_columns(pl.col(Column.INTERACTION_TYPE).cast(pl.String))
    bad_rows = result_str.filter(pl.col(Column.INTERACTION_TYPE).str.starts_with("Unknown importance:"))
    assert bad_rows.height == 0, f"Found {bad_rows.height} rows with raw 'Unknown importance:' interaction type"


@settings(max_examples=100)
@given(event_df())
def test_app_usage_start_le_stop_when_both_present(df: pl.DataFrame) -> None:
    """For APP_USAGE rows, START_TIMESTAMP must be ≤ STOP_TIMESTAMP when both are non-null."""
    options = _options()
    result = _run_algorithm(df, options)
    app_usage_rows = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    both_present = app_usage_rows.filter(pl.col(Column.START_TIMESTAMP).is_not_null() & pl.col(Column.STOP_TIMESTAMP).is_not_null())
    if both_present.height == 0:
        return
    disordered = both_present.filter(pl.col(Column.START_TIMESTAMP) > pl.col(Column.STOP_TIMESTAMP))
    assert disordered.height == 0, f"Found {disordered.height} APP_USAGE rows where START > STOP"


@settings(max_examples=100)
@given(event_df())
def test_output_contains_event_timestamp_column(df: pl.DataFrame) -> None:
    """Output must always contain the EVENT_TIMESTAMP column."""
    options = _options()
    result = _run_algorithm(df, options)
    assert Column.EVENT_TIMESTAMP in result.columns


@settings(max_examples=100)
@given(event_df())
def test_output_contains_interaction_type_column(df: pl.DataFrame) -> None:
    """Output must always contain the INTERACTION_TYPE column."""
    options = _options()
    result = _run_algorithm(df, options)
    assert Column.INTERACTION_TYPE in result.columns


@settings(max_examples=100)
@given(event_df())
def test_output_row_count_is_at_least_input_row_count(df: pl.DataFrame) -> None:
    """Algorithm may add END_OF_USAGE_MISSING rows but must not silently drop rows."""
    options = _options()
    result = _run_algorithm(df, options)
    assert result.height >= df.height, f"Output ({result.height} rows) is smaller than input ({df.height} rows)"


@settings(max_examples=100)
@given(event_df())
def test_process_app_usage_preprocessor_does_not_raise(df: pl.DataFrame) -> None:
    """AppUsagePreprocessor.process_app_usage must not raise for arbitrary valid input."""
    options = _options()
    preprocessor = AppUsagePreprocessor(options)
    # process_app_usage swallows NoAppUsageDataError; any other exception is a bug
    preprocessor.process_app_usage(df)


@settings(max_examples=100)
@given(event_df())
def test_non_app_usage_rows_retain_original_interaction_type(df: pl.DataFrame) -> None:
    """Rows that are not converted to APP_USAGE must keep their original interaction type."""
    options = _options()
    result = _run_algorithm(df, options)
    # All original interaction types in the input should still appear in the output
    # (the algorithm doesn't change non-resumed rows' types)
    input_types = set(df.get_column(Column.INTERACTION_TYPE).drop_nulls().to_list())
    output_types = set(result.get_column(Column.INTERACTION_TYPE).drop_nulls().to_list())
    for it in input_types:
        if it != str(InteractionType.ACTIVITY_RESUMED):
            assert it in output_types, f"Input interaction type {it!r} was lost in the output"


@settings(max_examples=100)
@given(event_df())
def test_app_usage_rows_have_non_null_event_timestamp(df: pl.DataFrame) -> None:
    """Every APP_USAGE row must carry a non-null EVENT_TIMESTAMP."""
    options = _options()
    result = _run_algorithm(df, options)
    app_usage_rows = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    if app_usage_rows.height == 0:
        return
    null_count = app_usage_rows[Column.EVENT_TIMESTAMP].null_count()
    assert null_count == 0, f"Found {null_count} null EVENT_TIMESTAMP in APP_USAGE rows"


@settings(max_examples=100)
@given(event_df())
def test_app_package_name_never_null_for_input_rows_that_had_package(df: pl.DataFrame) -> None:
    """APP_PACKAGE_NAME must not become null for rows that had a package name in the input."""
    options = _options()
    result = _run_algorithm(df, options)
    # Result has the same height as input (or more), non-null packages in input should stay non-null
    if df.height == 0:
        return
    original_non_null = df[Column.APP_PACKAGE_NAME].is_not_null().sum()
    result_first_n = result.head(df.height)
    output_non_null = result_first_n[Column.APP_PACKAGE_NAME].is_not_null().sum()
    assert output_non_null >= original_non_null


@settings(max_examples=100)
@given(event_df())
def test_output_schema_contains_start_and_stop_timestamps(df: pl.DataFrame) -> None:
    """Output schema must include START_TIMESTAMP and STOP_TIMESTAMP columns."""
    options = _options()
    result = _run_algorithm(df, options)
    assert Column.START_TIMESTAMP in result.columns
    assert Column.STOP_TIMESTAMP in result.columns


@settings(max_examples=100)
@given(event_df())
def test_no_duplicate_consecutive_app_usage_for_same_app(df: pl.DataFrame) -> None:
    """Two consecutive APP_USAGE rows for the same package must not have identical timestamps."""
    options = _options()
    result = _run_algorithm(df, options)
    app_usage = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    if app_usage.height < 2:
        return
    # Consecutive rows with same package and same START_TIMESTAMP would indicate a bug
    shifted_pkg = app_usage[Column.APP_PACKAGE_NAME].shift(1)
    shifted_start = app_usage[Column.START_TIMESTAMP].shift(1)
    same_pkg = app_usage[Column.APP_PACKAGE_NAME] == shifted_pkg
    same_start = app_usage[Column.START_TIMESTAMP] == shifted_start
    duplicates = (same_pkg & same_start).drop_nulls().sum()
    assert duplicates == 0, f"Found {duplicates} consecutive APP_USAGE rows with same package+start"


@settings(max_examples=100)
@given(event_df())
def test_result_height_is_non_negative(df: pl.DataFrame) -> None:
    """Output height is always a non-negative integer."""
    options = _options()
    result = _run_algorithm(df, options)
    assert result.height >= 0


@settings(max_examples=100)
@given(event_df())
def test_all_column_names_are_strings(df: pl.DataFrame) -> None:
    """Every column name in the output is a non-empty string."""
    options = _options()
    result = _run_algorithm(df, options)
    for col in result.columns:
        assert isinstance(col, str) and col, f"Invalid column name: {col!r}"


@settings(max_examples=50)
@given(
    event_df().filter(lambda d: d.height > 0),
    event_df().filter(lambda d: d.height > 0),
)
def test_algorithm_processes_independent_inputs_without_cross_contamination(df_a: pl.DataFrame, df_b: pl.DataFrame) -> None:
    """Processing df_a must not affect the result for df_b."""
    options = _options()
    result_b_before = _run_algorithm(df_b.clone(), options)
    _run_algorithm(df_a.clone(), options)  # side-effect check
    result_b_after = _run_algorithm(df_b.clone(), options)
    assert result_b_before.equals(result_b_after), "Processing df_a changed the result for df_b — stateful bug detected"
