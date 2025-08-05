"""
Status panel component for Chronicle Android Raw Data Preprocessing Application.
This panel provides UI controls for status display and control buttons.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from config.constants import UIStatus
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions

LOGGER = logging.getLogger(__name__)


class StatusPanel(QWidget):
    """
    Panel for status display and control buttons in the Chronicle Android Raw Data Preprocessing Application.
    This panel displays the current status of the application and provides buttons
    to start preprocessing and open the output folder.
    """

    # Signals
    start_clicked = pyqtSignal()

    def __init__(
        self,
        options: ChronicleAndroidRawDataPreprocessingOptions,
        parent: QWidget | None = None,
        scale_factor: float = 1.0,
    ) -> None:
        super().__init__(parent)
        self.options = options
        self.scale_factor = scale_factor
        self.output_folder = None
        self.plots_folder = None

        self.setup_ui()

    def setup_ui(self) -> None:
        """
        Set up the user interface components.
        """
        # Main layout
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(10)

        # Status label with better styling
        self.status_label = QLabel(UIStatus.READY)
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setWordWrap(True)
        self.status_label.setMinimumHeight(int(60 * self.scale_factor))
        self.status_label.setStyleSheet("""
            QLabel {
                font-size: 11pt;
                padding: 8px;
                border: 1px solid #D0D0D0;
                border-radius: 4px;
                min-height: 50px;
                max-height: 80px;
            }
        """)

        # Progress label for file processing
        self.progress_label = QLabel("")
        self.progress_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.progress_label.setWordWrap(True)
        self.progress_label.setStyleSheet("""
            QLabel {
                font-size: 10pt;
                padding: 4px;
                color: #505050;
            }
        """)
        self.progress_label.setVisible(False)

        # Progress bar for file processing
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                border: 1px solid #D0D0D0;
                border-radius: 3px;
                text-align: center;
                height: 20px;
            }
            QProgressBar::chunk {
                background-color: #4CAF50;
                width: 10px;
                margin: 0.5px;
            }
        """)
        self.progress_bar.setVisible(False)

        # Button layout
        button_layout = QHBoxLayout()

        # Open output folder button (initially hidden)
        self.open_output_folder_button = QPushButton("Open Output Folder")
        self.open_output_folder_button.clicked.connect(self._on_open_output_folder)
        self.open_output_folder_button.setFixedHeight(int(40 * self.scale_factor))
        self.open_output_folder_button.setVisible(False)

        # Open plots folder button (initially hidden)
        self.open_plots_folder_button = QPushButton("Open Plots Folder")
        self.open_plots_folder_button.clicked.connect(self._on_open_plots_folder)
        self.open_plots_folder_button.setFixedHeight(int(40 * self.scale_factor))
        self.open_plots_folder_button.setVisible(False)

        # Start button
        self.start_button = QPushButton("Start Preprocessing")
        self.start_button.clicked.connect(self._on_start_clicked)
        self.start_button.setFixedHeight(int(40 * self.scale_factor))

        # Add buttons to layout
        button_layout.addWidget(self.open_output_folder_button)
        button_layout.addWidget(self.open_plots_folder_button)
        button_layout.addWidget(self.start_button)

        # Add to main layout
        main_layout.addWidget(self.status_label)
        main_layout.addWidget(self.progress_label)
        main_layout.addWidget(self.progress_bar)
        main_layout.addLayout(button_layout)

        # Apply layout
        self.setLayout(main_layout)

    def _on_start_clicked(self) -> None:
        """
        Handle start button click.
        """
        self.start_clicked.emit()

    def _open_folder(self, folder_path: Path | None, folder_type: str) -> None:
        """
        Generic method to open a folder in the system file explorer.

        Args:
            folder_path: Path to the folder to open
            folder_type: Type of folder (for error messages)
        """
        if not folder_path or not Path(folder_path).exists():
            QMessageBox.warning(self, "Error", f"{folder_type} folder does not exist")
            return

        try:
            # For Windows
            if sys.platform == "win32":
                os.startfile(str(folder_path))
            # For macOS
            elif sys.platform == "darwin":
                subprocess.call(["open", str(folder_path)])
            # For Linux
            else:
                subprocess.call(["xdg-open", str(folder_path)])
        except Exception as e:
            LOGGER.exception(f"Error opening {folder_type.lower()} folder")
            QMessageBox.warning(
                self, "Error", f"Could not open {folder_type.lower()} folder: {e}"
            )

    def _on_open_output_folder(self) -> None:
        """
        Open the output folder in the system file explorer.
        """
        self._open_folder(self.output_folder, "Output")

    def _on_open_plots_folder(self) -> None:
        """
        Open the plots folder in the system file explorer.
        """
        self._open_folder(self.plots_folder, "Plots")

    def update_status(self, message: str) -> None:
        """
        Update the status label with a message and change color based on status type.

        Args:
            message: The status message to display
        """
        self.status_label.setText(message)

        # Set label style based on message content
        if message == UIStatus.OPERATION_COMPLETE:
            # Success style - green background
            self.status_label.setStyleSheet("""
                QLabel {
                    font-size: 11pt;
                    padding: 8px;
                    background-color: #E6F4EA;
                    color: #1E7E34;
                    border: 1px solid #B7DEC5;
                    border-radius: 4px;
                    min-height: 50px;
                    max-height: 80px;
                }
            """)
        elif message == UIStatus.OPERATION_PARTIAL_SUCCESS:
            # Warning style - yellow background
            self.status_label.setStyleSheet("""
                QLabel {
                    font-size: 11pt;
                    padding: 8px;
                    background-color: #FFF3CD;
                    color: #856404;
                    border: 1px solid #FFEEBA;
                    border-radius: 4px;
                    min-height: 50px;
                    max-height: 80px;
                }
            """)
        elif message == UIStatus.OPERATION_FAILED:
            # Error style - red background
            self.status_label.setStyleSheet("""
                QLabel {
                    font-size: 11pt;
                    padding: 8px;
                    background-color: #F8D7DA;
                    color: #721C24;
                    border: 1px solid #F5C6CB;
                    border-radius: 4px;
                    min-height: 50px;
                    max-height: 80px;
                }
            """)
        else:
            # Default style
            self.status_label.setStyleSheet("""
                QLabel {
                    font-size: 11pt;
                    padding: 8px;
                    border: 1px solid #D0D0D0;
                    border-radius: 4px;
                    min-height: 50px;
                    max-height: 80px;
                }
            """)

    def update_progress(
        self, message: str, current_file: int = 0, total_files: int = 0
    ) -> None:
        """
        Update the progress label with file processing information.

        Args:
            message: The progress message
            current_file: Current file being processed
            total_files: Total number of files to process
        """
        try:
            # Make sure the progress label and progress bar are visible
            self.progress_label.setVisible(True)
            self.progress_bar.setVisible(True)

            if total_files > 0:
                # Create progress message with percentage
                progress_pct = int(((current_file - 1) / total_files) * 100)
                progress_msg = f"Progress: {current_file - 1} of {total_files} files ({progress_pct}%)\n{message}"

                # Update progress bar
                self.progress_bar.setValue(progress_pct)
                self.progress_bar.setFormat(f"%p% ({current_file - 1}/{total_files})")
            else:
                # No file count information available
                progress_msg = message
                self.progress_bar.setValue(0)
                self.progress_bar.setFormat("%p%")

            # Update label
            self.progress_label.setText(progress_msg)
        except Exception as e:
            # Log any issues but don't interrupt the flow
            LOGGER.warning(f"Error updating file progress: {e}")

    def hide_progress(self) -> None:
        """
        Hide the progress label and progress bar.
        """
        self.progress_label.setVisible(False)
        self.progress_bar.setVisible(False)

    def show_output_folder_button(self, output_folder: Path | None = None) -> None:
        """
        Show the output folder button and update the folder path.

        Args:
            output_folder: The output folder path to use when button is clicked
        """
        if output_folder:
            self.output_folder = output_folder

        self.open_output_folder_button.setVisible(True)

    def show_plots_folder_button(self, plots_folder: Path | None = None) -> None:
        """
        Show the plots folder button and update the folder path.

        Args:
            plots_folder: The plots folder path to use when button is clicked
        """
        if plots_folder:
            self.plots_folder = plots_folder

        self.open_plots_folder_button.setVisible(True)

    def hide_output_folder_button(self) -> None:
        """
        Hide the output folder button.
        """
        self.open_output_folder_button.setVisible(False)

    def hide_plots_folder_button(self) -> None:
        """
        Hide the plots folder button.
        """
        self.open_plots_folder_button.setVisible(False)

    def disable_during_processing(self) -> None:
        """
        Disable all UI elements during processing.
        """
        self.start_button.setEnabled(False)
        self.hide_output_folder_button()
        self.hide_plots_folder_button()
        self.status_label.setText(UIStatus.PREPROCESSING_IN_PROGRESS)

    def enable_after_processing(self) -> None:
        """
        Enable all UI elements after processing.
        """
        self.start_button.setEnabled(True)
        if self.output_folder:
            self.show_output_folder_button()
        if self.plots_folder:
            self.show_plots_folder_button()
        self.hide_progress()
