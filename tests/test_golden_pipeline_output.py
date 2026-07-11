"""
Golden file tests — run the full pipeline on fixed inputs and compare to committed reference CSVs.
To regenerate golden files: pytest tests/test_golden_pipeline_output.py --update-golden
"""

from __future__ import annotations

from pathlib import Path

import polars as pl

from chronicle_preprocessing_app.config.constants import UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)

GOLDEN_DIR = Path(__file__).parent / "golden"

# Fixed preprocessing timestamp so output is deterministic across runs.
_FIXED_DATETIME = "2026-01-01 00:00:00"

# ---------------------------------------------------------------------------
# Input CSV fixtures — written to a temp dir and fed to the pipeline as files.
# These use the raw Chronicle Android format (interaction types as "Unknown
# importance: N" so the rename step exercises the full pipeline path).
# ---------------------------------------------------------------------------

GOLDEN_APP_ONLY_CSV = """\
study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone
study1,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-10 10:00:00,,,America/Chicago
study1,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-10 10:05:00,,,America/Chicago
"""

GOLDEN_APP_AND_SCREEN_CSV = """\
study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone
study1,P01,Android,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-10 10:00:00,,,America/Chicago
study1,P01,Android,Target Child,Chat,Activity Paused,com.example.chat,2026-03-10 10:05:00,,,America/Chicago
study1,P01,Android,android,,Screen Interactive,android,2026-03-10 10:00:00,,,America/Chicago
study1,P01,Android,android,,Screen Non-Interactive,android,2026-03-10 10:06:00,,,America/Chicago
study1,P01,Android,android,,Keyguard Shown,android,2026-03-10 10:06:00,,,America/Chicago
study1,P01,Android,android,,Keyguard Hidden,android,2026-03-10 10:06:00,,,America/Chicago
"""

GOLDEN_MULTI_PARTICIPANT_CSV = """\
study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone
study1,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-10 09:00:00,,,America/Chicago
study1,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-10 09:15:00,,,America/Chicago
study1,P02,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-10 11:00:00,,,America/Chicago
study1,P02,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-10 11:30:00,,,America/Chicago
"""


def _write_fixture(folder: Path, name: str, csv_text: str) -> Path:
    path = folder / name
    path.write_text(csv_text)
    return path


def _base_options(
    raw_folder: Path, *, mode: UsageSessionMode = UsageSessionMode.APP_USAGE
) -> PreprocessingOptions:
    return PreprocessingOptions(
        study_name="GoldenStudy",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        usage_session_mode=mode,
        datetime_of_preprocessing_override=_FIXED_DATETIME,
        parallel_processing=False,
        enable_plotting=False,
    )


def _run_pipeline(raw_file: Path, options: PreprocessingOptions) -> Path:
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert success, f"Pipeline returned success=False for {raw_file.name}"
    return output_folder


def _read_csv_sorted(path: Path) -> pl.DataFrame:
    """Read a CSV without type inference, sort rows for deterministic comparison."""
    df = pl.read_csv(path, infer_schema=False)
    return df.sort(df.columns)


def _compare_or_update(actual_path: Path, golden_path: Path, *, update: bool) -> None:
    if update:
        import shutil

        golden_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(actual_path, golden_path)
        return

    assert golden_path.exists(), (
        f"Golden file missing: {golden_path}. Run with --update-golden to create it."
    )
    actual = _read_csv_sorted(actual_path)
    expected = _read_csv_sorted(golden_path)
    assert actual.equals(expected), (
        f"Output mismatch for {golden_path.name}.\n"
        f"Run with --update-golden to regenerate.\n"
        f"Expected columns: {expected.columns}\n"
        f"Actual columns:   {actual.columns}"
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_golden_app_only_app_usage(tmp_path: Path, request) -> None:
    """App-only fixture produces deterministic app usage CSV output."""
    update = request.config.getoption("--update-golden")

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = _write_fixture(raw_folder, "Raw P01.csv", GOLDEN_APP_ONLY_CSV)

    options = _base_options(raw_folder)
    output_folder = _run_pipeline(raw_file, options)

    actual_csv = next(output_folder.glob("P01 Automatically Preprocessed.csv"))
    _compare_or_update(actual_csv, GOLDEN_DIR / "app_only_app_usage.csv", update=update)


def test_golden_app_and_screen_app_usage(tmp_path: Path, request) -> None:
    """App+screen fixture produces deterministic app usage CSV output."""
    update = request.config.getoption("--update-golden")

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = _write_fixture(raw_folder, "Raw P01.csv", GOLDEN_APP_AND_SCREEN_CSV)

    options = _base_options(raw_folder, mode=UsageSessionMode.APP_AND_SCREEN_USAGE)
    output_folder = _run_pipeline(raw_file, options)

    actual_csv = next(output_folder.glob("P01 Automatically Preprocessed.csv"))
    _compare_or_update(actual_csv, GOLDEN_DIR / "app_and_screen_app_usage.csv", update=update)


def test_golden_app_and_screen_screen_usage(tmp_path: Path, request) -> None:
    """App+screen fixture produces deterministic screen usage CSV output."""
    update = request.config.getoption("--update-golden")

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = _write_fixture(raw_folder, "Raw P01.csv", GOLDEN_APP_AND_SCREEN_CSV)

    options = _base_options(raw_folder, mode=UsageSessionMode.APP_AND_SCREEN_USAGE)
    output_folder = _run_pipeline(raw_file, options)

    screen_csvs = list(output_folder.glob("P01 Screen Usage Automatically Preprocessed.csv"))
    if not screen_csvs:
        # No screen sessions derived from this fixture (e.g. insufficient events).
        # Update golden with an empty marker so the test is stable.
        golden_path = GOLDEN_DIR / "app_and_screen_screen_usage.csv"
        if update:
            golden_path.parent.mkdir(parents=True, exist_ok=True)
            golden_path.write_text("")
        else:
            assert golden_path.exists(), (
                f"Golden file missing: {golden_path}. Run with --update-golden."
            )
            assert golden_path.read_text() == "", (
                "Expected no screen usage output, but golden file is non-empty. Run with --update-golden to regenerate."
            )
        return

    actual_csv = screen_csvs[0]
    _compare_or_update(actual_csv, GOLDEN_DIR / "app_and_screen_screen_usage.csv", update=update)


def test_golden_multi_participant_app_usage(tmp_path: Path, request) -> None:
    """Multi-participant fixture produces deterministic app usage CSV outputs per participant."""
    update = request.config.getoption("--update-golden")

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()

    for participant, csv_text in [
        ("P01", GOLDEN_MULTI_PARTICIPANT_CSV),
        ("P02", GOLDEN_MULTI_PARTICIPANT_CSV),
    ]:
        # Slice to only rows for this participant so each file has one participant.
        lines = csv_text.splitlines(keepends=True)
        header = lines[0]
        participant_lines = [line for line in lines[1:] if f",{participant}," in line]
        participant_csv = header + "".join(participant_lines)
        _write_fixture(raw_folder, f"Raw {participant}.csv", participant_csv)

    for participant in ["P01", "P02"]:
        raw_file = raw_folder / f"Raw {participant}.csv"
        options = _base_options(raw_folder)
        output_folder = _run_pipeline(raw_file, options)
        actual_csv = next(output_folder.glob(f"{participant} Automatically Preprocessed.csv"))
        _compare_or_update(
            actual_csv,
            GOLDEN_DIR / f"multi_participant_{participant}_app_usage.csv",
            update=update,
        )
