from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
    _BROAD_CATEGORY_SOURCE_COLUMNS,
)

# Cross-surface contract for the optional broad_app_category output column (#10).
# These cases MUST match the web deriveBroadAppCategory exactly — see
# web/src/lib/categoryColumn.test.ts and the deterministic parity scenario
# "category_app". The tuple order is (play_store, usc, babyemu, bcm).
_CASES: list[tuple[tuple[str | None, str | None, str | None, str | None], str]] = [
    (("Games", None, None, None), "Games"),
    (("Video Players & Editors", None, "KNOWLEDGE_AND_INFORMATION", None), "Education"),
    ((None, None, None, None), "Unknown"),
    (("Other", None, "GAMING", None), "Games"),
    ((None, None, None, "Other"), "Uncategorised"),
    (("  Education ", None, "SOCIAL", None), "Education"),
    ((None, None, "COMMUNICATION", None), "Social & Communication"),
    ((None, None, "UTILITIES", None), "Productivity & Business"),
    (("System/OEM", None, None, None), "Uncategorised"),
]


@pytest.mark.parametrize("candidates, expected", _CASES)
def test_normalized_broad_category(
    candidates: tuple[str | None, str | None, str | None, str | None], expected: str
) -> None:
    columns = list(_BROAD_CATEGORY_SOURCE_COLUMNS)
    frame = pl.DataFrame({column: [value] for column, value in zip(columns, candidates)})
    result = (
        frame.select(PolarsFastPathPreprocessor._normalized_broad_category_expr(columns))
        .to_series()
        .to_list()
    )
    assert result == [expected]


def test_normalized_broad_category_no_candidates_is_unknown() -> None:
    # Defensive branch (never hit in practice — the four source columns are
    # always present once the codebook is joined). Use with_columns, which is how
    # the expression is consumed, so the literal broadcasts across all rows.
    from chronicle_preprocessing_app.config.constants import Column

    expr = PolarsFastPathPreprocessor._normalized_broad_category_expr([])
    result = (
        pl.DataFrame({"x": [1, 2]})
        .with_columns(expr)
        .get_column(Column.BROAD_APP_CATEGORY)
        .to_list()
    )
    assert result == ["Unknown", "Unknown"]
