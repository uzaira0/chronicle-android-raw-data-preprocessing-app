from __future__ import annotations

import pytest

from chronicle_preprocessing_app.config.defaults import DEFAULT_APPS_FORCING_SCREEN_OPEN_FILE_PATH
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.utils.file_utils import (
    AppsForcingScreenOpenFileError,
    read_apps_forcing_screen_open_file,
)


def test_apps_forcing_screen_open_file_defaults_to_editable_external_file() -> None:
    options = PreprocessingOptions(raw_data_folder="", use_app_codebook=False)

    assert options.use_apps_forcing_screen_open_file is False
    assert str(options.apps_forcing_screen_open_file) == DEFAULT_APPS_FORCING_SCREEN_OPEN_FILE_PATH
    assert options.apps_forcing_screen_open_dict == {}


def test_read_apps_forcing_screen_open_file_accepts_package_and_optional_label(tmp_path) -> None:
    file_path = tmp_path / "apps_forcing_screen_open.csv"
    file_path.write_text(
        "\n".join(
            [
                "package_name,label_or_note",
                "com.google.android.youtube,Video",
                "com.google.android.apps.maps,Navigation",
                "# comment rows are ignored,Comment",
                ",Blank rows are ignored",
            ]
        ),
        encoding="utf-8",
    )

    apps_forcing_screen_open = read_apps_forcing_screen_open_file(file_path)

    assert apps_forcing_screen_open == {
        "com.google.android.youtube": "Video",
        "com.google.android.apps.maps": "Navigation",
    }


def test_read_apps_forcing_screen_open_file_allows_package_only_csv(tmp_path) -> None:
    file_path = tmp_path / "apps_forcing_screen_open.csv"
    file_path.write_text("package_name\ncom.netflix.mediaclient\n", encoding="utf-8")

    apps_forcing_screen_open = read_apps_forcing_screen_open_file(file_path)

    assert apps_forcing_screen_open == {"com.netflix.mediaclient": ""}


def test_read_apps_forcing_screen_open_file_rejects_unsupported_file_type(tmp_path) -> None:
    file_path = tmp_path / "apps_forcing_screen_open.txt"
    file_path.write_text("com.example.app\n", encoding="utf-8")

    with pytest.raises(AppsForcingScreenOpenFileError, match="Unsupported file type"):
        read_apps_forcing_screen_open_file(file_path)
