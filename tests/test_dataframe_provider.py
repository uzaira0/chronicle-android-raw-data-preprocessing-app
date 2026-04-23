from __future__ import annotations

import importlib
import sys

import pytest

pl = pytest.importorskip("polars")
polars_testing = pytest.importorskip("polars.testing")
assert_frame_equal = polars_testing.assert_frame_equal

from chronicle_preprocessing_app.core import dataframe_provider
from chronicle_preprocessing_app.core.dataframe_provider import PolarsProvider


def test_get_dataframe_provider_honors_environment_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHRONICLE_USE_POLARS", "true")
    assert dataframe_provider.get_dataframe_provider().name == "polars"

    monkeypatch.setenv("CHRONICLE_USE_POLARS", "false")
    assert dataframe_provider.get_dataframe_provider().name == "pandas"


def test_polars_provider_read_csv_strips_headers_and_applies_schema_overrides(tmp_path) -> None:
    provider = PolarsProvider()
    csv_path = tmp_path / "input.csv"
    csv_path.write_text(
        "name, age,flag,score\n"
        " Alice, 1,true, 3.5\n"
        "Bob,2,false,4.25\n",
        encoding="utf-8",
    )

    df = provider.read_csv(
        csv_path,
        dtypes={"age": "int64", "flag": "bool", "score": "float64"},
    )

    assert df.columns == ["name", "age", "flag", "score"]
    assert df.schema["name"] == pl.Utf8
    assert df.schema["age"] == pl.Int64
    assert df.schema["flag"] == pl.Boolean
    assert df.schema["score"] == pl.Float64
    assert df["name"].to_list() == ["Alice", "Bob"]
    assert df["age"].to_list() == [1, 2]
    assert df["flag"].to_list() == [True, False]
    assert df["score"].to_list() == [3.5, 4.25]


def test_polars_provider_to_csv_round_trips_without_index(tmp_path) -> None:
    provider = PolarsProvider()
    original = pl.DataFrame({"name": ["Alice", "Bob"], "age": [1, 2]})
    csv_path = tmp_path / "output.csv"

    provider.to_csv(original, csv_path)
    round_tripped = provider.read_csv(csv_path, dtypes={"age": "int64"})

    assert_frame_equal(round_tripped, original)


def test_provider_module_can_load_without_pandas(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    original_pandas = sys.modules.get("pandas")
    monkeypatch.setitem(sys.modules, "pandas", None)

    reloaded = importlib.reload(dataframe_provider)

    assert reloaded.pd is None
    provider = reloaded.get_dataframe_provider()
    assert provider.name == "polars"

    csv_path = tmp_path / "input.csv"
    csv_path.write_text("value\n1\n2\n", encoding="utf-8")

    df = provider.read_csv(csv_path, dtypes={"value": "int64"})
    assert df["value"].to_list() == [1, 2]

    if original_pandas is None:
        monkeypatch.delitem(sys.modules, "pandas", raising=False)
    else:
        monkeypatch.setitem(sys.modules, "pandas", original_pandas)

    importlib.reload(reloaded)
