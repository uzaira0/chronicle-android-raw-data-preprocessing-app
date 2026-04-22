"""
Plotting manager to handle app usage visualization.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Callable

import matplotlib

# Polars support for faster CSV I/O
try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    POLARS_AVAILABLE = False
    pl = None

USE_POLARS = os.getenv("CHRONICLE_USE_POLARS", "true").lower() == "true" and POLARS_AVAILABLE

matplotlib.use("Agg")  # Use non-interactive backend to avoid threading warnings
import matplotlib.pyplot as plt
import pandas as pd
from chronicle_preprocessing_app.config.constants import (
    PLOTTED_FOLDER_SUFFIX,
    TARGET_CHILD_USERNAME,
    AppCodebookColumn,
    Column,
    InteractionType,
)
from matplotlib.patches import Patch
from chronicle_preprocessing_app.core.config import PreprocessingOptions, ProcessingStats
from chronicle_preprocessing_app.utils.file_utils import read_app_codebook

LOGGER = logging.getLogger(__name__)


class PlottingManager:
    """
    Class to manage the plotting of app usage data.
    This class provides functionality to generate daily app usage plots
    from preprocessed data files.
    """

    def __init__(
        self,
        study_name: str,
        output_folder: Path | str,
        options: PreprocessingOptions,
        progress_callback: Callable | None = None,
    ) -> None:
        self.study_name = study_name
        self.base_output_folder = Path(output_folder).parent
        self.plot_output_folder = (
            self.base_output_folder / f"{self.study_name + ' ' + PLOTTED_FOLDER_SUFFIX}"
        )
        self.progress_callback = progress_callback
        self.options = options
        self.stats = ProcessingStats()

        self.manual_category_to_color_map = {
            "Games": "#e6194b",
            "Video Players (e.g. YouTube)": "#4363d8",
            "Social & Communication": "#fabed4",
            "Entertainment": "#f58231",
            "Lifestyle": "#42d4f4",
            "Productivity & Business": "#aaffc3",
            "Health": "#469990",
            "Education": "#800000",
            "Travel & Local": "#9a6324",
            "News & Magazines": "#dcbeff",
            "Photography": "yellow",
            "Uncategorised": "#000000",
        }

        self.gap_color = "#808080"  # Gray

    def create_all_app_usage_plots(
        self, preprocessed_folder: Path, codebook_path: Path | str
    ) -> ProcessingStats:
        """
        Generate app usage plots for all preprocessed files.

        Args:
            preprocessed_folder: Path to folder containing preprocessed CSV files
            codebook_path: Optional path to app categorization codebook

        Returns:
            ProcessingStats: Statistics about the plotting operation
        """
        LOGGER.info(f"Generating app usage plots from {preprocessed_folder}")

        self.plot_output_folder.mkdir(parents=True, exist_ok=True)

        app_codebook = None
        if self.options.use_app_codebook and codebook_path:
            try:
                app_codebook = read_app_codebook(codebook_path)
            except ValueError as e:
                error_msg = f"Failed to load app codebook: {e}"
                raise Exception(error_msg) from e
        else:
            LOGGER.info(
                "App codebook not being used - either disabled in options or file not found"
            )

        date_str = datetime.today().strftime("%B %d, %Y")

        csv_files = list(preprocessed_folder.glob("*.csv"))
        LOGGER.info(f"Found {len(csv_files)} preprocessed files to plot")

        self.stats.total_files = len(csv_files)

        plot_errors = []

        for i, csv_file in enumerate(csv_files):
            try:
                if self.progress_callback:
                    progress_msg = f"Plotting file {i + 1} of {len(csv_files)}: {csv_file.name}"
                    self.progress_callback(progress_msg, i + 1, len(csv_files))

                # Use Polars for faster CSV reading if available
                if USE_POLARS:
                    dat1 = pl.read_csv(csv_file).to_pandas()
                else:
                    dat1 = pd.read_csv(csv_file)

                if (
                    dat1.empty
                    or "start_timestamp" not in dat1.columns
                    or "stop_timestamp" not in dat1.columns
                ):
                    LOGGER.warning(f"Skipping {csv_file.name}: Empty or missing required columns")
                    self.stats.mark_empty_plot_file(csv_file.name)
                    continue

                participant_id = (
                    dat1["participant_id"].iloc[0]
                    if "participant_id" in dat1.columns
                    else "unknown"
                )
                LOGGER.info(f"Plotting data for participant: {participant_id}")

                dat1["start_timestamp"] = pd.to_datetime(dat1["start_timestamp"])
                dat1["stop_timestamp"] = pd.to_datetime(dat1["stop_timestamp"])

                if "date" not in dat1.columns:
                    dat1["date"] = dat1["start_timestamp"].dt.date

                dat1["date"] = pd.to_datetime(dat1["date"])
                all_dates = pd.date_range(
                    start=dat1["date"].min(), end=dat1["date"].max(), freq="D"
                )

                dat2 = dat1.copy()

                if app_codebook is not None:
                    LOGGER.debug(f"Applying app codebook to data for participant {participant_id}")

                    dat2[AppCodebookColumn.BROAD_APP_CATEGORY] = dat2["app_package_name"].map(
                        app_codebook[AppCodebookColumn.BROAD_APP_CATEGORY]
                    )
                    uncategorized_count = dat2[AppCodebookColumn.BROAD_APP_CATEGORY].isna().sum()
                    LOGGER.debug(
                        f"Found {uncategorized_count} uncategorized apps for participant {participant_id}"
                    )

                    dat2[AppCodebookColumn.BROAD_APP_CATEGORY] = dat2[
                        AppCodebookColumn.BROAD_APP_CATEGORY
                    ].fillna("Uncategorised")
                else:
                    LOGGER.debug(
                        f"No app codebook available - marking all apps as Uncategorised for participant {participant_id}"
                    )

                    dat2[AppCodebookColumn.BROAD_APP_CATEGORY] = "Uncategorised"

                dat2["ds"] = pd.to_datetime(dat2["date"])

                # Try to load raw data for gap calculation
                raw_data = None
                if self.options.raw_data_folder:
                    raw_data = self._load_raw_data_for_participant(
                        participant_id, Path(self.options.raw_data_folder)
                    )

                self._create_app_usage_plot(
                    dat2,
                    participant_id,
                    all_dates,
                    output_filename=f"{participant_id} App Usage Plot (Created on {date_str}){' (Including Filtered Apps)' if self.options.include_filtered_app_usage_in_plots else ''}{' (Target Child Only)' if self.options.plot_only_target_child_data else ''}.jpeg",
                    raw_data=raw_data,
                )

                LOGGER.info(f"Successfully created plot for {participant_id}")

                self.stats.mark_plotted(csv_file.name, success_type="app_usage")

            except Exception as e:
                error_msg = f"Error plotting data for {csv_file.name}: {e!s}"
                LOGGER.exception(error_msg)

                plot_errors.append((csv_file.name, str(e)))

                error_type = "general"
                if "KeyError" in str(e):
                    error_type = "missing_column"
                elif "ValueError" in str(e):
                    error_type = "data_format"
                elif "TypeError" in str(e):
                    error_type = "type_mismatch"
                elif "empty" in str(e).lower():
                    error_type = "empty_data"

                self.stats.mark_plot_failed(csv_file.name, str(e), error_type=error_type)
                if self.progress_callback:
                    self.progress_callback(
                        f"Error plotting {csv_file.name}: {e!s}", i + 1, len(csv_files)
                    )

        if plot_errors:
            error_details = "\n".join([f"- {filename}: {error}" for filename, error in plot_errors])
            msg = f"Errors occurred while plotting {len(plot_errors)} file(s):\n{error_details}"
            raise Exception(msg)

        LOGGER.info(f"Completed plotting all files. Output folder: {self.plot_output_folder}")
        return self.stats

    def _load_raw_data_for_participant(
        self, participant_id: str, raw_data_folder: Path
    ) -> pd.DataFrame | None:
        """
        Load raw data file for a participant to calculate gaps.

        Args:
            participant_id: The participant ID to find raw data for
            raw_data_folder: Path to folder containing raw data files

        Returns:
            DataFrame with raw data or None if not found
        """
        import re

        if not raw_data_folder.exists():
            LOGGER.debug(f"Raw data folder does not exist: {raw_data_folder}")
            return None

        # Find raw data file matching participant ID
        pattern = self.options.raw_data_file_regex_pattern
        csv_files = list(raw_data_folder.glob("*.csv"))

        for csv_file in csv_files:
            if not re.match(pattern, csv_file.name):
                continue

            # Check if this file belongs to the participant
            if participant_id in csv_file.name:
                try:
                    LOGGER.debug(f"Loading raw data from {csv_file.name} for gap calculation")
                    if USE_POLARS:
                        raw_df = pl.read_csv(csv_file).to_pandas()
                    else:
                        raw_df = pd.read_csv(csv_file)

                    # Ensure event_timestamp is parsed with proper timezone handling
                    if Column.EVENT_TIMESTAMP in raw_df.columns:
                        raw_df[Column.EVENT_TIMESTAMP] = pd.to_datetime(
                            raw_df[Column.EVENT_TIMESTAMP],
                            format="ISO8601",
                            utc=True,
                            errors="coerce",
                        )
                    return raw_df
                except Exception as e:
                    LOGGER.warning(f"Failed to load raw data file {csv_file.name}: {e}")
                    return None

        LOGGER.debug(f"No raw data file found for participant {participant_id}")
        return None

    def _plot_data_gaps(
        self,
        data: pd.DataFrame,
        all_dates: pd.DatetimeIndex,
        threshold_hours: float = 1.0,
    ) -> None:
        """
        Plot gaps between consecutive data events as shaded regions.

        Gaps are calculated as the time between consecutive event timestamps.
        Only gaps exceeding the threshold are plotted.

        Args:
            data: DataFrame containing all events with event_timestamp column
            all_dates: Complete date range for the plot
            threshold_hours: Minimum gap duration in hours to display (default 1 hour)
        """
        if Column.EVENT_TIMESTAMP not in data.columns:
            LOGGER.debug("No event_timestamp column found, skipping gap plotting")
            return

        # Sort by event timestamp and get unique timestamps
        sorted_data = data.sort_values(Column.EVENT_TIMESTAMP).copy()
        event_times = pd.to_datetime(sorted_data[Column.EVENT_TIMESTAMP])

        if len(event_times) < 2:
            return

        # Calculate gaps between consecutive events
        gap_starts = event_times.iloc[:-1].reset_index(drop=True)
        gap_ends = event_times.iloc[1:].reset_index(drop=True)
        gap_durations = (gap_ends - gap_starts).dt.total_seconds() / 3600.0  # hours

        # Filter to gaps exceeding threshold
        threshold_mask = gap_durations > threshold_hours
        if not threshold_mask.any():
            return

        gap_starts = gap_starts[threshold_mask]
        gap_ends = gap_ends[threshold_mask]

        # Get date ordinal bounds for the plot
        min_date_ord = min(d.toordinal() for d in all_dates)
        max_date_ord = max(d.toordinal() for d in all_dates)

        # Track if we've added the label yet (for legend)
        gap_label_added = False

        # Plot each gap
        for gap_start, gap_end in zip(gap_starts, gap_ends):
            start_date = gap_start.date()
            end_date = gap_end.date()
            start_date_ord = start_date.toordinal()
            end_date_ord = end_date.toordinal()

            # Convert times to hours of day
            start_hours = gap_start.hour + gap_start.minute / 60 + gap_start.second / 3600
            end_hours = gap_end.hour + gap_end.minute / 60 + gap_end.second / 3600

            # Determine label for legend (only first gap gets the label)
            gap_label = "Data Gap" if not gap_label_added else None
            if gap_label:
                gap_label_added = True

            if start_date_ord == end_date_ord:
                # Gap is within a single day
                if min_date_ord <= start_date_ord <= max_date_ord:
                    plt.barh(
                        y=start_date_ord,
                        width=end_hours - start_hours,
                        left=start_hours,
                        height=0.8,
                        color=self.gap_color,
                        alpha=0.15,
                        label=gap_label,
                    )
                    gap_label = None  # Clear label after first use
            else:
                # Gap spans multiple days
                # 1. Plot from start_hours to end of start day
                if min_date_ord <= start_date_ord <= max_date_ord:
                    plt.barh(
                        y=start_date_ord,
                        width=24 - start_hours,
                        left=start_hours,
                        height=0.8,
                        color=self.gap_color,
                        alpha=0.15,
                        label=gap_label,
                    )
                    gap_label = None

                # 2. Plot full days in between
                for day_ord in range(start_date_ord + 1, end_date_ord):
                    if min_date_ord <= day_ord <= max_date_ord:
                        plt.barh(
                            y=day_ord,
                            width=24,
                            left=0,
                            height=0.8,
                            color=self.gap_color,
                            alpha=0.15,
                            label=gap_label,
                        )
                        gap_label = None

                # 3. Plot from start of end day to end_hours
                if min_date_ord <= end_date_ord <= max_date_ord:
                    plt.barh(
                        y=end_date_ord,
                        width=end_hours,
                        left=0,
                        height=0.8,
                        color=self.gap_color,
                        alpha=0.15,
                        label=gap_label,
                    )

    def _create_app_usage_plot(
        self,
        data: pd.DataFrame,
        participant_id: str,
        all_dates: pd.DatetimeIndex,
        output_filename: str,
        raw_data: pd.DataFrame | None = None,
    ) -> None:
        """
        Create an app usage plot for a single participant.

        Args:
            data: DataFrame containing the participant's app usage data
            participant_id: The participant's ID for the plot title
            all_dates: Complete date range for the y-axis
            output_filename: Filename for the output plot
            raw_data: Optional raw data DataFrame for gap calculation
        """
        plt.figure(figsize=(12, 8))

        # Plot data gaps - use raw data if available, otherwise fall back to preprocessed
        gap_threshold_hours = 1.0  # Only show gaps > 1 hour
        gap_data = raw_data if raw_data is not None else data
        self._plot_data_gaps(gap_data, all_dates, gap_threshold_hours)

        # Get app usage events based on whether to include filtered apps
        if self.options.include_filtered_app_usage_in_plots:
            interaction_types_to_plot = [
                InteractionType.APP_USAGE,
                InteractionType.FILTERED_APP_USAGE,
            ]

            # Include non-target child usage if survey data processing is available
            try:
                from chronicle_preprocessing_internal import (
                    DeviceSharingStatus,
                    ParticipantID,
                    TrackingSheet,
                )

                if hasattr(self.options, "use_survey_data") and getattr(
                    self.options, "use_survey_data", False
                ):
                    interaction_types_to_plot.append(InteractionType.NON_TARGET_CHILD_APP_USAGE)
            except ImportError:
                pass

            app_usage_events = data[data[Column.INTERACTION_TYPE].isin(interaction_types_to_plot)]
        else:
            app_usage_events = data[data[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE]

        # Filter to only target child data if requested (applies to all interaction types above)
        if self.options.plot_only_target_child_data:
            app_usage_events = app_usage_events[
                app_usage_events[Column.USERNAME] == TARGET_CHILD_USERNAME
            ]

        # Plot app usage bars - OPTIMIZED: vectorized pre-calculations
        if not app_usage_events.empty:
            # Vectorized calculations
            app_usage_events = app_usage_events.copy()
            start_dts = pd.to_datetime(app_usage_events[Column.START_TIMESTAMP])
            stop_dts = pd.to_datetime(app_usage_events[Column.STOP_TIMESTAMP])

            app_usage_events["start_date"] = start_dts.dt.date
            app_usage_events["stop_date"] = stop_dts.dt.date
            # Convert date difference to days using timedelta
            date_diff = pd.to_datetime(app_usage_events["stop_date"]) - pd.to_datetime(
                app_usage_events["start_date"]
            )
            app_usage_events["days_span"] = date_diff.dt.days
            app_usage_events["start_hours"] = (
                start_dts.dt.hour + start_dts.dt.minute / 60 + start_dts.dt.second / 3600
            )
            app_usage_events["stop_hours"] = (
                stop_dts.dt.hour + stop_dts.dt.minute / 60 + stop_dts.dt.second / 3600
            )
            app_usage_events["duration_hours"] = (stop_dts - start_dts).dt.total_seconds() / 3600.0

            # Map colors vectorized
            app_usage_events["color"] = (
                app_usage_events[AppCodebookColumn.BROAD_APP_CATEGORY]
                .map(self.manual_category_to_color_map)
                .fillna(self.manual_category_to_color_map["Uncategorised"])
            )

        for _, row in app_usage_events.iterrows():
            start_dt = pd.to_datetime(row[Column.START_TIMESTAMP])
            stop_dt = pd.to_datetime(row[Column.STOP_TIMESTAMP])
            start_date = row["start_date"]
            stop_date = row["stop_date"]
            days_span = row["days_span"]
            color = row["color"]

            # Plot a bar for each day the usage spans
            for day_offset in range(days_span + 1):
                current_date = start_date + pd.Timedelta(days=day_offset)
                current_date_ord = current_date.toordinal()

                if current_date_ord > max([d.toordinal() for d in all_dates]):
                    break

                if day_offset == 0:
                    # First day: plot from start time to end of day
                    start_hours = start_dt.hour + start_dt.minute / 60 + start_dt.second / 3600
                    hours_to_plot = min(
                        24 - start_hours, (stop_dt - start_dt).total_seconds() / 3600.0
                    )
                    plt.barh(
                        current_date_ord,
                        hours_to_plot,
                        left=start_hours,
                        color=color,
                        height=0.8,
                    )
                elif day_offset == days_span:
                    # Last day: plot from start of day to stop time
                    stop_hours = stop_dt.hour + stop_dt.minute / 60 + stop_dt.second / 3600
                    plt.barh(
                        current_date_ord,
                        stop_hours,
                        left=0,
                        color=color,
                        height=0.8,
                    )
                else:
                    # Middle days: plot full day
                    plt.barh(
                        current_date_ord,
                        24,
                        left=0,
                        color=color,
                        height=0.8,
                    )

        # Plot device events with arrows
        shutdown_events = data[data[Column.INTERACTION_TYPE] == InteractionType.DEVICE_SHUTDOWN]
        startup_events = data[data[Column.INTERACTION_TYPE] == InteractionType.DEVICE_STARTUP]
        missing_events = data[data[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING]

        # Plot shutdown events with red arrows - OPTIMIZED: vectorized time calculations
        if not shutdown_events.empty:
            shutdown_events = shutdown_events.copy()
            shutdown_times = pd.to_datetime(shutdown_events[Column.EVENT_TIMESTAMP])
            shutdown_events["event_hours"] = (
                shutdown_times.dt.hour
                + shutdown_times.dt.minute / 60
                + shutdown_times.dt.second / 3600
            )
            # Convert date to ordinal - first convert to datetime64[D] then to int64
            ds_dates = (
                pd.to_datetime(shutdown_events["ds"]).values.astype("datetime64[D]").view("int64")
            )
            shutdown_events["date_ord"] = ds_dates + 719163

        for _, row in shutdown_events.iterrows():
            event_hours = row["event_hours"]
            date_ord = row["date_ord"]

            plt.annotate(
                "",
                xy=(event_hours, date_ord - 0.1),
                xytext=(event_hours, date_ord),
                ha="center",
                va="bottom",
                color="red",
                weight="bold",
                arrowprops={
                    "arrowstyle": "->",
                    "color": "red",
                    "lw": 2,
                },
            )

        # Plot startup events with green arrows - OPTIMIZED: vectorized time calculations
        if not startup_events.empty:
            startup_events = startup_events.copy()
            startup_times = pd.to_datetime(startup_events[Column.EVENT_TIMESTAMP])
            startup_events["event_hours"] = (
                startup_times.dt.hour
                + startup_times.dt.minute / 60
                + startup_times.dt.second / 3600
            )
            # Convert date to ordinal - first convert to datetime64[D] then to int64
            ds_dates = (
                pd.to_datetime(startup_events["ds"]).values.astype("datetime64[D]").view("int64")
            )
            startup_events["date_ord"] = ds_dates + 719163

        for _, row in startup_events.iterrows():
            event_hours = row["event_hours"]
            date_ord = row["date_ord"]

            plt.annotate(
                "",
                xy=(event_hours, date_ord - 0.1),
                xytext=(event_hours, date_ord),
                ha="center",
                va="top",
                color="green",
                weight="bold",
                arrowprops={
                    "arrowstyle": "->",
                    "color": "green",
                    "lw": 2,
                },
            )

        # Plot end of usage missing events with gray arrows - OPTIMIZED: vectorized time calculations
        if not missing_events.empty:
            missing_events = missing_events.copy()
            missing_times = pd.to_datetime(missing_events[Column.EVENT_TIMESTAMP])
            missing_events["event_hours"] = (
                missing_times.dt.hour
                + missing_times.dt.minute / 60
                + missing_times.dt.second / 3600
            )
            # Convert date to ordinal - first convert to datetime64[D] then to int64
            ds_dates = (
                pd.to_datetime(missing_events["ds"]).values.astype("datetime64[D]").view("int64")
            )
            missing_events["date_ord"] = ds_dates + 719163

        for _, row in missing_events.iterrows():
            event_hours = row["event_hours"]
            date_ord = row["date_ord"]

            plt.annotate(
                "",
                xy=(event_hours, date_ord - 0.1),
                xytext=(event_hours, date_ord),
                ha="center",
                va="top",
                color="gray",
                weight="bold",
                arrowprops={
                    "arrowstyle": "->",
                    "color": "gray",
                    "lw": 2,
                },
            )

        plt.xlabel("Time (Hours)")
        plt.title(
            f"App Usage for {participant_id} {'(Including Filtered Apps)' if self.options.include_filtered_app_usage_in_plots else ''}{' (Target Child Only)' if self.options.plot_only_target_child_data else ''}"
        )
        plt.xticks(
            ticks=[0, 4, 8, 12, 16, 20, 24],
            labels=["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
        )
        plt.xlim(0, 24)

        all_ticks = [d.toordinal() for d in all_dates]
        all_labels = [d.strftime("%Y %b %d (%a)") for d in all_dates]
        plt.yticks(all_ticks, all_labels)

        # Reverse the y-axis order
        plt.gca().invert_yaxis()

        plt.grid(axis="x", linestyle="--", alpha=0.7)

        legend_handles = [
            Patch(facecolor=color, label=label)
            for label, color in self.manual_category_to_color_map.items()
        ]

        # Add data gap to legend if gaps were plotted
        legend_handles.append(Patch(facecolor=self.gap_color, label="Data Gap", alpha=0.5))

        # Add device events to legend
        if not shutdown_events.empty:
            legend_handles.append(Patch(facecolor="red", label="Device Shutdown"))
        if not startup_events.empty:
            legend_handles.append(Patch(facecolor="green", label="Device Startup"))
        if not missing_events.empty:
            legend_handles.append(Patch(facecolor="gray", label="End of Usage Missing"))

        plt.legend(
            handles=legend_handles,
            title="App Categories & Events",
            bbox_to_anchor=(1.05, 1),
            loc="upper left",
        )

        output_path = self.plot_output_folder / output_filename
        plt.savefig(output_path, dpi=300, bbox_inches="tight")
        plt.close()
        LOGGER.debug(f"Saved plot to {output_path}")


def generate_plots(
    study_name: str,
    preprocessed_folder: Path,
    options: PreprocessingOptions,
    codebook_path: Path | str,
    progress_callback: Callable | None = None,
) -> tuple[Path, ProcessingStats]:
    """
    Generate all app usage plots for the study.

    Args:
        study_name: The name of the study
        preprocessed_folder: Path to folder containing preprocessed CSV files
        options: The options for preprocessing
        codebook_path: Optional path to app categorization codebook
        progress_callback: Optional callback for progress updates

    Returns:
        Tuple[Path, ProcessingStats]: Path to the folder containing generated plots and plotting statistics
    """
    plotting_manager = PlottingManager(
        study_name=study_name,
        output_folder=preprocessed_folder,
        options=options,
        progress_callback=progress_callback,
    )

    # Call the create_all_app_usage_plots method
    stats = plotting_manager.create_all_app_usage_plots(
        preprocessed_folder=preprocessed_folder, codebook_path=codebook_path
    )
    return plotting_manager.plot_output_folder, stats

