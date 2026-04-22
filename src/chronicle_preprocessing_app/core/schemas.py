"""
Pandera DataFrame schemas for Chronicle Android data validation.

This module defines schemas for validating DataFrames at various stages
of the preprocessing pipeline. Schemas enforce data types, constraints,
and business rules to catch data quality issues early.
"""

from __future__ import annotations

from typing import Any

import pandera.pandas as pa
from chronicle_preprocessing_app.config.constants import Column as ColName
from chronicle_preprocessing_app.config.constants import InteractionType
from pandera.pandas import Check, Column, DataFrameSchema

# =============================================================================
# Raw Data Schema - validates input Chronicle CSV data
# =============================================================================

RawChronicleDataSchema = DataFrameSchema(
    columns={
        ColName.PARTICIPANT_ID: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Participant identifier from Chronicle",
        ),
        ColName.EVENT_TIMESTAMP: Column(
            pa.String,
            nullable=False,
            description="Event timestamp string in ISO8601 format with timezone",
        ),
        ColName.INTERACTION_TYPE: Column(
            pa.String,
            nullable=False,
            description="Type of interaction event",
        ),
        ColName.APP_PACKAGE_NAME: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Android package name of the app",
        ),
        ColName.APPLICATION_LABEL: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Human-readable app name",
        ),
        ColName.USERNAME: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Username associated with the event",
        ),
        ColName.TIMEZONE: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Timezone offset string (e.g., '-06:00')",
        ),
    },
    strict=False,  # Allow additional columns
    coerce=True,
    description="Schema for raw Chronicle Android CSV data",
)


# =============================================================================
# Preprocessed Data Schema - validates output after preprocessing
# =============================================================================


def _valid_interaction_types() -> list[str]:
    """Return list of valid interaction type values."""
    return [e.value for e in InteractionType]


PreprocessedChronicleDataSchema = DataFrameSchema(
    columns={
        ColName.PARTICIPANT_ID: Column(
            pa.String,
            nullable=False,
            coerce=True,
            description="Participant identifier",
        ),
        ColName.POSSIBLE_DEVICE_MODEL: Column(
            pa.String,
            nullable=False,
            description="Detected device type (Android or Amazon Fire)",
        ),
        ColName.USERNAME: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Username (Target Child or other)",
        ),
        ColName.EVENT_TIMESTAMP: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Original event timestamp",
        ),
        ColName.DATE: Column(
            nullable=True,
            description="Date extracted from timestamp",
        ),
        ColName.TIMEZONE: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Timezone of the event",
        ),
        ColName.APP_PACKAGE_NAME: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Android package name",
        ),
        ColName.APPLICATION_LABEL: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Human-readable app name",
        ),
        ColName.BROAD_APP_CATEGORY: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="App category from codebook",
        ),
        ColName.GENRE_ID_SCRAPED: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Genre ID from app store",
        ),
        ColName.INTERACTION_TYPE: Column(
            pa.String,
            nullable=False,
            checks=[
                Check.isin(_valid_interaction_types()),
            ],
            description="Standardized interaction type",
        ),
        ColName.START_TIMESTAMP: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="App usage start timestamp",
        ),
        ColName.STOP_TIMESTAMP: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="App usage stop timestamp",
        ),
        ColName.DURATION_SECONDS: Column(
            pa.Float,
            nullable=True,
            coerce=True,
            checks=[
                Check.ge(0, error="Duration cannot be negative"),
            ],
            description="Usage duration in seconds",
        ),
        ColName.DURATION_MINUTES: Column(
            pa.Float,
            nullable=True,
            coerce=True,
            checks=[
                Check.ge(0, error="Duration cannot be negative"),
            ],
            description="Usage duration in minutes",
        ),
        ColName.DATA_TIME_GAP_HOURS: Column(
            pa.Float,
            nullable=True,
            coerce=True,
            checks=[
                Check.ge(0, error="Time gap cannot be negative"),
            ],
            description="Hours since previous event",
        ),
        ColName.DAY: Column(
            pa.Int,
            nullable=True,
            coerce=True,
            checks=[
                Check.in_range(1, 31),
            ],
            description="Day of month",
        ),
        ColName.HOUR: Column(
            pa.Int,
            nullable=True,
            coerce=True,
            checks=[
                Check.in_range(0, 23),
            ],
            description="Hour of day (0-23)",
        ),
        ColName.QUARTER: Column(
            pa.Int,
            nullable=True,
            coerce=True,
            checks=[
                Check.in_range(0, 3),
            ],
            description="Quarter of hour (0-3)",
        ),
        ColName.WEEKDAY_MF: Column(
            pa.Int,
            nullable=True,
            coerce=True,
            checks=[
                Check.isin([0, 1]),
            ],
            description="1 if Mon-Fri, 0 if weekend",
        ),
        ColName.WEEKDAY_MTH: Column(
            pa.Int,
            nullable=True,
            coerce=True,
            checks=[
                Check.isin([0, 1]),
            ],
            description="1 if Mon-Thu, 0 otherwise",
        ),
        ColName.WEEKDAY_SUTH: Column(
            pa.Int,
            nullable=True,
            coerce=True,
            checks=[
                Check.isin([0, 1]),
            ],
            description="1 if Sun-Thu, 0 otherwise",
        ),
        ColName.PREPROCESSOR_VERSION: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="Version of preprocessor used",
        ),
        ColName.DATETIME_OF_PREPROCESSING: Column(
            pa.String,
            nullable=True,
            coerce=True,
            description="When preprocessing occurred",
        ),
    },
    strict=False,  # Allow additional columns (engagement flags, etc.)
    coerce=True,
    description="Schema for preprocessed Chronicle Android data",
)


