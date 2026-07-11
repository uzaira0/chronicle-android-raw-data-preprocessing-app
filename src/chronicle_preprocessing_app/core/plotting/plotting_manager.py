"""Plotting manager: daily app-usage bar charts from preprocessed Chronicle CSVs."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date as DateType
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import itertools

import matplotlib.pyplot as plt
import polars as pl
from matplotlib.collections import PatchCollection
from matplotlib.patches import Patch, Rectangle

from chronicle_preprocessing_app.config.constants import (
    GAP_TIMESTAMPS_SIDECAR_SUFFIX,
    PLOTTED_FOLDER_SUFFIX,
    TARGET_CHILD_USERNAME,
    AppCodebookColumn,
    Column,
    InteractionType,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions, ProcessingStats
from chronicle_preprocessing_app.utils.file_utils import read_app_codebook

LOGGER = logging.getLogger(__name__)

CATEGORY_COLORS: dict[str, str] = {
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
GAP_COLOR = "#808080"


class PlottingManager:
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
            self.base_output_folder / f"{self.study_name} {PLOTTED_FOLDER_SUFFIX}"
        )
        self.progress_callback = progress_callback
        self.options = options
        self.stats = ProcessingStats()

    def create_all_app_usage_plots(
        self, preprocessed_folder: Path, codebook_path: Path | str | None
    ) -> ProcessingStats:
        LOGGER.info("Generating app usage plots from %s", preprocessed_folder)
        self.plot_output_folder.mkdir(parents=True, exist_ok=True)

        app_codebook: pl.DataFrame | None = None
        if self.options.use_app_codebook and codebook_path:
            try:
                app_codebook = read_app_codebook(codebook_path)
            except Exception as exc:
                raise Exception(f"Failed to load app codebook: {exc}") from exc

        date_str = datetime.today().strftime("%B %d, %Y")
        csv_files = sorted(preprocessed_folder.glob("*.csv"))
        LOGGER.info("Found %d preprocessed files to plot", len(csv_files))
        self.stats.total_files = len(csv_files)

        # Hoist codebook lookup structures — same for every file in the folder.
        codebook_old: list[str] | None = None
        codebook_new: list[str] | None = None
        if app_codebook is not None:
            pkg_col = AppCodebookColumn.APP_PACKAGE_NAME
            cat_col_cb = AppCodebookColumn.BROAD_APP_CATEGORY
            pkg_to_cat: dict[str, str] = {
                pkg: (cat or "Uncategorised")
                for pkg, cat in zip(
                    app_codebook[pkg_col].to_list(),
                    app_codebook[cat_col_cb].to_list(),
                    strict=False,
                )
            }
            codebook_old = list(pkg_to_cat.keys())
            codebook_new = list(pkg_to_cat.values())

        plot_errors: list[tuple[str, str]] = []

        for i, csv_file in enumerate(csv_files):
            try:
                if self.progress_callback:
                    self.progress_callback(
                        f"Plotting file {i + 1} of {len(csv_files)}: {csv_file.name}",
                        i + 1,
                        len(csv_files),
                    )

                dat = pl.read_csv(csv_file, try_parse_dates=False, infer_schema_length=1000)

                if (
                    dat.is_empty()
                    or "start_timestamp" not in dat.columns
                    or "stop_timestamp" not in dat.columns
                ):
                    LOGGER.warning("Skipping %s: empty or missing required columns", csv_file.name)
                    self.stats.mark_empty_plot_file(csv_file.name)
                    continue

                participant_id = (
                    dat["participant_id"][0]
                    if "participant_id" in dat.columns and len(dat) > 0
                    else "unknown"
                )
                LOGGER.info("Plotting data for participant: %s", participant_id)

                dat = dat.with_columns(
                    pl.col("start_timestamp")
                    .str.to_datetime(strict=False, ambiguous="earliest")
                    .alias("start_timestamp"),
                    pl.col("stop_timestamp")
                    .str.to_datetime(strict=False, ambiguous="earliest")
                    .alias("stop_timestamp"),
                )

                if "date" not in dat.columns:
                    dat = dat.with_columns(pl.col("start_timestamp").dt.date().alias("date"))
                else:
                    dat = dat.with_columns(pl.col("date").str.to_date(strict=False).alias("date"))

                _min_date = dat["date"].min()
                _max_date = dat["date"].max()
                if not isinstance(_min_date, DateType) or not isinstance(_max_date, DateType):
                    continue
                # Polars Date.min()/max() returns date, not datetime — cast to be precise
                min_date: DateType = DateType(_min_date.year, _min_date.month, _min_date.day)
                max_date: DateType = DateType(_max_date.year, _max_date.month, _max_date.day)
                all_dates = [
                    min_date + timedelta(days=d) for d in range((max_date - min_date).days + 1)
                ]

                if codebook_old is not None and codebook_new is not None:
                    dat = dat.with_columns(
                        pl.col("app_package_name")
                        .replace(
                            old=codebook_old,
                            new=codebook_new,
                            default="Uncategorised",
                        )
                        .alias(AppCodebookColumn.BROAD_APP_CATEGORY)
                    )
                else:
                    dat = dat.with_columns(
                        pl.lit("Uncategorised").alias(AppCodebookColumn.BROAD_APP_CATEGORY)
                    )

                raw_dat = self._load_gap_timestamps_sidecar(csv_file)
                if raw_dat is None:
                    # Sidecar absent (old preprocessed folder) — synthesize from
                    # session start + stop timestamps to avoid false gaps within
                    # active session intervals.
                    ts_parts: list[pl.Series] = []
                    if Column.EVENT_TIMESTAMP in dat.columns:
                        ev_col = dat[Column.EVENT_TIMESTAMP]
                        if ev_col.dtype == pl.String:
                            ev_col = ev_col.str.to_datetime(strict=False)
                        ts_parts.append(ev_col.drop_nulls())
                    if "stop_timestamp" in dat.columns:
                        ts_parts.append(dat["stop_timestamp"].drop_nulls())
                    if ts_parts:
                        combined = pl.concat(ts_parts).sort()
                        raw_dat = pl.DataFrame({Column.EVENT_TIMESTAMP: combined})

                suffix = ""
                if self.options.include_filtered_app_usage_in_plots:
                    suffix += " (Including Filtered Apps)"
                if self.options.plot_only_target_child_data:
                    suffix += " (Target Child Only)"
                output_filename = (
                    f"{participant_id} App Usage Plot (Created on {date_str}){suffix}.jpeg"
                )

                self._create_app_usage_plot(
                    dat=dat,
                    participant_id=participant_id,
                    all_dates=all_dates,
                    output_filename=output_filename,
                    raw_dat=raw_dat,
                )

                LOGGER.info("Successfully created plot for %s", participant_id)
                self.stats.mark_plotted(csv_file.name, "app_usage")

            except Exception as exc:
                LOGGER.exception("Error plotting %s", csv_file.name)
                err_str = str(exc)
                plot_errors.append((csv_file.name, err_str))
                error_type = (
                    "missing_column"
                    if isinstance(exc, (KeyError, pl.exceptions.ColumnNotFoundError))
                    else "data_format"
                    if isinstance(exc, ValueError)
                    else "type_mismatch"
                    if isinstance(exc, TypeError)
                    else "empty_data"
                    if "empty" in err_str.lower()
                    else "general"
                )
                self.stats.mark_plot_failed(csv_file.name, err_str, error_type=error_type)
                if self.progress_callback:
                    self.progress_callback(
                        f"Error plotting {csv_file.name}: {exc!s}", i + 1, len(csv_files)
                    )

        if plot_errors:
            details = "\n".join(f"- {f}: {e}" for f, e in plot_errors)
            raise Exception(
                f"Errors occurred while plotting {len(plot_errors)} file(s):\n{details}"
            )

        LOGGER.info("Completed plotting. Output folder: %s", self.plot_output_folder)
        return self.stats

    def _load_gap_timestamps_sidecar(self, preprocessed_csv_path: Path) -> pl.DataFrame | None:
        sidecar_path = preprocessed_csv_path.with_name(
            preprocessed_csv_path.stem + GAP_TIMESTAMPS_SIDECAR_SUFFIX
        )
        if not sidecar_path.exists():
            return None
        try:
            return pl.read_parquet(sidecar_path)
        except Exception as exc:
            LOGGER.warning("Failed to load gap timestamps sidecar %s: %s", sidecar_path.name, exc)
            return None

    def _plot_data_gaps(
        self,
        dat: pl.DataFrame,
        all_dates: list[DateType],
        threshold_hours: float = 1.0,
    ) -> None:
        if Column.EVENT_TIMESTAMP not in dat.columns:
            return
        # Parse event_timestamp to datetime if still stored as string.
        if dat[Column.EVENT_TIMESTAMP].dtype == pl.String:
            parsed = [
                None if v is None else datetime.fromisoformat(v)
                for v in dat[Column.EVENT_TIMESTAMP].to_list()
            ]
            dat = dat.with_columns(pl.Series(Column.EVENT_TIMESTAMP, parsed, dtype=pl.Datetime))
        sorted_dat = dat.sort(Column.EVENT_TIMESTAMP).filter(
            pl.col(Column.EVENT_TIMESTAMP).is_not_null()
        )
        if len(sorted_dat) < 2:
            return

        times: list[datetime] = sorted_dat[Column.EVENT_TIMESTAMP].to_list()
        min_ord = all_dates[0].toordinal()
        max_ord = all_dates[-1].toordinal()

        # Collect all gap segments, then draw in one vectorised call.
        ys: list[float] = []
        widths: list[float] = []
        lefts: list[float] = []

        for gap_start_dt, gap_end_dt in itertools.pairwise(times):
            gap_hours = (gap_end_dt - gap_start_dt).total_seconds() / 3600.0
            if gap_hours <= threshold_hours:
                continue

            start_ord = gap_start_dt.date().toordinal()
            end_ord = gap_end_dt.date().toordinal()
            start_h = gap_start_dt.hour + gap_start_dt.minute / 60 + gap_start_dt.second / 3600
            end_h = gap_end_dt.hour + gap_end_dt.minute / 60 + gap_end_dt.second / 3600

            if start_ord == end_ord:
                if min_ord <= start_ord <= max_ord:
                    ys.append(start_ord)
                    widths.append(end_h - start_h)
                    lefts.append(start_h)
            else:
                if min_ord <= start_ord <= max_ord:
                    ys.append(start_ord)
                    widths.append(24 - start_h)
                    lefts.append(start_h)
                for day_ord in range(start_ord + 1, end_ord):
                    if min_ord <= day_ord <= max_ord:
                        ys.append(day_ord)
                        widths.append(24.0)
                        lefts.append(0.0)
                if min_ord <= end_ord <= max_ord:
                    ys.append(end_ord)
                    widths.append(end_h)
                    lefts.append(0.0)

        if ys:
            gap_patches = [
                Rectangle((left, y - 0.4), w, 0.8)
                for y, w, left in zip(ys, widths, lefts, strict=False)
            ]
            coll = PatchCollection(
                gap_patches, facecolors=GAP_COLOR, edgecolors="none", alpha=0.15, label="Data Gap"
            )
            plt.gca().add_collection(coll)

    def _create_app_usage_plot(
        self,
        dat: pl.DataFrame,
        participant_id: str,
        all_dates: list[DateType],
        output_filename: str,
        raw_dat: pl.DataFrame | None = None,
    ) -> None:
        plt.figure(figsize=(12, 8))

        gap_src = raw_dat if raw_dat is not None else dat
        self._plot_data_gaps(gap_src, all_dates)

        types_to_plot = [InteractionType.APP_USAGE]
        if self.options.include_filtered_app_usage_in_plots:
            types_to_plot.append(InteractionType.FILTERED_APP_USAGE)

        usage_dat = dat.filter(pl.col(Column.INTERACTION_TYPE).is_in(types_to_plot))
        if self.options.plot_only_target_child_data and Column.USERNAME in usage_dat.columns:
            usage_dat = usage_dat.filter(pl.col(Column.USERNAME) == TARGET_CHILD_USERNAME)

        min_ord = min(d.toordinal() for d in all_dates)
        max_ord = max(d.toordinal() for d in all_dates)

        # Collect all bar segments, then issue a single vectorised barh() call.
        ys: list[float] = []
        widths: list[float] = []
        lefts: list[float] = []
        colors: list[str] = []

        start_list = usage_dat["start_timestamp"].to_list()
        stop_list = usage_dat["stop_timestamp"].to_list()
        cat_list = usage_dat[AppCodebookColumn.BROAD_APP_CATEGORY].to_list()
        for start_dt, stop_dt, cat in zip(start_list, stop_list, cat_list, strict=False):
            if start_dt is None or stop_dt is None:
                continue
            color = CATEGORY_COLORS.get(cat or "Uncategorised", CATEGORY_COLORS["Uncategorised"])
            start_d = start_dt.date()
            stop_d = stop_dt.date()
            days_span = (stop_d - start_d).days
            for day_offset in range(days_span + 1):
                cur_ord = (start_d + timedelta(days=day_offset)).toordinal()
                if cur_ord > max_ord:
                    break
                if cur_ord < min_ord:
                    continue
                if day_offset == 0:
                    sh = start_dt.hour + start_dt.minute / 60 + start_dt.second / 3600
                    w = min(24 - sh, (stop_dt - start_dt).total_seconds() / 3600)
                    ys.append(cur_ord)
                    widths.append(w)
                    lefts.append(sh)
                    colors.append(color)
                elif day_offset == days_span:
                    eh = stop_dt.hour + stop_dt.minute / 60 + stop_dt.second / 3600
                    ys.append(cur_ord)
                    widths.append(eh)
                    lefts.append(0.0)
                    colors.append(color)
                else:
                    ys.append(cur_ord)
                    widths.append(24.0)
                    lefts.append(0.0)
                    colors.append(color)

        ax = plt.gca()
        if ys:
            bar_patches = [
                Rectangle((left, y - 0.4), w, 0.8)
                for y, w, left in zip(ys, widths, lefts, strict=False)
            ]
            coll = PatchCollection(
                bar_patches, facecolors=colors, edgecolors="none", match_original=False
            )
            ax.add_collection(coll)

        has_shutdown = self._plot_device_event_arrows(dat, InteractionType.DEVICE_SHUTDOWN, "red")
        has_startup = self._plot_device_event_arrows(dat, InteractionType.DEVICE_STARTUP, "green")
        has_missing = self._plot_device_event_arrows(
            dat, InteractionType.END_OF_USAGE_MISSING, "gray"
        )

        plt.xlabel("Time (Hours)")
        title_suffix = ""
        if self.options.include_filtered_app_usage_in_plots:
            title_suffix += " (Including Filtered Apps)"
        if self.options.plot_only_target_child_data:
            title_suffix += " (Target Child Only)"
        plt.title(f"App Usage for {participant_id}{title_suffix}")
        plt.xticks(
            ticks=[0, 4, 8, 12, 16, 20, 24],
            labels=["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
        )
        plt.xlim(0, 24)
        # PatchCollection doesn't trigger autoscale — set y limits explicitly.
        plt.ylim(min_ord - 0.5, max_ord + 0.5)

        all_ticks = [d.toordinal() for d in all_dates]
        all_labels = [d.strftime("%Y %b %d (%a)") for d in all_dates]
        plt.yticks(all_ticks, all_labels)
        plt.gca().invert_yaxis()
        plt.grid(axis="x", linestyle="--", alpha=0.7)

        legend_handles = [
            Patch(facecolor=color, label=label) for label, color in CATEGORY_COLORS.items()
        ]
        legend_handles.append(Patch(facecolor=GAP_COLOR, label="Data Gap", alpha=0.5))
        if has_shutdown:
            legend_handles.append(Patch(facecolor="red", label="Device Shutdown"))
        if has_startup:
            legend_handles.append(Patch(facecolor="green", label="Device Startup"))
        if has_missing:
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
        LOGGER.debug("Saved plot to %s", output_path)

    def _plot_device_event_arrows(
        self,
        dat: pl.DataFrame,
        interaction_type: str,
        color: str,
    ) -> bool:
        if Column.INTERACTION_TYPE not in dat.columns:
            return False
        event_rows = dat.filter(pl.col(Column.INTERACTION_TYPE) == interaction_type)
        if event_rows.is_empty():
            return False

        if Column.EVENT_TIMESTAMP not in event_rows.columns:
            return False

        event_rows = event_rows.with_columns(
            pl.col(Column.EVENT_TIMESTAMP)
            .str.to_datetime(strict=False, ambiguous="earliest")
            .alias(Column.EVENT_TIMESTAMP)
            if event_rows[Column.EVENT_TIMESTAMP].dtype == pl.String
            else pl.col(Column.EVENT_TIMESTAMP)
        )

        # Extract columns as lists once — avoids per-row dict allocation
        et_list = event_rows[Column.EVENT_TIMESTAMP].to_list()
        date_list = event_rows["date"].to_list()
        for et, ds in zip(et_list, date_list, strict=False):
            if et is None or ds is None:
                continue
            eh = et.hour + et.minute / 60 + et.second / 3600
            d_ord = ds.toordinal()
            plt.annotate(
                "",
                xy=(eh, d_ord - 0.1),
                xytext=(eh, d_ord),
                arrowprops={"arrowstyle": "->", "color": color, "lw": 2},
            )
        return True


def generate_plots(
    *,
    study_name: str,
    preprocessed_folder: Path,
    options: Any,
    codebook_path: str | Path | None = None,
    progress_callback: Any = None,
) -> tuple[Path | None, ProcessingStats]:
    manager = PlottingManager(
        study_name=study_name,
        output_folder=preprocessed_folder,
        options=options,
        progress_callback=progress_callback,
    )
    stats = manager.create_all_app_usage_plots(
        preprocessed_folder=preprocessed_folder,
        codebook_path=codebook_path,
    )
    return manager.plot_output_folder, stats
