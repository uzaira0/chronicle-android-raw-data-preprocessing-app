"""The web default filter (CSV) and the desktop default filter (XLSX) must
carry the same app filter set, or the two engines silently filter different
apps and drift out of parity.

The web PWA ships `web/src/assets/defaults/..._apps_to_filter.csv`; the desktop
engine ships `apps_to_filter_files/..._apps_to_filter.xlsx`. Both are consumed
through the same `read_filter_file` parser, so the parse itself is not what we
guard here — we guard that the two source files, maintained separately, still
agree. `read_filter_file` returns {package_name: app_label}; equality of that
dict is exactly the parity-relevant invariant (which packages get filtered, and
under which canonical label).
"""

from __future__ import annotations

from pathlib import Path

from chronicle_preprocessing_app.utils.file_utils import read_filter_file

REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_CSV = (
    REPO_ROOT
    / "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"
)
DESKTOP_XLSX = (
    REPO_ROOT
    / "apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
)


def test_web_and_desktop_default_filter_files_exist() -> None:
    assert WEB_CSV.exists(), f"missing web default filter CSV: {WEB_CSV}"
    assert DESKTOP_XLSX.exists(), f"missing desktop default filter XLSX: {DESKTOP_XLSX}"


def test_web_and_desktop_filter_package_sets_are_equal() -> None:
    web = read_filter_file(WEB_CSV)
    desktop = read_filter_file(DESKTOP_XLSX)

    only_web = set(web) - set(desktop)
    only_desktop = set(desktop) - set(web)
    assert not only_web, f"packages only in the web CSV filter: {sorted(only_web)}"
    assert not only_desktop, f"packages only in the desktop XLSX filter: {sorted(only_desktop)}"


def test_web_and_desktop_filter_dicts_are_identical() -> None:
    web = read_filter_file(WEB_CSV)
    desktop = read_filter_file(DESKTOP_XLSX)

    label_diffs = {
        pkg: (web.get(pkg), desktop.get(pkg))
        for pkg in set(web) | set(desktop)
        if web.get(pkg) != desktop.get(pkg)
    }
    assert not label_diffs, f"filter label mismatches (pkg: web vs desktop): {label_diffs}"
