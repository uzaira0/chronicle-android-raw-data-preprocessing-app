"""Lightweight Polars-based validation helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import polars as pl

from chronicle_preprocessing_app.config.constants import Column as ColName
from chronicle_preprocessing_app.config.constants import InteractionType


def _as_polars_dataframe(df: Any) -> pl.DataFrame:
    if isinstance(df, pl.DataFrame):
        return df
    if isinstance(df, pl.LazyFrame):
        return df.collect()
    msg = f"Expected a Polars DataFrame, got {type(df)}"
    raise TypeError(msg)


@dataclass(frozen=True)
class FrameSchema:
    """Minimal schema wrapper preserving the old public validate() shape."""

    required_columns: tuple[str, ...]
    allowed_interactions: frozenset[str] | None = None
    non_negative_columns: tuple[str, ...] = ()

    def validate(self, df: Any) -> pl.DataFrame:
        frame = _as_polars_dataframe(df)

        missing = [column for column in self.required_columns if column not in frame.columns]
        if missing:
            msg = f"Missing required columns: {', '.join(missing)}"
            raise ValueError(msg)

        if self.allowed_interactions is not None and ColName.INTERACTION_TYPE in frame.columns:
            invalid = frame.filter(~pl.col(ColName.INTERACTION_TYPE).is_in(self.allowed_interactions))
            if not invalid.is_empty():
                values = invalid.get_column(ColName.INTERACTION_TYPE).unique().to_list()
                msg = f"Invalid interaction_type values: {values}"
                raise ValueError(msg)

        for column in self.non_negative_columns:
            if column not in frame.columns:
                continue
            invalid = frame.filter(pl.col(column).is_not_null() & (pl.col(column).cast(pl.Float64) < 0))
            if not invalid.is_empty():
                msg = f"Column {column!r} cannot contain negative values"
                raise ValueError(msg)

        return frame


RawChronicleDataSchema = FrameSchema(
    required_columns=(
        ColName.PARTICIPANT_ID,
        ColName.EVENT_TIMESTAMP,
        ColName.INTERACTION_TYPE,
    )
)

PreprocessedChronicleDataSchema = FrameSchema(
    required_columns=(
        ColName.PARTICIPANT_ID,
        ColName.INTERACTION_TYPE,
        ColName.EVENT_TIMESTAMP,
    ),
    allowed_interactions=frozenset(str(value) for value in InteractionType),
    non_negative_columns=(
        ColName.DURATION_SECONDS,
        ColName.DURATION_MINUTES,
        ColName.DATA_TIME_GAP_HOURS,
    ),
)

AppUsageRowSchema = FrameSchema(
    required_columns=(
        ColName.INTERACTION_TYPE,
        ColName.START_TIMESTAMP,
        ColName.APP_PACKAGE_NAME,
    ),
    allowed_interactions=frozenset(
        {
            str(InteractionType.APP_USAGE),
            str(InteractionType.FILTERED_APP_USAGE),
            str(InteractionType.FILTERED_APP_BACKGROUND_USAGE),
            str(InteractionType.NON_TARGET_CHILD_APP_USAGE),
        }
    ),
    non_negative_columns=(ColName.DURATION_SECONDS,),
)

ComplianceDataSchema = FrameSchema(
    required_columns=("participant_id", "device_sharing_status", "compliance"),
)


def validate_raw_data(df: Any) -> bool:
    RawChronicleDataSchema.validate(df)
    return True


def validate_preprocessed_data(df: Any) -> bool:
    PreprocessedChronicleDataSchema.validate(df)
    return True


def validate_app_usage_rows(df: Any) -> bool:
    AppUsageRowSchema.validate(df)
    return True
