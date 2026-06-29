from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import polars as pl

from chronicle_preprocessing_app.config.constants import (
    GAP_TIMESTAMPS_SIDECAR_SUFFIX,
    Column,
    InteractionType,
)
from chronicle_preprocessing_app.config.defaults import DEFAULT_APP_CODEBOOK_FILE_PATH
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.plotting.plotting_manager import PlottingManager
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)


def _raw_fixture() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _placeholder_fixture() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-08T09:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.DEVICE_SHUTDOWN),
                Column.APP_PACKAGE_NAME: "android",
                Column.APPLICATION_LABEL: "Device shutdown",
                Column.USERNAME: "System",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _codebook_fixture() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.google.android.youtube",
                Column.APPLICATION_LABEL: "YouTube",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.google.android.youtube",
                Column.APPLICATION_LABEL: "YouTube",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _genre_consensus_fixture() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.consensus",
                Column.APPLICATION_LABEL: "Consensus App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.consensus",
                Column.APPLICATION_LABEL: "Consensus App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T11:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.disagree",
                Column.APPLICATION_LABEL: "Disagree App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T11:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.disagree",
                Column.APPLICATION_LABEL: "Disagree App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def test_default_codebook_path_points_to_unified_codebook() -> None:
    default_path = Path(DEFAULT_APP_CODEBOOK_FILE_PATH)
    assert default_path.exists()
    assert default_path.name == "unified_app_codebook.csv"


def test_main_preprocessor_fast_path_matches_non_fast_path_output_without_codebook(
    tmp_path, monkeypatch
) -> None:
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = raw_folder / "Raw P01.csv"
    _raw_fixture().write_csv(raw_file)

    options = PreprocessingOptions(
        study_name="Smoke",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
    )

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")
    legacy = ChronicleAndroidRawDataPreprocessor(options)
    legacy_folder, legacy_success, _ = legacy.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert legacy_success

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")
    fast = ChronicleAndroidRawDataPreprocessor(options)
    fast_folder, fast_success, _ = fast.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert fast_success

    legacy_csv = next(legacy_folder.glob("*.csv"))
    fast_csv = next(fast_folder.glob("*.csv"))
    legacy_df = pl.read_csv(legacy_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )
    fast_df = pl.read_csv(fast_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )

    assert legacy_df.equals(fast_df)


def test_main_preprocessor_missing_timezone_column_uses_utc_fallback_in_both_paths(
    tmp_path: Path, monkeypatch
) -> None:
    legacy_raw_folder = tmp_path / "legacy" / "raw"
    fast_raw_folder = tmp_path / "fast" / "raw"
    legacy_raw_folder.mkdir(parents=True)
    fast_raw_folder.mkdir(parents=True)
    legacy_raw_file = legacy_raw_folder / "Raw P01.csv"
    fast_raw_file = fast_raw_folder / "Raw P01.csv"
    raw_df = _raw_fixture().drop(Column.TIMEZONE)
    raw_df.write_csv(legacy_raw_file)
    raw_df.write_csv(fast_raw_file)

    common_options = {
        "study_name": "MissingTimezone",
        "use_app_codebook": False,
        "use_filter_file": False,
    }

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")
    legacy = ChronicleAndroidRawDataPreprocessor(
        PreprocessingOptions(raw_data_folder=legacy_raw_folder, **common_options)
    )
    legacy_folder, legacy_success, _ = legacy.preprocess_Chronicle_Android_raw_data_file(
        legacy_raw_file
    )
    assert legacy_success

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")
    fast = ChronicleAndroidRawDataPreprocessor(
        PreprocessingOptions(raw_data_folder=fast_raw_folder, **common_options)
    )
    fast_folder, fast_success, _ = fast.preprocess_Chronicle_Android_raw_data_file(fast_raw_file)
    assert fast_success

    legacy_df = pl.read_csv(next(legacy_folder.glob("*.csv")), infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )
    fast_df = pl.read_csv(next(fast_folder.glob("*.csv")), infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )

    assert legacy_df.equals(fast_df)
    assert legacy_df.get_column(Column.TIMEZONE).to_list() == ["UTC"]


