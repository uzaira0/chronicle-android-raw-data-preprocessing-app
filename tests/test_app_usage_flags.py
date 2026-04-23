from __future__ import annotations

import numpy as np
import pandas as pd

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.app_usage_preprocessor import (
    AppUsagePreprocessor,
)


def test_app_usage_flags_preserve_threshold_order_and_empty_lists() -> None:
    preprocessor = AppUsagePreprocessor(PreprocessingOptions(raw_data_folder=""))

    flags = preprocessor._get_app_usage_flags(
        pd.Series([0.5, 3.0, 12.0, np.nan]),
        pd.Series([10.0, 120.0, 900.0, np.nan]),
        time_gap_thresholds=[1, 6, 12],
        duration_thresholds=[1, 12],
    )

    assert flags.tolist() == [
        [],
        [">1-HR TIME GAP", ">1-HR APP USAGE"],
        [">12-HR TIME GAP", ">12-HR APP USAGE"],
        [],
    ]
