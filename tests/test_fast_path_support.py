from __future__ import annotations

import datetime
from datetime import UTC

import pytest

from chronicle_preprocessing_app.config.constants import UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    polars_fast_path_enabled,
    supports_polars_fast_path,
)
from tests.polars_helpers import options as _options


def _supports(options: PreprocessingOptions, *, survey: bool = False, study_date: bool = False) -> bool:
    return supports_polars_fast_path(
        options,
        survey_data_processor_available=survey,
        study_date_provider_available=study_date,
    )


# ---------------------------------------------------------------------------
# Default options — fast path should be True
# ---------------------------------------------------------------------------


def test_default_options_enables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options()
    assert _supports(options) is True


# ---------------------------------------------------------------------------
# Individual gates that disable the fast path
# ---------------------------------------------------------------------------


def test_process_screen_usage_true_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options(usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE)
    assert _supports(options) is False


def test_screen_usage_only_mode_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options(usage_session_mode=UsageSessionMode.SCREEN_USAGE)
    assert _supports(options) is False


def test_process_app_usage_false_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    # SCREEN_USAGE mode → process_app_usage_sessions is False
    options = _options(usage_session_mode=UsageSessionMode.SCREEN_USAGE)
    assert options.process_app_usage_sessions is False
    assert _supports(options) is False


def test_survey_data_processor_available_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options()
    assert _supports(options, survey=True) is False


def test_study_date_provider_available_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options()
    assert _supports(options, study_date=True) is False


# ---------------------------------------------------------------------------
# Env-var gating via polars_fast_path_enabled()
# ---------------------------------------------------------------------------


def test_env_var_false_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")
    assert polars_fast_path_enabled() is False
    assert _supports(_options()) is False


def test_env_var_zero_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "0")
    assert polars_fast_path_enabled() is False


def test_env_var_no_disables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "no")
    assert polars_fast_path_enabled() is False


def test_env_var_true_enables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")
    assert polars_fast_path_enabled() is True


def test_env_var_TRUE_case_insensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "TRUE")
    assert polars_fast_path_enabled() is True


def test_env_var_one_enables_fast_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "1")
    assert polars_fast_path_enabled() is True


def test_env_var_absent_defaults_to_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    assert polars_fast_path_enabled() is True


def test_env_var_FALSE_uppercase_disables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "FALSE")
    assert polars_fast_path_enabled() is False


def test_env_var_NO_uppercase_disables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "NO")
    assert polars_fast_path_enabled() is False


# ---------------------------------------------------------------------------
# All conditions True except one → still False
# ---------------------------------------------------------------------------


def test_all_ok_except_env_var_is_false(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")
    options = _options(usage_session_mode=UsageSessionMode.APP_USAGE)
    assert _supports(options, survey=False, study_date=False) is False


def test_all_ok_except_screen_usage_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options(usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE)
    assert _supports(options, survey=False, study_date=False) is False


def test_all_ok_except_survey_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options(usage_session_mode=UsageSessionMode.APP_USAGE)
    assert _supports(options, survey=True, study_date=False) is False


def test_all_ok_except_study_date_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options(usage_session_mode=UsageSessionMode.APP_USAGE)
    assert _supports(options, survey=False, study_date=True) is False


# ---------------------------------------------------------------------------
# study_date_map on options → StudyDateRangeProvider.is_available
# ---------------------------------------------------------------------------


def test_nonempty_study_date_map_makes_provider_available() -> None:
    from chronicle_preprocessing_app.core.preprocessing.study_date_provider import (
        StudyDateRangeProvider,
    )

    options = _options(
        study_date_map={
            "P01": (
                datetime.datetime(2026, 1, 1, tzinfo=UTC),
                datetime.datetime(2026, 1, 31, tzinfo=UTC),
            )
        }
    )
    assert options.study_date_map
    provider = StudyDateRangeProvider(options.study_date_map)
    assert provider.is_available is True


def test_full_gating_nonempty_study_date_map_blocks_fast_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHRONICLE_USE_POLARS_FAST_PATH", raising=False)
    options = _options(
        study_date_map={
            "P01": (
                datetime.datetime(2026, 1, 1, tzinfo=UTC),
                datetime.datetime(2026, 1, 31, tzinfo=UTC),
            )
        }
    )
    # Simulate the orchestrator having initialised a StudyDateRangeProvider with data
    from chronicle_preprocessing_app.core.preprocessing.study_date_provider import (
        StudyDateRangeProvider,
    )

    provider = StudyDateRangeProvider(options.study_date_map)
    assert _supports(options, survey=False, study_date=provider.is_available) is False


# ---------------------------------------------------------------------------
# process_app_usage_sessions / process_screen_usage_sessions property checks
# ---------------------------------------------------------------------------


def test_app_usage_mode_has_correct_properties() -> None:
    options = _options(usage_session_mode=UsageSessionMode.APP_USAGE)
    assert options.process_app_usage_sessions is True
    assert options.process_screen_usage_sessions is False


def test_screen_usage_mode_has_correct_properties() -> None:
    options = _options(usage_session_mode=UsageSessionMode.SCREEN_USAGE)
    assert options.process_app_usage_sessions is False
    assert options.process_screen_usage_sessions is True


def test_app_and_screen_usage_mode_has_correct_properties() -> None:
    options = _options(usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE)
    assert options.process_app_usage_sessions is True
    assert options.process_screen_usage_sessions is True
