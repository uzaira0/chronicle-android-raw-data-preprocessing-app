"""
Statistics tracking for file processing operations.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

LOGGER: Final[logging.Logger] = logging.getLogger(__name__)


@dataclass
class ProcessingStats:
    """
    Class to track statistics of file processing operations.

    Attributes:
        total_files: Total number of files found for processing
        processed_files: Number of files successfully processed
        failed_files: Number of files that failed processing
        empty_files: Number of files with no valid app usage data
        plotted_files: Number of files successfully plotted
        plot_failed_files: Number of files that failed plotting
        empty_plot_files: Number of files with no plottable data
        plot_warnings: Number of files with plotting warnings
        errors: Dictionary mapping filenames to their error messages
        file_errors: Dictionary of specific error types per file
        warnings: Dictionary mapping filenames to their warning messages
        plot_error_types: Dictionary mapping error types to count during plotting
        plot_success_types: Dictionary mapping success types to count during plotting
    """

    total_files: int = 0
    processed_files: int = 0
    failed_files: int = 0
    empty_files: int = 0
    plotted_files: int = 0
    plot_failed_files: int = 0
    empty_plot_files: int = 0
    plot_warnings: int = 0
    errors: dict[str, str] = field(default_factory=dict)
    file_errors: dict[str, list[str]] = field(default_factory=dict)
    warnings: dict[str, list[str]] = field(default_factory=dict)
    processed_file_paths: set[Path] = field(default_factory=set)
    plot_error_types: dict[str, int] = field(default_factory=dict)
    plot_success_types: dict[str, int] = field(default_factory=dict)

    def add_error(self, filename: str, error_message: str) -> None:
        """
        Add an error for a specific file.

        Args:
            filename: Name of the file with the error
            error_message: The error message
        """
        self.errors[filename] = error_message
        self.failed_files += 1
        LOGGER.error(f"Error processing {filename}: {error_message}")

    def add_file_error(self, filename: str, error_type: str) -> None:
        """
        Add a specific error type for a file.

        Args:
            filename: Name of the file
            error_type: Type of error encountered
        """
        if filename not in self.file_errors:
            self.file_errors[filename] = []
        self.file_errors[filename].append(error_type)
        LOGGER.error(f"{error_type} error in {filename}")

    def add_warning(self, filename: str, warning_message: str) -> None:
        """
        Add a warning for a specific file.

        Args:
            filename: Name of the file with the warning
            warning_message: The warning message
        """
        if filename not in self.warnings:
            self.warnings[filename] = []
        self.warnings[filename].append(warning_message)
        LOGGER.warning(f"Warning for {filename}: {warning_message}")

    def mark_empty_file(self, filename: str) -> None:
        """
        Mark a file as empty (no valid app usage data).

        Args:
            filename: Name of the empty file
        """
        self.empty_files += 1
        self.add_warning(filename, "No valid app usage data found")

    def mark_processed(self, file_path: Path) -> None:
        """
        Mark a file as successfully processed.

        Args:
            file_path: Path of the processed file
        """
        self.processed_files += 1
        self.processed_file_paths.add(file_path)

    def mark_error(self, file_path: Path, error_message: str) -> None:
        """
        Mark a file as having an error during processing.

        Args:
            file_path: Path of the file with an error
            error_message: The error message
        """
        self.add_error(str(file_path), error_message)

    def mark_plotted(self, filename: str, success_type: str = "general") -> None:
        """
        Mark a file as successfully plotted.

        Args:
            filename: Name of the plotted file
            success_type: Type of success during plotting
        """
        self.plotted_files += 1

        # Track the success type
        if success_type not in self.plot_success_types:
            self.plot_success_types[success_type] = 0
        self.plot_success_types[success_type] += 1

    def mark_plot_failed(
        self, filename: str, error_message: str, error_type: str = "general"
    ) -> None:
        """
        Mark a file as failed during plotting.

        Args:
            filename: Name of the file that failed plotting
            error_message: The error message
            error_type: Type of error encountered during plotting
        """
        self.plot_failed_files += 1
        self.add_error(f"{filename} (plotting)", error_message)

        # Track the error type
        if error_type not in self.plot_error_types:
            self.plot_error_types[error_type] = 0
        self.plot_error_types[error_type] += 1

    def mark_empty_plot_file(self, filename: str) -> None:
        """
        Mark a file as empty for plotting purposes.

        Args:
            filename: Name of the empty file
        """
        self.empty_plot_files += 1
        self.add_warning(filename, "No plottable data found")

    def add_plot_warning(self, filename: str, warning_message: str) -> None:
        """
        Add a warning specific to plotting.

        Args:
            filename: Name of the file with the warning
            warning_message: The warning message
        """
        self.plot_warnings += 1
        self.add_warning(f"{filename} (plotting)", warning_message)

    def get_summary(self) -> str:
        """
        Get a summary of the processing statistics.

        Returns:
            str: A formatted summary message
        """
        summary: list[str] = [
            f"Total files found: {self.total_files}",
            f"Successfully processed: {self.processed_files}/{self.total_files}",
            f"Files with no valid app usage: {self.empty_files}",
            f"Failed to process: {self.failed_files}",
        ]

        if (
            self.plotted_files > 0
            or self.plot_failed_files > 0
            or self.empty_plot_files > 0
        ):
            summary.append(
                f"Successfully plotted: {self.plotted_files}/{self.processed_files}"
            )
            if self.empty_plot_files > 0:
                summary.append(f"Files with no plottable data: {self.empty_plot_files}")
            if self.plot_warnings > 0:
                summary.append(f"Files with plotting warnings: {self.plot_warnings}")
            if self.plot_failed_files > 0:
                summary.append(f"Failed to plot: {self.plot_failed_files}")

            # Add error type breakdown if present
            if self.plot_error_types:
                summary.append("\nPlotting error types:")
                for error_type, count in self.plot_error_types.items():
                    summary.append(f"  - {error_type}: {count}")

            # Add success type breakdown if present
            if self.plot_success_types:
                summary.append("\nPlotting success types:")
                for success_type, count in self.plot_success_types.items():
                    summary.append(f"  - {success_type}: {count}")

        return "\n".join(summary)

    def add_plot_error(
        self, filename: str, error_message: str, error_type: str = "general"
    ) -> None:
        """
        Add a specific error related to plot generation.

        Args:
            filename: Name of the file with the error
            error_message: The error message
            error_type: Type of error encountered during plotting
        """
        # This is essentially an alias for mark_plot_failed for backward compatibility
        self.mark_plot_failed(filename, error_message, error_type)

    def success_rate(self) -> float:
        """
        Calculate the success rate of file processing.

        Returns:
            float: The success rate as a percentage (0-100)
        """
        if self.total_files == 0:
            return 0.0

        return (self.processed_files / self.total_files) * 100.0

    def summary(self) -> str:
        """
        Get a short summary of the processing statistics.

        Returns:
            str: A short summary message
        """
        success_pct = self.success_rate()
        plot_success_pct = (
            (self.plotted_files / self.processed_files) * 100.0
            if self.processed_files > 0
            else 0.0
        )

        summary_text = f"Processed {self.processed_files}/{self.total_files} files ({success_pct:.1f}%)"

        if self.plotted_files > 0:
            summary_text += f", Plotted {self.plotted_files}/{self.processed_files} files ({plot_success_pct:.1f}%)"

        if self.failed_files > 0:
            summary_text += f", Failed: {self.failed_files}"

        if self.empty_files > 0:
            summary_text += f", Empty: {self.empty_files}"

        return summary_text

    def get_detailed_summary(self) -> str:
        """
        Get a detailed summary including errors and warnings.

        Returns:
            str: A detailed summary message
        """
        summary: str = self.get_summary() + "\n\n"

        if self.errors:
            summary += "Errors:\n"
            for filename, error in self.errors.items():
                summary += f"- {filename}: {error}\n"
            summary += "\n"

        if self.warnings:
            summary += "Warnings:\n"
            for filename, warning_list in self.warnings.items():
                for warning in warning_list:
                    summary += f"- {filename}: {warning}\n"

        return summary
