from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions

pytest.importorskip("matplotlib")

from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import MainPreprocessor
from tests.polars_helpers import ts


def test_selected_interaction_removal_preserves_only_thresholded_gap_rows() -> None:
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        use_filter_file=False,
        interaction_types_to_remove={InteractionType.SCREEN_INTERACTIVE},
        long_data_time_gap_thresholds=[1, 2, 3],
    )
    preprocessor = MainPreprocessor(options)
    preprocessor.current_participant_raw_data_df = pl.DataFrame(
        {
            Column.INTERACTION_TYPE: [
                str(InteractionType.SCREEN_INTERACTIVE),
                str(InteractionType.SCREEN_INTERACTIVE),
                str(InteractionType.ACTIVITY_RESUMED),
            ],
            Column.DATA_TIME_GAP_HOURS: [0.25, 1.0, 0.0],
            Column.EVENT_TIMESTAMP: [
                ts("2026-01-01 00:00:00"),
                ts("2026-01-01 00:01:00"),
                ts("2026-01-01 00:02:00"),
            ],
        }
    )

    preprocessor.remove_selected_interaction_types()

    assert preprocessor.current_participant_raw_data_df.get_column(
        Column.INTERACTION_TYPE
    ).to_list() == [
        str(InteractionType.SCREEN_INTERACTIVE),
        str(InteractionType.ACTIVITY_RESUMED),
    ]
    assert preprocessor.current_participant_raw_data_df.get_column(
        Column.DATA_TIME_GAP_HOURS
    ).to_list() == [1.0, 0.0]
