from __future__ import annotations

import openpyxl
import pytest

from chronicle_preprocessing_app.config.constants import InteractionType, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions, ProcessingStats
from chronicle_preprocessing_app.utils.file_utils import (
    AppsForcingScreenOpenFileError,
    CodebookFileError,
    FilterFileError,
    get_matching_files_from_folder,
    read_app_codebook,
    read_apps_forcing_screen_open_file,
    read_filter_file,
)


def _write_xlsx(path, header: list[str], rows: list[list[object]]) -> None:
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.append(header)
    for row in rows:
        worksheet.append(row)
    workbook.save(path)
    workbook.close()


def test_preprocessing_options_normalizes_screen_usage_mode_and_filtered_stops() -> None:
    options = PreprocessingOptions(
        raw_data_folder="/tmp/raw",
        derive_screen_usage_sessions=True,
        same_app_interaction_types_to_stop_usage_at={
            InteractionType.ACTIVITY_PAUSED,
            InteractionType.ACTIVITY_STOPPED,
            InteractionType.ACTIVITY_DESTROYED,
            InteractionType.ACTIVITY_RESUMED,
        },
    )

    assert options.usage_session_mode == UsageSessionMode.APP_AND_SCREEN_USAGE
    assert options.process_app_usage_sessions is True
    assert options.process_screen_usage_sessions is True
    assert options.output_folder.as_posix() == "/tmp"
    assert options.filtered_same_app_interaction_types_to_stop_usage_at == {
        InteractionType.FILTERED_APP_PAUSED,
        InteractionType.FILTERED_APP_STOPPED,
        InteractionType.FILTERED_APP_DESTROYED,
        InteractionType.FILTERED_APP_RESUMED,
    }


def test_processing_stats_tracks_errors_warnings_plots_and_rates(tmp_path) -> None:
    stats = ProcessingStats(total_files=2)
    processed = tmp_path / "Raw P01.csv"

    stats.mark_processed(processed)
    stats.mark_empty_file("Raw P02.csv")
    stats.add_file_error("Raw P02.csv", "schema")
    stats.mark_plotted("Raw P01.csv", "with_app_usage")
    stats.mark_empty_plot_file("Raw P03.csv")
    stats.add_plot_warning("Raw P01.csv", "large gap")
    stats.mark_plot_failed("Raw P02.csv", "bad data", "validation")
    stats.add_plot_error("Raw P03.csv", "missing timestamp", "schema")
    stats.mark_error(tmp_path / "Raw P04.csv", "unreadable")

    assert stats.success_rate() == 50.0
    assert stats.processed_file_paths == {processed}
    assert stats.file_errors == {"Raw P02.csv": ["schema"]}
    assert stats.plot_success_types == {"with_app_usage": 1}
    assert stats.plot_error_types == {"validation": 1, "schema": 1}
    assert stats.failed_files == 3
    assert "Processed 1/2 files (50.0%), Plotted 1/1 files (100.0%), Failed: 3, Empty: 1" == stats.summary()
    detailed = stats.get_detailed_summary()
    assert "Raw P02.csv" in detailed
    assert "large gap" in detailed


def test_processing_stats_zero_total_success_rate_is_zero() -> None:
    assert ProcessingStats().success_rate() == 0.0


def test_get_matching_files_filters_ignored_paths_and_rejects_bad_roots(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "Raw P01.csv").write_text("ok", encoding="utf-8")
    ignored = raw / "Preprocessed"
    ignored.mkdir()
    (ignored / "Raw P02.csv").write_text("ignored", encoding="utf-8")

    assert get_matching_files_from_folder(raw, r"Raw .*\.csv") == [raw / "Raw P01.csv"]
    assert get_matching_files_from_folder(raw, r"Raw .*\.csv", ignore_names=["P01"]) == [ignored / "Raw P02.csv"]
    with pytest.raises(ValueError, match="Folder does not exist"):
        get_matching_files_from_folder(tmp_path / "missing", r".*")
    with pytest.raises(ValueError, match="Path is not a directory"):
        get_matching_files_from_folder(raw / "Raw P01.csv", r".*")


