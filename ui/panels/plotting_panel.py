"""
Plotting panel component for Chronicle Android Raw Data Preprocessing Application.
This panel provides UI controls for plotting options.
"""

from __future__ import annotations

import logging
from pathlib import Path

from PyQt6.QtCore import QSize, Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from config.constants import DEFAULT_APP_CODEBOOK_FILE_PATH
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions

LOGGER = logging.getLogger(__name__)


class PlottingPanel(QWidget):
    """
    Panel for plotting options in the Chronicle Android Raw Data Preprocessing Application.
    This panel provides UI controls for configuring plotting options,
    including which app codebook to use and filtering options.
    """

    # Signals
    options_updated = pyqtSignal()

    def __init__(self, options: ChronicleAndroidRawDataPreprocessingOptions, parent: QWidget | None = None, scale_factor: float = 1.0) -> None:
        super().__init__(parent)
        self.options = options
        self.scale_factor = scale_factor

        self.setup_ui()

    def setup_ui(self) -> None:
        """
        Set up the user interface components.
        """
        # Main layout
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(10)

        self._setup_plotting_group()
        main_layout.addWidget(self.plotting_group)

        # Apply layout
        self.setLayout(main_layout)

        # Initialize UI elements from options
        if self.options.app_codebook_path:
            self._display_path_with_elide(self.app_codebook_display, str(self.options.app_codebook_path))

        # Initialize visibility based on options
        self.app_codebook_placeholder.setVisible(self.options.use_app_codebook)

    def _setup_plotting_group(self) -> None:
        """
        Set up the plotting options group and its components.
        """
        self.plotting_group = QGroupBox("Plotting Options")
        plotting_layout = QVBoxLayout()

        self.include_filtered_app_usage_checkbox = QCheckBox("Include Filtered App Usage in Plots")
        self.include_filtered_app_usage_checkbox.setChecked(self.options.include_filtered_app_usage_in_plots)
        self.include_filtered_app_usage_checkbox.stateChanged.connect(self._on_include_filtered_app_usage_changed)
        plotting_layout.addWidget(self.include_filtered_app_usage_checkbox)

        self.use_app_codebook_checkbox = QCheckBox("Use App Codebook for Categories")
        self.use_app_codebook_checkbox.setChecked(self.options.use_app_codebook)
        self.use_app_codebook_checkbox.stateChanged.connect(self._on_use_app_codebook_changed)
        plotting_layout.addWidget(self.use_app_codebook_checkbox)

        self.plot_only_target_child_checkbox = QCheckBox("Plot Only Target Child Data")
        self.plot_only_target_child_checkbox.setChecked(self.options.plot_only_target_child_data)
        self.plot_only_target_child_checkbox.stateChanged.connect(self._on_plot_only_target_child_data_changed)
        self.plot_only_target_child_checkbox.setVisible(False)
        plotting_layout.addWidget(self.plot_only_target_child_checkbox)

        self.app_codebook_placeholder = QWidget()
        self.app_codebook_placeholder.setFixedHeight(int(26 * self.scale_factor))
        plotting_layout.addWidget(self.app_codebook_placeholder)

        self.app_codebook_layout = QHBoxLayout(self.app_codebook_placeholder)
        self.app_codebook_layout.setContentsMargins(0, 0, 0, 0)

        app_codebook_label = QLabel("App Codebook:")
        self.app_codebook_display = QLineEdit()
        self.app_codebook_display.setReadOnly(True)
        self.app_codebook_display.setFixedHeight(int(26 * self.scale_factor))

        self.app_codebook_button = QPushButton("Browse...")
        self.app_codebook_button.setFixedSize(QSize(int(80 * self.scale_factor), int(26 * self.scale_factor)))
        self.app_codebook_button.clicked.connect(self._on_select_app_codebook)

        self.app_codebook_layout.addWidget(app_codebook_label)
        self.app_codebook_layout.addWidget(self.app_codebook_display)
        self.app_codebook_layout.addWidget(self.app_codebook_button)

        self.app_codebook_placeholder.setVisible(self.options.use_app_codebook)

        self.plotting_group.setLayout(plotting_layout)

    def _display_path_with_elide(self, line_edit: QLineEdit, path: str) -> None:
        """
        Display a path in a line edit with elided text and tooltip.

        Args:
            line_edit: The QLineEdit to update
            path: The path to display
        """
        # Always set the tooltip to show full path on hover
        line_edit.setToolTip(path)

        # Set the full text (tooltip will ensure user can see the full path)
        line_edit.setText(path)

    def _on_include_filtered_app_usage_changed(self, state: int) -> None:
        """
        Handle include filtered app usage checkbox change.

        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Include filtered app usage in plots changed to: {checked}")
        self.options.include_filtered_app_usage_in_plots = checked
        self.options_updated.emit()

    def _on_use_app_codebook_changed(self, state: int) -> None:
        """
        Handle use app codebook checkbox change.

        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Use app codebook changed to: {checked}")
        self.options.use_app_codebook = checked

        # Show/hide the app codebook selection based on checkbox state
        self.app_codebook_placeholder.setVisible(checked)

        # If enabled and no codebook is set, use the default
        if checked and not self.options.app_codebook_path:
            # Convert relative path to absolute path
            default_path = str(Path(DEFAULT_APP_CODEBOOK_FILE_PATH).absolute())
            self.options.app_codebook_path = default_path
            self._display_path_with_elide(self.app_codebook_display, default_path)

        self.options_updated.emit()

    def _on_plot_only_target_child_data_changed(self, state: int) -> None:
        """
        Handle plot only target child data checkbox change.

        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Plot only target child data changed to: {checked}")
        self.options.plot_only_target_child_data = checked
        self.options_updated.emit()

    def _on_select_app_codebook(self) -> None:
        """
        Open a dialog to select the app codebook file (CSV).
        """
        file, _ = QFileDialog.getOpenFileName(self, "Select App Codebook File", "", "App Codebook Files (*.csv, *.xlsx)")
        if file:
            self._display_path_with_elide(self.app_codebook_display, file)
            self.options.app_codebook_path = file
            LOGGER.debug(f"Selected app codebook: {file}")
            self.options_updated.emit()

    def set_use_app_codebook(self, checked: bool) -> None:
        """
        Set the use app codebook checkbox.

        Args:
            checked: Whether the checkbox should be checked
        """
        self.use_app_codebook_checkbox.setChecked(checked)
        self.app_codebook_placeholder.setVisible(checked)
        self.options.use_app_codebook = checked
        self.options_updated.emit()

    def set_app_codebook_path(self, path: str) -> None:
        """
        Set the app codebook path display.

        Args:
            path: The file path to set
        """
        if path:
            self._display_path_with_elide(self.app_codebook_display, path)
            self.options.app_codebook_path = path
            LOGGER.debug(f"App codebook path set to: {path}")
            self.options_updated.emit()

    def disable_during_processing(self) -> None:
        """
        Disable all UI elements during processing.
        """
        self.include_filtered_app_usage_checkbox.setEnabled(False)
        self.use_app_codebook_checkbox.setEnabled(False)
        self.app_codebook_button.setEnabled(False)
        self.app_codebook_display.setEnabled(False)
        self.plot_only_target_child_checkbox.setEnabled(False)

    def enable_after_processing(self) -> None:
        """
        Enable all UI elements after processing.
        """
        self.include_filtered_app_usage_checkbox.setEnabled(True)
        self.use_app_codebook_checkbox.setEnabled(True)
        self.app_codebook_button.setEnabled(True)
        self.app_codebook_display.setEnabled(True)
        self.plot_only_target_child_checkbox.setEnabled(True)

    def set_include_filtered_app_usage(self, checked: bool) -> None:
        """
        Set the include filtered app usage in plots checkbox.

        Args:
            checked: Whether the checkbox should be checked
        """
        self.include_filtered_app_usage_checkbox.setChecked(checked)
        self.options.include_filtered_app_usage_in_plots = checked
        self.options_updated.emit()
