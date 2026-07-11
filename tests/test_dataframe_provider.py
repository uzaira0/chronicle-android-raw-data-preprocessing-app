import pytest

pl = pytest.importorskip("polars")
polars_testing = pytest.importorskip("polars.testing")
assert_frame_equal = polars_testing.assert_frame_equal

from chronicle_preprocessing_app.core import dataframe_provider  # noqa: E402
from chronicle_preprocessing_app.core.dataframe_provider import (  # noqa: E402
    PolarsProvider,
    _normalize_schema,
    _strip_string_columns,
    read_csv_rows,
)


def test_get_dataframe_provider_returns_polars_provider() -> None:
    assert dataframe_provider.get_dataframe_provider().name == "polars"


def test_polars_provider_read_csv_strips_headers_and_applies_schema_overrides(tmp_path) -> None:
    provider = PolarsProvider()
    csv_path = tmp_path / "input.csv"
    csv_path.write_text(
        "name, age,flag,score\n Alice, 1,true, 3.5\nBob,2,false,4.25\n",
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


def test_polars_provider_operations_cover_dataframe_protocol(tmp_path) -> None:
    provider = PolarsProvider()
    df = pl.DataFrame({"name": ["Alice", "Bob"], "age": [1, 2]})

    assert provider.is_empty(pl.DataFrame()) is True
    assert provider.get_column(df, "name").to_list() == ["Alice", "Bob"]

    updated = provider.set_column(df, "age", [3, 4])
    filtered = provider.filter(updated, updated.get_column("age") > 3)
    sorted_df = provider.sort_by(updated, "age", descending=True)
    indexed_path = tmp_path / "indexed.csv"

    provider.to_csv(updated, indexed_path, index=True)
    indexed = provider.read_csv(indexed_path, dtypes={"index": "int", "age": "int"})

    assert filtered.get_column("name").to_list() == ["Bob"]
    assert sorted_df.get_column("age").to_list() == [4, 3]
    assert provider.reset_index(updated).equals(updated)
    assert indexed.columns == ["index", "name", "age"]
    assert indexed.get_column("index").to_list() == [0, 1]


def test_polars_provider_read_csv_preserves_non_strings_when_not_stripping(tmp_path) -> None:
    provider = PolarsProvider()
    csv_path = tmp_path / "numbers.csv"
    csv_path.write_text("value\n1\n2\n", encoding="utf-8")

    df = provider.read_csv(csv_path, skipinitialspace=False)

    assert df.schema["value"] == pl.Int64
    assert df.get_column("value").to_list() == [1, 2]


def test_polars_provider_private_helpers_handle_polars_dtypes_and_numeric_frames() -> None:
    numeric = pl.DataFrame({"value": [1, 2]})

    assert _strip_string_columns(numeric).equals(numeric)
    assert _normalize_schema(None) is None
    assert _normalize_schema({"value": pl.Int64()}) == {"value": pl.Int64}


def test_polars_provider_schema_overrides_reject_unknown_dtype(tmp_path) -> None:
    provider = PolarsProvider()
    csv_path = tmp_path / "input.csv"
    csv_path.write_text("name\nAlice\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Unsupported schema override"):
        provider.read_csv(csv_path, dtypes={"name": "uuid"})


def test_polars_provider_concat_and_csv_dict_reader(tmp_path) -> None:
    provider = PolarsProvider()
    left = pl.DataFrame({"name": ["Alice"], "score": [1]})
    right = pl.DataFrame({"name": ["Bob"], "score": [2]})
    csv_path = tmp_path / "rows.csv"
    csv_path.write_text("name,score\nAlice,1\nBob,2\n", encoding="utf-8")

    assert provider.concat([]).is_empty()
    assert provider.concat([left, right]).get_column("name").to_list() == ["Alice", "Bob"]
    assert provider.concat(
        [left, pl.DataFrame({"name": ["Cara"], "flag": [True]})], ignore_index=False
    ).columns == [
        "name",
        "score",
        "flag",
    ]
    assert read_csv_rows(csv_path) == [
        {"name": "Alice", "score": "1"},
        {"name": "Bob", "score": "2"},
    ]
