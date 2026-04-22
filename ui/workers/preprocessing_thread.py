"""
Thread for running the preprocessing operations in the background.
"""

from __future__ import annotations

import logging
import sys
import traceback
from pathlib import Path

from PyQt6.QtCore import QThread, pyqtSignal

from models.processing_stats import ProcessingStats
from preprocessors.main_preprocessor import ChronicleAndroidRawDataPreprocessor

LOGGER = logging.getLogger(__name__)


class PreprocessingThread(QThread):
    progress_signal = pyqtSignal(str)
    file_progress_signal = pyqtSignal(str, int, int)
    completed_signal = pyqtSignal(str, Path, ProcessingStats)
    error_signal = pyqtSignal(str, ProcessingStats)
    plotting_started_signal = pyqtSignal()
    plotting_completed_signal = pyqtSignal()

    def __init__(self, preprocessor: ChronicleAndroidRawDataPreprocessor) -> None:
        super().__init__()
        self.preprocessor = preprocessor
        self.is_test_mode = False

    def run(self) -> None:
        """
        Run the preprocessing operation in a separate thread.
        """

        def progress_callback(
            message: str, current_file: int, total_files: int
        ) -> None:
            self.file_progress_signal.emit(message, current_file, total_files)

        self.preprocessor.progress_callback = progress_callback

        options = self.preprocessor.options
        output_folder = None
        stats = ProcessingStats()

        try:
            # Run preprocessing if enabled
            if options.enable_preprocessing:
                self.progress_signal.emit("Processing raw data files...")
                output_folder, stats = (
                    self.preprocessor.preprocess_Chronicle_Android_raw_data_folder(
                        plotting_started_callback=lambda: self.plotting_started_signal.emit()
                        if options.enable_plotting
                        else None,
                        plotting_completed_callback=lambda: self.plotting_completed_signal.emit()
                        if options.enable_plotting
                        else None,
                        plotting_only=False,
                    )
                )
            # Run plotting only if preprocessing is disabled but plotting is enabled
            elif options.enable_plotting:
                self.progress_signal.emit("Generating plots from preprocessed data...")
                from config.constants import PREPROCESSED_FOLDER_SUFFIX

                # Determine the preprocessed folder path
                preprocessed_folder = (
                    Path(options.output_folder)
                    / f"{options.study_name + ' ' + PREPROCESSED_FOLDER_SUFFIX}"
                )

                if not preprocessed_folder.exists():
                    error_msg = f"Preprocessed folder not found: {preprocessed_folder}"
                    self.error_signal.emit(error_msg, stats)
                    return

                self.plotting_started_signal.emit()

                # Use the preprocess_Chronicle_Android_raw_data_folder method with plotting_only=True
                try:
                    output_folder, stats = (
                        self.preprocessor.preprocess_Chronicle_Android_raw_data_folder(
                            plotting_started_callback=lambda: self.plotting_started_signal.emit(),
                            plotting_completed_callback=lambda: self.plotting_completed_signal.emit(),
                            plotting_only=True,
                        )
                    )
                except Exception as e:
                    error_str = traceback.format_exc()
                    self.error_signal.emit(
                        f"Error generating plots: {str(e)}\n\n{error_str}", stats
                    )
                    return

            if output_folder:
                operation_text = ""
                if options.enable_preprocessing and options.enable_plotting:
                    operation_text = "Preprocessing and plotting"
                elif options.enable_preprocessing:
                    operation_text = "Preprocessing"
                else:
                    operation_text = "Plotting"

                success_msg = f"{operation_text} completed. Output folder: {output_folder}\n\n{stats.get_summary()}"
                self.completed_signal.emit(success_msg, output_folder, stats)
            else:
                error_msg = f"Operation completed but no output folder was returned.\n\n{stats.get_summary()}"
                self.error_signal.emit(error_msg, stats)
        except Exception as e:
            # Capture the full traceback
            error_str = traceback.format_exc()
            sys.last_traceback = sys.exc_info()[2]
            LOGGER.exception("Unhandled exception in preprocessor thread")

            # Create a detailed error message with exception information
            error_msg = f"Error: {type(e).__name__}: {str(e)}\n\n{error_str}"

            # Create stats object if None (to avoid NoneType errors)
            if stats is None:
                stats = ProcessingStats()

            self.error_signal.emit(error_msg, stats)