def test_main_preprocessor_applies_injected_study_date_map_before_app_usage(
    tmp_path: Path, monkeypatch
) -> None:
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = raw_folder / "Raw P01.csv"
    pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-06T10:00:00Z",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.outside.window",
                Column.APPLICATION_LABEL: "Outside",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "UTC",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-06T10:05:00Z",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.outside.window",
                Column.APPLICATION_LABEL: "Outside",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "UTC",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00Z",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.inside.window",
                Column.APPLICATION_LABEL: "Inside",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "UTC",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00Z",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.inside.window",
                Column.APPLICATION_LABEL: "Inside",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "UTC",
            },
        ]
    ).write_csv(raw_file)

    options = PreprocessingOptions(
        study_name="StudyWindow",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        study_date_map={
            "P01": (
                datetime(2026, 3, 7, tzinfo=UTC),
                datetime(2026, 3, 7, tzinfo=UTC),
            )
        },
    )

    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_file)

    assert success
    output_df = pl.read_csv(next(output_folder.glob("*.csv")), infer_schema=False)
    app_usage_rows = output_df.filter(
        pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE)
    )
    assert app_usage_rows.get_column(Column.APP_PACKAGE_NAME).to_list() == [
        "com.outside.window",
        "com.inside.window",
    ]
    assert "com.outside.window" in output_df.get_column(Column.APP_PACKAGE_NAME).to_list()


def test_main_preprocessor_fast_path_matches_non_fast_path_output_with_default_codebook(
    tmp_path, monkeypatch
) -> None:
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = raw_folder / "Raw P01.csv"
    _codebook_fixture().write_csv(raw_file)

    options = PreprocessingOptions(
        study_name="Smoke",
        raw_data_folder=raw_folder,
        use_app_codebook=True,
        app_codebook_path=DEFAULT_APP_CODEBOOK_FILE_PATH,
        use_filter_file=False,
    )

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")
    legacy = ChronicleAndroidRawDataPreprocessor(options)
    legacy_folder, legacy_success, _ = legacy.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert legacy_success

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")
    fast = ChronicleAndroidRawDataPreprocessor(options)
    fast_folder, fast_success, _ = fast.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert fast_success

    legacy_csv = next(legacy_folder.glob("*.csv"))
    fast_csv = next(fast_folder.glob("*.csv"))
    legacy_df = pl.read_csv(legacy_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )
    fast_df = pl.read_csv(fast_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )

    assert legacy_df.equals(fast_df)
    assert Column.BROAD_APP_CATEGORY not in legacy_df.columns
    assert legacy_df.get_column(Column.GENRE_ID_SCRAPED).to_list() == ["VIDEO_PLAYERS"]
    assert legacy_df.get_column(Column.PLAY_STORE_GENRE_ID).to_list() == [None]
    assert legacy_df.get_column(Column.USC_GENRE_ID).to_list() == [None]
    assert legacy_df.get_column(Column.BABYEMU_GENRE_ID_SCRAPED).to_list() == [None]
    assert legacy_df.get_column(Column.PLAY_STORE_BROAD_APP_CATEGORY).to_list() == [
        "Video Players (e.g. YouTube)"
    ]
    assert legacy_df.get_column(Column.BABYEMU_BROAD_APP_CATEGORY).to_list() == ["VIDEO"]
    assert legacy_df.get_column(Column.CODEBOOK_DATASET).to_list() == [
        "USC Armstrong Lab, UMich MITTen/GDW, UW-Madison Baby EMU, BCM CNRC DAC"
    ]


