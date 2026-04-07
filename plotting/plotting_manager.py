"""
Plotting manager to handle app usage visualization.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Callable

import matplotlib

matplotlib.use("Agg")  # Use non-interactive backend to avoid threading warnings
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.patches import Patch

from config.constants import (
    PLOTTED_FOLDER_SUFFIX,
    TARGET_CHILD_USERNAME,
    AppCodebookColumn,
    Column,
    InteractionType,
)
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from models.processing_stats import ProcessingStats
from utils.file_utils import read_app_codebook

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
        options: ChronicleAndroidRawDataPreprocessingOptions,
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

        self.gap_color = "#FF00FF"  # Magenta

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
                    progress_msg = (
                        f"Plotting file {i + 1} of {len(csv_files)}: {csv_file.name}"
                    )
                    self.progress_callback(progress_msg, i + 1, len(csv_files))

                dat1 = pd.read_csv(csv_file)

                if (
                    dat1.empty
                    or "start_timestamp" not in dat1.columns
                    or "stop_timestamp" not in dat1.columns
                ):
                    LOGGER.warning(
                        f"Skipping {csv_file.name}: Empty or missing required columns"
                    )
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
                    LOGGER.debug(
                        f"Applying app codebook to data for participant {participant_id}"
                    )

                    # Use optimized lookup instead of merge
                    dat2[AppCodebookColumn.BROAD_APP_CATEGORY] = dat2[
                        "app_package_name"
                    ].map(app_codebook[AppCodebookColumn.BROAD_APP_CATEGORY])
                    uncategorized_count = (
                        dat2[AppCodebookColumn.BROAD_APP_CATEGORY].isna().sum()
                    )
                    LOGGER.debug(
                        f"Found {uncategorized_count} uncategorized apps for participant {participant_id}"
                    )

                    # Fill uncategorized apps in a vectorized way
                    dat2[AppCodebookColumn.BROAD_APP_CATEGORY] = dat2[
                        AppCodebookColumn.BROAD_APP_CATEGORY
                    ].fillna("Uncategorised")
                else:
                    LOGGER.debug(
                        f"No app codebook available - marking all apps as Uncategorised for participant {participant_id}"
                    )

                    dat2[AppCodebookColumn.BROAD_APP_CATEGORY] = "Uncategorised"

                dat2["ds"] = pd.to_datetime(dat2["date"])

                self._create_app_usage_plot(
                    dat2,
                    participant_id,
                    all_dates,
                    output_filename=f"{participant_id} App Usage Plot (Created on {date_str}){' (Including Filtered Apps)' if self.options.include_filtered_app_usage_in_plots else ''}{' (Target Child Only)' if self.options.plot_only_target_child_data else ''}.jpeg",
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

                self.stats.mark_plot_failed(
                    csv_file.name, str(e), error_type=error_type
                )
                if self.progress_callback:
                    self.progress_callback(
                        f"Error plotting {csv_file.name}: {e!s}", i + 1, len(csv_files)
                    )

        if plot_errors:
            error_details = "\n".join(
                [f"- {filename}: {error}" for filename, error in plot_errors]
            )
            msg = f"Errors occurred while plotting {len(plot_errors)} file(s):\n{error_details}"
            raise Exception(msg)

        LOGGER.info(
            f"Completed plotting all files. Output folder: {self.plot_output_folder}"
        )
        return self.stats

    def _create_app_usage_plot(
        self,
        data: pd.DataFrame,
        participant_id: str,
        all_dates: pd.DatetimeIndex,
        output_filename: str,
    ) -> None:
        """
        Create an app usage plot for a single participant.

        Args:
            data: DataFrame containing the participant's app usage data
            participant_id: The participant's ID for the plot title
            all_dates: Complete date range for the y-axis
            output_filename: Filename for the output plot
        """
        plt.figure(figsize=(12, 8))

        # TODO: Remove this once we have a way to properly gap indicators
        has_gap_indicators = False  # Column.DATA_TIME_GAP_HOURS in data.columns

        if has_gap_indicators:
            # Track which dates already have a gap label
            gap_labels_used = {}

            # Process all gaps
            for _, row in data[data[Column.DATA_TIME_GAP_HOURS] > 0].iterrows():
                date_ord = row["ds"].toordinal()
                start_time = pd.to_datetime(row[Column.START_TIMESTAMP])
                start_hours = (
                    start_time.hour + start_time.minute / 60 + start_time.second / 3600
                )
                gap_duration = row[Column.DATA_TIME_GAP_HOURS]

                # ALWAYS plot a gap on the current day from 0 to start_time
                # Add label only if not already used for this date
                gap_label = None
                if date_ord not in gap_labels_used:
                    gap_label = "Data Gap"
                    gap_labels_used[date_ord] = True

                # Plot the current day's gap (always from 0 to start_time)
                plt.barh(
                    y=date_ord,
                    width=start_hours,
                    left=0,
                    height=0.8,
                    color=self.gap_color,
                    alpha=0.5,
                    label=gap_label,
                )

                # Calculate full days and remaining hours for previous days
                # First subtract the hours already accounted for on the current day
                adjusted_gap_duration = gap_duration - start_hours

                if adjusted_gap_duration > 0:
                    days_span = int(adjusted_gap_duration / 24)
                    remaining_hours = adjusted_gap_duration % 24

                    # Plot full previous days
                    for day_offset in range(1, days_span + 1):
                        current_date_ord = date_ord - day_offset

                        # Skip if this date is before our dataset
                        if current_date_ord < min([d.toordinal() for d in all_dates]):
                            continue

                        # Add label only if not already used for this date
                        prev_gap_label = None
                        if current_date_ord not in gap_labels_used:
                            prev_gap_label = "Data Gap"
                            gap_labels_used[current_date_ord] = True

                        # Plot full day
                        plt.barh(
                            y=current_date_ord,
                            width=24,
                            left=0,
                            height=0.8,
                            color=self.gap_color,
                            alpha=0.5,
                            label=prev_gap_label,
                        )

                    # Plot any remaining hours on the earliest day
                    if remaining_hours > 0:
                        earliest_date_ord = date_ord - (days_span + 1)

                        # Skip if this date is before our dataset
                        if earliest_date_ord >= min([d.toordinal() for d in all_dates]):
                            # Add label only if not already used for this date
                            earliest_gap_label = None
                            if earliest_date_ord not in gap_labels_used:
                                earliest_gap_label = "Data Gap"
                                gap_labels_used[earliest_date_ord] = True

                            # Plot remaining hours at the end of the day
                            plt.barh(
                                y=earliest_date_ord,
                                width=remaining_hours,
                                left=24 - remaining_hours,
                                height=0.8,
                                color=self.gap_color,
                                alpha=0.5,
                                label=earliest_gap_label,
                            )

        # Get app usage events based on whether to include filtered apps
        if self.options.include_filtered_app_usage_in_plots:
            interaction_types_to_plot = [
                InteractionType.APP_USAGE,
                InteractionType.FILTERED_APP_USAGE,
            ]

            # Include non-target child usage if survey data processing is available
            # This allows plotting of usage from non-target children on shared devices
            try:
                from internal.P01_classes import (
                    DeviceSharingStatus,
                    ParticipantID,
                    TrackingSheet,
                )

                if hasattr(self.options, "use_survey_data") and getattr(
                    self.options, "use_survey_data", False
                ):
                    interaction_types_to_plot.append(
                        InteractionType.NON_TARGET_CHILD_APP_USAGE
                    )
            except ImportError:
                # Internal modules not available - don't include non-target child usage
                pass

            app_usage_events = data[
                data[Column.INTERACTION_TYPE].isin(interaction_types_to_plot)
            ]
        else:
            app_usage_events = data[
                data[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE
            ]

        # Filter to only target child data if requested (applies to all interaction types above)
        # This will exclude NON_TARGET_CHILD_APP_USAGE when plot_only_target_child_data = True
        if self.options.plot_only_target_child_data:
            app_usage_events = app_usage_events[
                app_usage_events[Column.USERNAME] == TARGET_CHILD_USERNAME
            ]

        # Plot app usage bars
        for _, row in app_usage_events.iterrows():
            start_dt = row[Column.START_TIMESTAMP]
            stop_dt = row[Column.STOP_TIMESTAMP]

            # Calculate the number of days this usage spans
            start_date = start_dt.date()
            stop_date = stop_dt.date()

            days_span = (stop_date - start_date).days

            color = self.manual_category_to_color_map.get(
                row[AppCodebookColumn.BROAD_APP_CATEGORY],
                self.manual_category_to_color_map["Uncategorised"],
            )

            # Plot a bar for each day the usage spans
            for day_offset in range(days_span + 1):
                current_date = start_date + pd.Timedelta(days=day_offset)
                current_date_ord = current_date.toordinal()

                if current_date_ord > max([d.toordinal() for d in all_dates]):
                    break

                if day_offset == 0:
                    # First day: plot from start time to end of day
                    start_hours = (
                        start_dt.hour + start_dt.minute / 60 + start_dt.second / 3600
                    )
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
                    stop_hours = (
                        stop_dt.hour + stop_dt.minute / 60 + stop_dt.second / 3600
                    )
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
        shutdown_events = data[
            data[Column.INTERACTION_TYPE] == InteractionType.DEVICE_SHUTDOWN
        ]
        startup_events = data[
            data[Column.INTERACTION_TYPE] == InteractionType.DEVICE_STARTUP
        ]
        missing_events = data[
            data[Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING
        ]

        # Plot shutdown events with red arrows
        for _, row in shutdown_events.iterrows():
            event_time = pd.to_datetime(row[Column.EVENT_TIMESTAMP])
            event_hours = (
                event_time.hour + event_time.minute / 60 + event_time.second / 3600
            )
            date_ord = row["ds"].toordinal()

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

        # Plot startup events with green arrows
        for _, row in startup_events.iterrows():
            event_time = pd.to_datetime(row[Column.EVENT_TIMESTAMP])
            event_hours = (
                event_time.hour + event_time.minute / 60 + event_time.second / 3600
            )
            date_ord = row["ds"].toordinal()

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

        # Plot end of usage missing events with yellow arrows
        for _, row in missing_events.iterrows():
            event_time = pd.to_datetime(row[Column.EVENT_TIMESTAMP])
            event_hours = (
                event_time.hour + event_time.minute / 60 + event_time.second / 3600
            )
            date_ord = row["ds"].toordinal()

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

        if has_gap_indicators and any(data[Column.DATA_TIME_GAP_HOURS] > 0):
            legend_handles.append(
                Patch(facecolor=self.gap_color, label="Data Gap", alpha=0.5)
            )

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
    options: ChronicleAndroidRawDataPreprocessingOptions,
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
