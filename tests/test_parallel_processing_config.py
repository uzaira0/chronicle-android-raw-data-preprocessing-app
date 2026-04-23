from __future__ import annotations

import multiprocessing
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pandas as pd

from chronicle_preprocessing_app.config.constants import InteractionType, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    _build_parallel_options_dict,
    _resolve_parallel_max_workers,
)


def _config_manager_class() -> type:
    module_path = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "chronicle_preprocessing_app"
        / "gui"
        / "utils"
        / "config_manager.py"
    )
    spec = spec_from_file_location("config_manager_under_test", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ConfigManager


def test_parallel_worker_options_preserve_behavior_settings() -> None:
    options = PreprocessingOptions(
        raw_data_folder="/tmp/raw",
        use_filter_file=False,
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
        same_app_interaction_types_to_stop_usage_at={InteractionType.ACTIVITY_DESTROYED},
        other_interaction_types_to_stop_usage_at={InteractionType.DEVICE_SHUTDOWN},
        interaction_types_to_remove={InteractionType.NOTIFICATION_SEEN},
        same_app_interaction_types_configured=True,
        other_interaction_types_configured=True,
        interaction_types_to_remove_configured=True,
        allow_stop_event_reuse=True,
        use_activity_stopped_as_fallback=False,
        apply_threshold_to_activity_stopped_fallback=False,
        long_duration_threshold_hours=4.5,
        screen_usage_auto_lock_timeout_seconds=180,
        parallel_processing=True,
        parallel_max_workers=8,
        survey_data_df=pd.DataFrame({"participant_id": ["p1"]}),
    )

    worker_options = _build_parallel_options_dict(options)
    recreated = PreprocessingOptions(**worker_options)

    assert "survey_data_df" not in worker_options
    assert recreated.same_app_interaction_types_to_stop_usage_at == {
        InteractionType.ACTIVITY_DESTROYED
    }
    assert recreated.other_interaction_types_to_stop_usage_at == {
        InteractionType.DEVICE_SHUTDOWN
    }
    assert recreated.interaction_types_to_remove == {InteractionType.NOTIFICATION_SEEN}
    assert recreated.allow_stop_event_reuse is True
    assert recreated.use_activity_stopped_as_fallback is False
    assert recreated.apply_threshold_to_activity_stopped_fallback is False
    assert recreated.long_duration_threshold_hours == 4.5
    assert recreated.usage_session_mode == UsageSessionMode.APP_AND_SCREEN_USAGE
    assert recreated.screen_usage_auto_lock_timeout_seconds == 180
    assert recreated.enable_plotting is False
    assert recreated.parallel_processing is False
    assert recreated.parallel_max_workers is None


def test_parallel_worker_count_auto_and_user_limits_are_safe() -> None:
    auto_workers = _resolve_parallel_max_workers(None, file_count=10_000)

    assert auto_workers == max(1, multiprocessing.cpu_count() // 2)
    assert _resolve_parallel_max_workers(0, file_count=3) <= 3
    assert _resolve_parallel_max_workers(99, file_count=3) == 3
    assert _resolve_parallel_max_workers(2, file_count=3) == 2
    assert _resolve_parallel_max_workers(-5, file_count=1) == 1


def test_config_manager_restores_parallel_settings() -> None:
    options = _config_manager_class()().apply_config_to_options(
        PreprocessingOptions(),
        {"parallel_processing": True, "parallel_max_workers": "6"},
    )

    assert options.parallel_processing is True
    assert options.parallel_max_workers == 6


def test_config_manager_restores_auto_parallel_workers() -> None:
    options = _config_manager_class()().apply_config_to_options(
        PreprocessingOptions(parallel_max_workers=4),
        {"parallel_processing": True, "parallel_max_workers": None},
    )

    assert options.parallel_processing is True
    assert options.parallel_max_workers is None
