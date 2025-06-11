"""
Options panel component for Chronicle Android Raw Data Preprocessing Application.
This panel provides UI controls for timezone and interaction settings.
"""

from __future__ import annotations

import logging

from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QButtonGroup,
    QComboBox,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QVBoxLayout,
    QWidget,
)

from config.constants import DialogMessage, TimezoneHandlingOption
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from preprocessors.timezone_preprocessor import TimezonePreprocessor
from ui.dialogs.interaction_dialogs import (
    InteractionTypesToRemoveDialog,
    OtherInteractionTypesDialog,
    SameAppInteractionTypesDialog,
)

LOGGER = logging.getLogger(__name__)


class OptionsPanel(QWidget):
    """
    Panel for timezone and interaction settings in the Chronicle Android Raw Data Preprocessing Application.
    This panel includes timezone selection, timezone handling options, and
    configuration buttons for interaction types.
    """

    # Signals
    timezone_changed = pyqtSignal(str)
    options_updated = pyqtSignal()

    def __init__(self, options: ChronicleAndroidRawDataPreprocessingOptions, parent: QWidget | None = None, scale_factor: float = 1.0) -> None:
        super().__init__(parent)
        self.options = options
        self.scale_factor = scale_factor
        self.timezones_loaded_from_config = False

        self.setup_ui()

    def setup_ui(self) -> None:
        """
        Set up the user interface components.
        """
        # Main layout
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(10)

        # Create timezone group
        self._setup_timezone_group()
        main_layout.addWidget(self.timezone_group)

        # Create interaction types group
        self._setup_interaction_types_group()
        main_layout.addWidget(self.interaction_types_group)

        # Apply layout
        self.setLayout(main_layout)

    def _setup_timezone_group(self) -> None:
        """
        Set up the timezone handling group and its components.
        """
        self.timezone_group = QGroupBox("Timezone Handling")
        timezone_layout = QVBoxLayout()

        self.timezone_option_button_group = QButtonGroup()

        # Create radio buttons with clearer labels
        self.remove_all_without_timezone_radio = QRadioButton("Remove data with timezones other than the selected timezone in all files")
        self.convert_all_to_timezone_radio = QRadioButton("Convert data to the selected timezone in all files")
        self.remove_all_without_primary_timezone_radio = QRadioButton("Remove data with timezones other than the primary timezone within each file")
        self.convert_all_to_primary_timezone_radio = QRadioButton("Convert data to the primary timezone within each file")

        # Add tooltips for each option
        self.remove_all_without_timezone_radio.setToolTip("Keeps only data with the timezone you select above and removes all other data.")
        self.convert_all_to_timezone_radio.setToolTip("Keeps all data and converts timestamps to the timezone you select above.")
        self.remove_all_without_primary_timezone_radio.setToolTip(
            "For each file, determines the most common timezone and removes data with different timezones."
        )
        self.convert_all_to_primary_timezone_radio.setToolTip(
            "For each file, determines the most common timezone and converts all data to that timezone."
        )

        self.timezone_option_button_group.addButton(
            self.remove_all_without_timezone_radio, TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE.value
        )
        self.timezone_option_button_group.addButton(
            self.convert_all_to_timezone_radio, TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE.value
        )
        self.timezone_option_button_group.addButton(
            self.remove_all_without_primary_timezone_radio, TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE.value
        )
        self.timezone_option_button_group.addButton(
            self.convert_all_to_primary_timezone_radio, TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE.value
        )

        self.remove_all_without_timezone_radio.setChecked(True)
        self.timezone_option_button_group.buttonClicked.connect(self._on_timezone_option_changed)

        # Timezone selection dropdown and input
        self.timezone_selection_label = QLabel("Select Timezone (or type in a custom timezone):")
        self.timezone_selection_dropdown = QComboBox()
        self.timezone_selection_dropdown.setEditable(True)
        self.timezone_selection_dropdown.setInsertPolicy(QComboBox.InsertPolicy.NoInsert)
        self.timezone_selection_dropdown.currentTextChanged.connect(self._on_timezone_changed)

        radio_buttons_layout = QVBoxLayout()
        radio_buttons_layout.addWidget(self.remove_all_without_timezone_radio)
        radio_buttons_layout.addWidget(self.convert_all_to_timezone_radio)
        radio_buttons_layout.addWidget(self.remove_all_without_primary_timezone_radio)
        radio_buttons_layout.addWidget(self.convert_all_to_primary_timezone_radio)
        timezone_layout.addLayout(radio_buttons_layout)

        timezone_selector_layout = QHBoxLayout()
        timezone_selector_layout.addWidget(self.timezone_selection_label)
        timezone_selector_layout.addWidget(self.timezone_selection_dropdown)
        timezone_layout.addLayout(timezone_selector_layout)

        self.timezone_group.setLayout(timezone_layout)

    def _setup_interaction_types_group(self) -> None:
        """
        Set up the interaction types group and its components.
        """
        self.interaction_types_group = QGroupBox("Configure Interaction Types")
        interaction_types_layout = QVBoxLayout()

        self.configure_same_app_interaction_types_button = QPushButton("Same App Interaction Types to Stop Usage At")
        self.configure_same_app_interaction_types_button.clicked.connect(self._on_configure_same_app_interaction_types)
        self.configure_same_app_interaction_types_button.setFixedHeight(int(30 * self.scale_factor))
        self.configure_same_app_interaction_types_button.setStyleSheet("text-align: center;")

        self.configure_other_interaction_types_button = QPushButton("Other Interaction Types to Stop Usage At")
        self.configure_other_interaction_types_button.clicked.connect(self._on_configure_other_interaction_types)
        self.configure_other_interaction_types_button.setFixedHeight(int(30 * self.scale_factor))
        self.configure_other_interaction_types_button.setStyleSheet("text-align: center;")

        self.configure_interaction_types_to_remove_button = QPushButton("Interaction Types to Remove from Final Output")
        self.configure_interaction_types_to_remove_button.clicked.connect(self._on_configure_interaction_types_to_remove)
        self.configure_interaction_types_to_remove_button.setFixedHeight(int(30 * self.scale_factor))
        self.configure_interaction_types_to_remove_button.setStyleSheet("text-align: center;")

        interaction_types_layout.addWidget(self.configure_same_app_interaction_types_button)
        interaction_types_layout.addSpacing(5)
        interaction_types_layout.addWidget(self.configure_other_interaction_types_button)
        interaction_types_layout.addSpacing(5)
        interaction_types_layout.addWidget(self.configure_interaction_types_to_remove_button)

        self.interaction_types_group.setLayout(interaction_types_layout)

    def _on_timezone_changed(self, timezone: str) -> None:
        """
        Handle timezone selection change.

        Args:
            timezone: The new timezone selection
        """
        LOGGER.debug(f"Timezone changed to: {timezone}")
        if timezone:
            self.options.selected_timezone = timezone
            self.timezone_changed.emit(timezone)
            self.options_updated.emit()

    def _on_timezone_option_changed(self) -> None:
        """
        Handle timezone option change.
        """
        option_value = self.timezone_option_button_group.checkedId()
        LOGGER.debug(f"Timezone option changed to: {option_value}")
        self.options.timezone_handling_option = TimezoneHandlingOption(option_value)

        # Show/hide timezone selection based on option
        is_per_file_option = (
            self.options.timezone_handling_option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE
            or self.options.timezone_handling_option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE
        )

        self.timezone_selection_label.setVisible(not is_per_file_option)
        self.timezone_selection_dropdown.setVisible(not is_per_file_option)

        self.options_updated.emit()

    def update_timezone_dropdown(self) -> None:
        """
        Update the timezone dropdown with both available and custom timezones.
        """
        # Remember the current selection
        current_selection = self.timezone_selection_dropdown.currentText()

        # Clear the dropdown
        self.timezone_selection_dropdown.clear()

        # Create a combined list of timezones
        all_timezones = []
        all_timezones.extend(self.options.available_timezones)

        # Add custom timezones if they're not already in the list
        for tz in self.options.custom_timezones:
            if tz not in all_timezones:
                all_timezones.append(tz)

        # Sort the list
        all_timezones.sort()

        # Add all timezones to the dropdown
        for tz in all_timezones:
            self.timezone_selection_dropdown.addItem(tz)

        # Restore the current selection if it exists
        if current_selection and self.timezone_selection_dropdown.findText(current_selection) >= 0:
            self.timezone_selection_dropdown.setCurrentText(current_selection)
        elif self.options.selected_timezone:
            # Convert to string if it's not already
            selected_tz = str(self.options.selected_timezone)
            self.timezone_selection_dropdown.setCurrentText(selected_tz)

    def on_find_all_timezones_clicked(self) -> None:
        """
        Discover and set available timezones from the data folder.
        """
        if not self.options.raw_data_folder:
            QMessageBox.warning(self.window(), "Warning", DialogMessage.WARNING_RAW_DATA_FOLDER)
            return

        LOGGER.debug(f"Discovering timezones in folder: {self.options.raw_data_folder}")
        try:
            # Save the current selected timezone
            current_timezone = self.options.selected_timezone

            # Get timezones from folder
            timezones = TimezonePreprocessor.find_all_timezones_in_folder_files(
                self.options.raw_data_folder, self.options.raw_data_file_regex_pattern
            )

            # Update available timezones (not custom ones)
            self.options.available_timezones = timezones

            # Update the dropdown with both available and custom timezones
            self.update_timezone_dropdown()

            # Set a default timezone if not already set
            if not self.options.selected_timezone and timezones:
                self.timezone_selection_dropdown.setCurrentText(timezones[0])
                self.options.selected_timezone = timezones[0]
            elif current_timezone:  # Restore previously selected timezone
                self.timezone_selection_dropdown.setCurrentText(str(current_timezone))
                self.options.selected_timezone = current_timezone

            QMessageBox.information(self.window(), "Timezones Found", f"Found {len(timezones)} timezones in the raw data files.")

        except Exception as e:
            LOGGER.exception(msg="Error finding timezones")
            QMessageBox.critical(self.window(), "Error", text=f"Failed to find timezones: {e!s}")

    def _on_configure_same_app_interaction_types(self) -> None:
        """
        Open dialog to configure same app interaction types.
        """
        from ui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

        parent = self.window()
        if isinstance(parent, ChronicleAndroidRawDataPreprocessingGUI):
            dialog = SameAppInteractionTypesDialog(parent, self.options)
            if dialog.exec() == QMessageBox.DialogCode.Accepted:
                # Update options with the selected interaction types
                self.options.same_app_interaction_types_to_stop_usage_at = dialog.get_selected_interaction_types()
                # Mark that these were specifically configured
                self.options.same_app_interaction_types_configured = True
                self.options_updated.emit()

    def _on_configure_other_interaction_types(self) -> None:
        """
        Open dialog to configure other interaction types.
        """
        from ui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

        parent = self.window()
        if isinstance(parent, ChronicleAndroidRawDataPreprocessingGUI):
            dialog = OtherInteractionTypesDialog(parent, self.options)
            if dialog.exec() == QMessageBox.DialogCode.Accepted:
                # Update options with the selected interaction types
                self.options.other_interaction_types_to_stop_usage_at = dialog.get_selected_interaction_types()
                # Mark that these were specifically configured
                self.options.other_interaction_types_configured = True
                self.options_updated.emit()

    def _on_configure_interaction_types_to_remove(self) -> None:
        """
        Open dialog to configure interaction types to remove.
        """
        from ui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

        parent = self.window()
        if isinstance(parent, ChronicleAndroidRawDataPreprocessingGUI):
            dialog = InteractionTypesToRemoveDialog(parent, self.options)
            if dialog.exec() == QMessageBox.DialogCode.Accepted:
                # Update options with the selected interaction types
                self.options.interaction_types_to_remove = dialog.get_selected_interaction_types()
                # Mark that these were specifically configured
                self.options.interaction_types_to_remove_configured = True
                self.options_updated.emit()

    def _on_enable_plotting_changed(self, state: int) -> None:
        """
        Handle enable plotting checkbox change.

        Args:
            state: The new checkbox state
        """
        from PyQt6.QtCore import Qt

        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Enable plotting changed to: {checked}")
        self.options.enable_plotting = checked
        self.options_updated.emit()

    def _on_select_app_codebook(self) -> None:
        """
        Open a dialog to select the app codebook file (CSV).
        """
        from PyQt6.QtWidgets import QFileDialog

        file, _ = QFileDialog.getOpenFileName(
            self,
            "Select App Codebook File",
            "",
            "App Codebook Files (*.csv, *.xlsx)",
        )
        if file:
            self.options.app_codebook_path = file
            self.options_updated.emit()

    def set_timezones(self, timezones: list[str]) -> None:
        """
        Set the available timezones in the dropdown.

        Args:
            timezones: List of timezone strings
        """
        LOGGER.debug(f"Setting {len(timezones)} timezones")
        self.options.available_timezones = timezones.copy()
        # Make sure custom_timezones exists
        if not hasattr(self.options, "custom_timezones"):
            self.options.custom_timezones = []
        # Update dropdown with both available and custom timezones
        self.update_timezone_dropdown()

    def set_selected_timezone(self, timezone: str) -> None:
        """
        Set the selected timezone.

        Args:
            timezone: The timezone to select
        """
        LOGGER.debug(f"Setting selected timezone to: {timezone}")
        self.options.selected_timezone = timezone
        self.update_timezone_dropdown()

    def set_timezone_handling_option(self, option: TimezoneHandlingOption) -> None:
        """
        Set the timezone handling option.

        Args:
            option: The timezone handling option to select
        """
        LOGGER.debug(f"Setting timezone handling option to: {option}")
        if option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE:
            self.remove_all_without_timezone_radio.setChecked(True)
        elif option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE:
            self.convert_all_to_timezone_radio.setChecked(True)
        elif option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE:
            self.remove_all_without_primary_timezone_radio.setChecked(True)
        elif option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE:
            self.convert_all_to_primary_timezone_radio.setChecked(True)

        # Show/hide timezone selection based on option
        is_per_file_option = (
            option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE
            or option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE
        )

        self.timezone_selection_label.setVisible(not is_per_file_option)
        self.timezone_selection_dropdown.setVisible(not is_per_file_option)

    def disable_during_processing(self) -> None:
        """
        Disable all UI elements during processing.
        """
        # Always disable radio buttons
        self.remove_all_without_timezone_radio.setEnabled(False)
        self.convert_all_to_timezone_radio.setEnabled(False)
        self.remove_all_without_primary_timezone_radio.setEnabled(False)
        self.convert_all_to_primary_timezone_radio.setEnabled(False)

        # Only disable dropdown if it's visible (not in per-file mode)
        if self.timezone_selection_dropdown.isVisible():
            self.timezone_selection_dropdown.setEnabled(False)

        self.configure_same_app_interaction_types_button.setEnabled(False)
        self.configure_other_interaction_types_button.setEnabled(False)
        self.configure_interaction_types_to_remove_button.setEnabled(False)

    def enable_after_processing(self) -> None:
        """
        Enable all UI elements after processing.
        """
        # Always enable radio buttons
        self.remove_all_without_timezone_radio.setEnabled(True)
        self.convert_all_to_timezone_radio.setEnabled(True)
        self.remove_all_without_primary_timezone_radio.setEnabled(True)
        self.convert_all_to_primary_timezone_radio.setEnabled(True)

        # Only enable dropdown if it's visible (not in per-file mode)
        if self.timezone_selection_dropdown.isVisible():
            self.timezone_selection_dropdown.setEnabled(True)

        self.configure_same_app_interaction_types_button.setEnabled(True)
        self.configure_other_interaction_types_button.setEnabled(True)
        self.configure_interaction_types_to_remove_button.setEnabled(True)
