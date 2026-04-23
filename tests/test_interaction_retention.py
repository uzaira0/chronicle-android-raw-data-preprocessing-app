from __future__ import annotations

import pandas as pd
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions

pytest.importorskip("matplotlib")

from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import MainPreprocessor


def test_selected_interaction_removal_preserves_only_thresholded_gap_rows() -> None:
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        use_filter_file=False,
        interaction_types_to_remove={InteractionType.SCREEN_INTERACTIVE},
        long_data_time_gap_thresholds=[1, 2, 3],
    )
    preprocessor = MainPreprocessor(options)
    preprocessor.current_participant_raw_data_df = pd.DataFrame(
        {
            Column.INTERACTION_TYPE: [
                InteractionType.SCREEN_INTERACTIVE,
                InteractionType.SCREEN_INTERACTIVE,
                InteractionType.ACTIVITY_RESUMED,
            ],
            Column.DATA_TIME_GAP_HOURS: [0.25, 1.0, 0.0],
            Column.EVENT_TIMESTAMP: pd.to_datetime(
                [
                    "2026-01-01 00:00:00",
                    "2026-01-01 00:01:00",
                    "2026-01-01 00:02:00",
                ]
            ),
        }
    )

    preprocessor.remove_selected_interaction_types()

    assert preprocessor.current_participant_raw_data_df[Column.INTERACTION_TYPE].tolist() == [
        InteractionType.SCREEN_INTERACTIVE,
        InteractionType.ACTIVITY_RESUMED,
    ]
    assert preprocessor.current_participant_raw_data_df[Column.DATA_TIME_GAP_HOURS].tolist() == [
        1.0,
        0.0,
    ]