# =============================================================================
# App Usage Schema - validates app usage rows specifically
# =============================================================================

AppUsageRowSchema = DataFrameSchema(
    columns={
        ColName.INTERACTION_TYPE: Column(
            pa.String,
            nullable=False,
            checks=[
                Check.isin(
                    [
                        InteractionType.APP_USAGE.value,
                        InteractionType.FILTERED_APP_USAGE.value,
                        InteractionType.NON_TARGET_CHILD_APP_USAGE.value,
                    ]
                ),
            ],
            description="Must be an app usage interaction type",
        ),
        ColName.START_TIMESTAMP: Column(
            nullable=False,
            description="App usage must have start timestamp",
        ),
        ColName.STOP_TIMESTAMP: Column(
            nullable=True,  # Can be missing for END_OF_USAGE_MISSING
            description="App usage stop timestamp",
        ),
        ColName.DURATION_SECONDS: Column(
            pa.Float,
            nullable=True,
            coerce=True,
            checks=[
                Check.ge(0, error="Duration cannot be negative"),
            ],
            description="Usage duration in seconds",
        ),
        ColName.APP_PACKAGE_NAME: Column(
            pa.String,
            nullable=False,
            description="App package name is required for app usage",
        ),
    },
    strict=False,
    coerce=True,
    description="Schema for app usage rows",
)


# =============================================================================
# Compliance Data Schema - validates compliance calculation output
# =============================================================================

ComplianceDataSchema = DataFrameSchema(
    columns={
        "participant_id": Column(
            pa.String,
            nullable=False,
            description="Participant identifier",
        ),
        "device_sharing_status": Column(
            pa.String,
            nullable=True,
            checks=[
                Check.isin(["Shared", "Non-Shared"]),
            ],
            description="Device sharing status",
        ),
        "compliance": Column(
            pa.Float,
            nullable=True,
            coerce=True,
            checks=[
                Check.in_range(0, 100, include_min=True, include_max=True),
            ],
            description="Compliance percentage (0-100)",
        ),
    },
    strict=False,
    coerce=True,
    description="Schema for compliance calculation results",
)


# =============================================================================
# Validation helper functions
# =============================================================================


def validate_raw_data(df: Any) -> bool:
    """
    Validate raw Chronicle data against schema.

    Args:
        df: DataFrame to validate (Pandas or Polars)

    Returns:
        True if validation passes

    Raises:
        pa.errors.SchemaError: If validation fails
    """
    import pandas as pd

    # Convert to Pandas if needed
    if not isinstance(df, pd.DataFrame):
        try:
            df = df.to_pandas()
        except AttributeError:
            raise TypeError(f"Expected DataFrame, got {type(df)}")

    RawChronicleDataSchema.validate(df)
    return True


def validate_preprocessed_data(df: Any) -> bool:
    """
    Validate preprocessed Chronicle data against schema.

    Args:
        df: DataFrame to validate (Pandas or Polars)

    Returns:
        True if validation passes

    Raises:
        pa.errors.SchemaError: If validation fails
    """
    import pandas as pd

    # Convert to Pandas if needed
    if not isinstance(df, pd.DataFrame):
        try:
            df = df.to_pandas()
        except AttributeError:
            raise TypeError(f"Expected DataFrame, got {type(df)}")

    PreprocessedChronicleDataSchema.validate(df)
    return True


def validate_app_usage_rows(df: Any) -> bool:
    """
    Validate that app usage rows meet schema requirements.

    Args:
        df: DataFrame containing only app usage rows

    Returns:
        True if validation passes

    Raises:
        pa.errors.SchemaError: If validation fails
    """
    import pandas as pd

    # Convert to Pandas if needed
    if not isinstance(df, pd.DataFrame):
        try:
            df = df.to_pandas()
        except AttributeError:
            raise TypeError(f"Expected DataFrame, got {type(df)}")

    AppUsageRowSchema.validate(df)
    return True