def test_support_file_readers_accept_xlsx_and_normalize_blank_values(tmp_path) -> None:
    filter_path = tmp_path / "filter.xlsx"
    forcing_path = tmp_path / "forcing.xlsx"
    _write_xlsx(
        filter_path,
        ["package_name", "labels"],
        [["com.example.app", " Example "], [None, "skip"], ["com.nan", "nan"]],
    )
    _write_xlsx(
        forcing_path,
        ["package_name", "label"],
        [["com.example.video", " Video "], ["# comment", "skip"], [None, "skip"]],
    )

    assert read_filter_file(filter_path) == {
        "com.example.app": "Example",
        "com.nan": "",
    }
    assert read_apps_forcing_screen_open_file(forcing_path) == {
        "com.example.video": "Video",
    }


def test_support_file_readers_accept_empty_xlsx_files(tmp_path) -> None:
    filter_path = tmp_path / "filter.xlsx"
    forcing_path = tmp_path / "forcing.xlsx"
    _write_xlsx(filter_path, ["package_name", "labels"], [[]])
    _write_xlsx(forcing_path, ["package_name", "label"], [[]])

    assert read_filter_file(filter_path) == {}
    assert read_apps_forcing_screen_open_file(forcing_path) == {}


def test_support_file_readers_reject_missing_or_malformed_files(tmp_path) -> None:
    missing = tmp_path / "missing.csv"
    bad_filter = tmp_path / "bad-filter.csv"
    bad_forcing = tmp_path / "bad-forcing.csv"
    unsupported_filter = tmp_path / "bad-filter.txt"
    unsupported_forcing = tmp_path / "bad-forcing.txt"
    bad_filter.write_text("only_one_column\nvalue\n", encoding="utf-8")
    bad_forcing.write_text("", encoding="utf-8")
    unsupported_filter.write_text("package,label\ncom.example,Example\n", encoding="utf-8")
    unsupported_forcing.write_text("package,label\ncom.example,Example\n", encoding="utf-8")

    with pytest.raises(FilterFileError, match="does not exist"):
        read_filter_file(missing)
    with pytest.raises(FilterFileError, match="at least two columns"):
        read_filter_file(bad_filter)
    with pytest.raises(FilterFileError, match="Unsupported file type"):
        read_filter_file(unsupported_filter)
    with pytest.raises(AppsForcingScreenOpenFileError, match="at least one column"):
        read_apps_forcing_screen_open_file(bad_forcing)
    with pytest.raises(AppsForcingScreenOpenFileError, match="does not exist"):
        read_apps_forcing_screen_open_file(missing)
    with pytest.raises(AppsForcingScreenOpenFileError, match="Unsupported file type"):
        read_apps_forcing_screen_open_file(unsupported_forcing)


def test_app_codebook_reader_deduplicates_and_reports_schema_errors(tmp_path) -> None:
    codebook = tmp_path / "codebook.csv"
    codebook.write_text(
        "app_package_name,application_label\n com.example.app , Example \ncom.example.app,Duplicate\n",
        encoding="utf-8",
    )
    unsupported = tmp_path / "codebook.txt"
    unsupported.write_text("app_package_name\ncom.example\n", encoding="utf-8")
    missing_package = tmp_path / "missing-package.csv"
    missing_package.write_text("application_label\nExample\n", encoding="utf-8")

    loaded = read_app_codebook(codebook)

    assert loaded is not None
    assert loaded.height == 1
    assert loaded.get_column("app_package_name").to_list() == ["com.example.app"]
    assert loaded.get_column("application_label").to_list() == ["Example"]
    assert read_app_codebook(tmp_path / "missing.csv") is None
    with pytest.raises(CodebookFileError, match="Unsupported codebook file type"):
        read_app_codebook(unsupported)
    with pytest.raises(CodebookFileError, match="app_package_name"):
        read_app_codebook(missing_package)


def test_app_codebook_reader_accepts_xlsx_and_wraps_parse_failures(tmp_path) -> None:
    codebook = tmp_path / "codebook.xlsx"
    broken = tmp_path / "broken.xlsx"
    _write_xlsx(codebook, ["app_package_name", "application_label"], [["com.example", "Example"]])
    broken.write_text("not really xlsx", encoding="utf-8")

    loaded = read_app_codebook(codebook)

    assert loaded is not None
    assert loaded.get_column("app_package_name").to_list() == ["com.example"]
    with pytest.raises(CodebookFileError, match="Failed to load app codebook"):
        read_app_codebook(broken)