def test_codebook_genre_output_consolidates_only_when_sources_agree(tmp_path, monkeypatch) -> None:
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = raw_folder / "Raw P01.csv"
    _genre_consensus_fixture().write_csv(raw_file)

    codebook_path = tmp_path / "app_codebook.csv"
    pl.DataFrame(
        [
            {
                "app_package_name": "com.example.consensus",
                "application_label": "Consensus App",
                "play_store_genreId": "EDUCATION",
                "usc_genreId": "EDUCATION",
                "babyemu_genreId_scraped": "EDUCATION",
                "babyemu_genreId_manual": None,
            },
            {
                "app_package_name": "com.example.disagree",
                "application_label": "Disagree App",
                "play_store_genreId": "NEWS_AND_MAGAZINES",
                "usc_genreId": "SOCIAL",
                "babyemu_genreId_scraped": "SOCIAL",
                "babyemu_genreId_manual": None,
            },
        ]
    ).write_csv(codebook_path)

    options = PreprocessingOptions(
        study_name="Smoke",
        raw_data_folder=raw_folder,
        use_app_codebook=True,
        app_codebook_path=codebook_path,
        use_filter_file=False,
    )

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")
    legacy = ChronicleAndroidRawDataPreprocessor(options)
    legacy_folder, legacy_success, _ = legacy.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert legacy_success

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")
    fast = ChronicleAndroidRawDataPreprocessor(options)
    fast_folder, fast_success, _ = fast.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert fast_success

    legacy_csv = next(legacy_folder.glob("*.csv"))
    fast_csv = next(fast_folder.glob("*.csv"))
    legacy_df = pl.read_csv(legacy_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )
    fast_df = pl.read_csv(fast_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )

    assert legacy_df.equals(fast_df)

    app_usage_rows = legacy_df.filter(
        pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE)
    ).sort(Column.APP_PACKAGE_NAME)
    consensus_row = app_usage_rows.row(0, named=True)
    disagree_row = app_usage_rows.row(1, named=True)

    assert consensus_row[Column.APP_PACKAGE_NAME] == "com.example.consensus"
    assert consensus_row[Column.GENRE_ID_SCRAPED] == "EDUCATION"
    assert consensus_row[Column.PLAY_STORE_GENRE_ID] is None
    assert consensus_row[Column.USC_GENRE_ID] is None
    assert consensus_row[Column.BABYEMU_GENRE_ID_SCRAPED] is None

    assert disagree_row[Column.APP_PACKAGE_NAME] == "com.example.disagree"
    assert disagree_row[Column.GENRE_ID_SCRAPED] is None
    assert disagree_row[Column.PLAY_STORE_GENRE_ID] == "NEWS_AND_MAGAZINES"
    assert disagree_row[Column.USC_GENRE_ID] == "SOCIAL"
    assert disagree_row[Column.BABYEMU_GENRE_ID_SCRAPED] == "SOCIAL"


def test_fast_path_pre_algo_timestamps_include_all_raw_event_types(tmp_path: Path) -> None:
    raw_file = tmp_path / "Raw P01.csv"
    _raw_fixture().write_csv(raw_file)

    result = PolarsFastPathPreprocessor(PreprocessingOptions()).preprocess_raw_data_file(raw_file)

    assert result.pre_algo_event_timestamps is not None
    # Fixture has 2 raw rows (ACTIVITY_RESUMED + ACTIVITY_PAUSED). The algorithm
    # collapses them into one APP_USAGE session, so the pre-algo capture must be larger.
    assert len(result.pre_algo_event_timestamps) == 2
    app_usage_rows = result.data.filter(
        pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE)
    )
    assert len(app_usage_rows) < len(result.pre_algo_event_timestamps)


def test_fast_path_save_writes_gap_sidecar(tmp_path: Path) -> None:
    raw_file = tmp_path / "Raw P01.csv"
    _raw_fixture().write_csv(raw_file)

    preprocessor = PolarsFastPathPreprocessor(PreprocessingOptions())
    result = preprocessor.preprocess_raw_data_file(raw_file)
    out_folder = preprocessor.save_preprocessed_output(
        result.data,
        raw_data_filename=raw_file.name,
        output_folder=tmp_path,
        study_name="test",
        pre_algo_event_timestamps=result.pre_algo_event_timestamps,
    )

    sidecars = list(out_folder.glob(f"*{GAP_TIMESTAMPS_SIDECAR_SUFFIX}"))
    assert len(sidecars) == 1
    loaded = pl.read_parquet(sidecars[0])
    assert Column.EVENT_TIMESTAMP in loaded.columns
    assert len(loaded) == 2


