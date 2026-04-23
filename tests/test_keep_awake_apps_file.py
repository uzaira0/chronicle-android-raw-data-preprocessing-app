from __future__ import annotations

import pytest

from chronicle_preprocessing_app.config.defaults import DEFAULT_KEEP_AWAKE_APPS_FILE_PATH
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.utils.file_utils import (
    KeepAwakeAppsFileError,
    read_keep_awake_apps_file,
)


def test_keep_awake_apps_file_defaults_to_editable_external_file() -> None:
    options = PreprocessingOptions(raw_data_folder="", use_app_codebook=False)

    assert options.use_keep_awake_apps_file is False
    assert str(options.keep_awake_apps_file) == DEFAULT_KEEP_AWAKE_APPS_FILE_PATH
    assert options.keep_awake_apps_dict == {}


def test_read_keep_awake_apps_file_accepts_package_and_optional_label(tmp_path) -> None:
    file_path = tmp_path / "keep_awake_apps.csv"
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

    keep_awake_apps = read_keep_awake_apps_file(file_path)

    assert keep_awake_apps == {
        "com.google.android.youtube": "Video",
        "com.google.android.apps.maps": "Navigation",
    }


def test_read_keep_awake_apps_file_allows_package_only_csv(tmp_path) -> None:
    file_path = tmp_path / "keep_awake_apps.csv"
    file_path.write_text("package_name\ncom.netflix.mediaclient\n", encoding="utf-8")

    keep_awake_apps = read_keep_awake_apps_file(file_path)

    assert keep_awake_apps == {"com.netflix.mediaclient": ""}


def test_read_keep_awake_apps_file_rejects_unsupported_file_type(tmp_path) -> None:
    file_path = tmp_path / "keep_awake_apps.txt"
    file_path.write_text("com.example.app\n", encoding="utf-8")

    with pytest.raises(KeepAwakeAppsFileError, match="Unsupported file type"):
        read_keep_awake_apps_file(file_path)
