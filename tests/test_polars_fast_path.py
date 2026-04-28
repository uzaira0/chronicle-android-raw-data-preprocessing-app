from __future__ import annotations

from pathlib import Path

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.config.defaults import DEFAULT_APP_CODEBOOK_FILE_PATH
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.config.constants import GAP_TIMESTAMPS_SIDECAR_SUFFIX
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


def test_codebook_genre_output_consolidates_only_when_sources_agree(
    tmp_path, monkeypatch
) -> None:
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