def test_fast_path_save_no_sidecar_when_timestamps_absent(tmp_path: Path) -> None:
    raw_file = tmp_path / "Raw P01.csv"
    _raw_fixture().write_csv(raw_file)

    preprocessor = PolarsFastPathPreprocessor(PreprocessingOptions())
    result = preprocessor.preprocess_raw_data_file(raw_file)
    out_folder = preprocessor.save_preprocessed_output(
        result.data,
        raw_data_filename=raw_file.name,
        output_folder=tmp_path,
        study_name="test",
        pre_algo_event_timestamps=None,
    )

    assert not list(out_folder.glob(f"*{GAP_TIMESTAMPS_SIDECAR_SUFFIX}"))


def test_fast_path_adds_placeholders_for_days_with_raw_data_no_usage(tmp_path: Path) -> None:
    raw_file = tmp_path / "Raw P01.csv"
    _placeholder_fixture().write_csv(raw_file)

    options = PreprocessingOptions(
        study_name="test",
        study_date_map={
            "P01": (datetime(2026, 3, 7), datetime(2026, 3, 10)),
        },
    )

    preprocessor = PolarsFastPathPreprocessor(options)
    result = preprocessor.preprocess_raw_data_file(raw_file)

    app_usage = result.data.filter(
        pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE)
    )
    placeholder = app_usage.filter(pl.col(Column.APP_PACKAGE_NAME) == "com.placeholder.noactivity")

    placeholder_dates = placeholder.get_column(Column.DATE).to_list()
    assert len(placeholder) == 1
    assert date(2026, 3, 8) in placeholder_dates
    assert placeholder.get_column(Column.DURATION_SECONDS).to_list() == [0]
    assert placeholder.get_column(Column.DURATION_MINUTES).to_list() == [0.0]
    assert app_usage.filter(pl.col(Column.DATE) == date(2026, 3, 9)).is_empty()


def test_fast_path_does_not_add_placeholder_without_study_dates(tmp_path: Path) -> None:
    raw_file = tmp_path / "Raw P01.csv"
    _placeholder_fixture().write_csv(raw_file)

    preprocessor = PolarsFastPathPreprocessor(PreprocessingOptions())
    result = preprocessor.preprocess_raw_data_file(raw_file)

    placeholder = result.data.filter(
        (pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
        & (pl.col(Column.APP_PACKAGE_NAME) == "com.placeholder.noactivity")
    )
    assert placeholder.is_empty()


def test_plotting_manager_loads_gap_sidecar(tmp_path: Path) -> None:
    import datetime

    csv_path = tmp_path / "P01 Automatically Preprocessed.csv"
    csv_path.write_text("header\n")

    ts = pl.Series(
        Column.EVENT_TIMESTAMP,
        [datetime.datetime(2026, 3, 7, 10, 0, 0), datetime.datetime(2026, 3, 7, 10, 5, 0)],
        dtype=pl.Datetime,
    )
    sidecar_path = tmp_path / f"P01 Automatically Preprocessed{GAP_TIMESTAMPS_SIDECAR_SUFFIX}"
    pl.DataFrame({Column.EVENT_TIMESTAMP: ts}).write_parquet(sidecar_path)

    pm = PlottingManager("test", tmp_path / "dummy.csv", PreprocessingOptions())
    loaded = pm._load_gap_timestamps_sidecar(csv_path)

    assert loaded is not None
    assert Column.EVENT_TIMESTAMP in loaded.columns
    assert len(loaded) == 2


def test_plotting_manager_returns_none_when_no_sidecar(tmp_path: Path) -> None:
    csv_path = tmp_path / "P01 Automatically Preprocessed.csv"
    csv_path.write_text("header\n")

    pm = PlottingManager("test", tmp_path / "dummy.csv", PreprocessingOptions())
    assert pm._load_gap_timestamps_sidecar(csv_path) is None
