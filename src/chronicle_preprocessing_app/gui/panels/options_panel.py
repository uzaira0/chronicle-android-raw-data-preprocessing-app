"""
Options panel component for Chronicle Android Raw Data Preprocessing Application.
This panel provides UI controls for timezone and interaction settings.
"""

from __future__ import annotations

import logging

from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QButtonGroup,
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from chronicle_preprocessing_app.config.constants import DialogMessage, TimezoneHandlingOption
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing import TimezonePreprocessor
from chronicle_preprocessing_app.gui.dialogs.interaction_dialogs import (
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

    def __init__(
        self,
        options: PreprocessingOptions,
        parent: QWidget | None = None,
        scale_factor: float = 1.0,
    ) -> None:
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

        # Create algorithm settings group
        self._setup_algorithm_settings_group()
        main_layout.addWidget(self.algorithm_settings_group)

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
            self.remove_all_without_timezone_radio,
            TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE.value,
        )
        self.timezone_option_button_group.addButton(
            self.convert_all_to_timezone_radio,
            TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE.value,
        )
        self.timezone_option_button_group.addButton(
            self.remove_all_without_primary_timezone_radio,
            TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE.value,
        )
        self.timezone_option_button_group.addButton(
            self.convert_all_to_primary_timezone_radio,
            TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE.value,
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

    def _setup_algorithm_settings_group(self) -> None:
        """
        Set up the algorithm settings group for app usage processing options.
        """
        self.algorithm_settings_group = QGroupBox("Algorithm Settings")
        algorithm_layout = QVBoxLayout()

        # Stop event reuse handling
        stop_reuse_label = QLabel("Stop Event Reuse Handling:")
        stop_reuse_label.setStyleSheet("font-weight: bold;")
        algorithm_layout.addWidget(stop_reuse_label)

        self.stop_reuse_button_group = QButtonGroup()

        # Create radio buttons for stop reuse handling
        self.allow_stop_reuse_radio = QRadioButton("Allow stop event reuse (original behavior - faster, may match one stop to multiple resumes)")
        self.prevent_stop_reuse_radio = QRadioButton("Prevent stop event reuse (improved accuracy - each stop matches only one resume)")

        # Set initial state based on options
        if self.options.allow_stop_event_reuse:
            self.allow_stop_reuse_radio.setChecked(True)
        else:
            self.prevent_stop_reuse_radio.setChecked(True)

        # Add radio buttons to button group
        self.stop_reuse_button_group.addButton(self.allow_stop_reuse_radio, 0)
        self.stop_reuse_button_group.addButton(self.prevent_stop_reuse_radio, 1)

        # Connect signal
        self.stop_reuse_button_group.idToggled.connect(self._on_stop_reuse_changed)

        # Add to layout
        algorithm_layout.addWidget(self.allow_stop_reuse_radio)
        algorithm_layout.addWidget(self.prevent_stop_reuse_radio)
        algorithm_layout.addSpacing(10)

        # Activity Stopped fallback option
        fallback_label = QLabel("Activity Stopped Fallback:")
        fallback_label.setStyleSheet("font-weight: bold;")
        algorithm_layout.addWidget(fallback_label)

        self.activity_stopped_fallback_checkbox = QCheckBox("Use Activity Stopped as fallback stop event (when other stops exceed threshold)")
        self.activity_stopped_fallback_checkbox.setToolTip(
            "When enabled, Activity Stopped events are used as a fallback to end usage sessions "
            "when configured stop events (Activity Paused, Activity Resumed, etc.) exceed the "
            "long duration threshold. When disabled, only explicitly configured stop events are used."
        )
        self.activity_stopped_fallback_checkbox.setChecked(self.options.use_activity_stopped_as_fallback)
        self.activity_stopped_fallback_checkbox.stateChanged.connect(self._on_activity_stopped_fallback_changed)
        algorithm_layout.addWidget(self.activity_stopped_fallback_checkbox)

        # Apply threshold to Activity Stopped fallback option
        self.apply_threshold_to_fallback_checkbox = QCheckBox("Apply threshold to Activity Stopped fallback")
        self.apply_threshold_to_fallback_checkbox.setToolTip(
            "When enabled (recommended), the long duration threshold is also applied to Activity Stopped "
            "events used as fallback. This prevents unrealistic long sessions. "
            "When disabled (legacy behavior), Activity Stopped is used without threshold check."
        )
        self.apply_threshold_to_fallback_checkbox.setChecked(self.options.apply_threshold_to_activity_stopped_fallback)
        self.apply_threshold_to_fallback_checkbox.stateChanged.connect(self._on_apply_threshold_to_fallback_changed)
        algorithm_layout.addWidget(self.apply_threshold_to_fallback_checkbox)

        # Long duration threshold setting (only visible when apply_threshold_to_fallback is checked)
        self.threshold_layout_widget = QWidget()
        threshold_layout = QHBoxLayout(self.threshold_layout_widget)
        threshold_layout.setContentsMargins(20, 0, 0, 0)  # Indent to show it's related to checkbox
        threshold_desc_label = QLabel("Maximum session duration:")
        threshold_layout.addWidget(threshold_desc_label)

        self.long_duration_threshold_spinbox = QDoubleSpinBox()
        self.long_duration_threshold_spinbox.setRange(1.0, 48.0)
        self.long_duration_threshold_spinbox.setSingleStep(0.5)
        self.long_duration_threshold_spinbox.setValue(self.options.long_duration_threshold_hours)
        self.long_duration_threshold_spinbox.setSuffix(" hours")
        self.long_duration_threshold_spinbox.setToolTip(
            "Maximum duration for valid app usage sessions. Sessions exceeding this threshold "
            "are considered unrealistic and are capped or closed using fallback stop events."
        )
        self.long_duration_threshold_spinbox.valueChanged.connect(self._on_long_duration_threshold_changed)
        threshold_layout.addWidget(self.long_duration_threshold_spinbox)
        threshold_layout.addStretch()
        algorithm_layout.addWidget(self.threshold_layout_widget)
        # Set initial visibility based on checkbox state
        self.threshold_layout_widget.setVisible(self.options.apply_threshold_to_activity_stopped_fallback)
        algorithm_layout.addSpacing(10)

        # Parallel processing settings
        parallel_label = QLabel("Parallel Processing:")
        parallel_label.setStyleSheet("font-weight: bold;")
        algorithm_layout.addWidget(parallel_label)

        self.parallel_processing_checkbox = QCheckBox("Enable parallel file processing")
        self.parallel_processing_checkbox.setChecked(self.options.parallel_processing)
        self.parallel_processing_checkbox.stateChanged.connect(self._on_parallel_processing_changed)
        algorithm_layout.addWidget(self.parallel_processing_checkbox)

        # Worker count setting
        workers_layout = QHBoxLayout()
        workers_desc_label = QLabel("Max parallel workers:")
        workers_layout.addWidget(workers_desc_label)

        self.parallel_workers_spinbox = QSpinBox()
        self.parallel_workers_spinbox.setRange(0, 32)
        self.parallel_workers_spinbox.setSpecialValueText("Auto")
        self.parallel_workers_spinbox.setValue(self.options.parallel_max_workers or 0)
        self.parallel_workers_spinbox.setToolTip(
            "Maximum number of parallel worker processes. 'Auto' uses half of CPU cores. Lower this if preprocessing competes with other work."
        )
        self.parallel_workers_spinbox.valueChanged.connect(self._on_parallel_workers_changed)
        self.parallel_workers_spinbox.setEnabled(self.options.parallel_processing)
        workers_layout.addWidget(self.parallel_workers_spinbox)
        workers_layout.addStretch()
        algorithm_layout.addLayout(workers_layout)

        self.algorithm_settings_group.setLayout(algorithm_layout)

    def _on_stop_reuse_changed(self, button_id: int, checked: bool) -> None:
        """
        Handle stop event reuse option change.

        Args:
            button_id: The ID of the button that was toggled
            checked: Whether the button is now checked
        """
        if checked:
            # button_id 0 = allow reuse, button_id 1 = prevent reuse
            self.options.allow_stop_event_reuse = button_id == 0
            LOGGER.debug(f"Stop event reuse changed to: {'allowed' if button_id == 0 else 'prevented'}")
            self.options_updated.emit()

    def _on_long_duration_threshold_changed(self, value: float) -> None:
        """
        Handle long duration threshold spinbox change.

        Args:
            value: The new threshold value in hours
        """
        self.options.long_duration_threshold_hours = value
        LOGGER.debug(f"Long duration threshold changed to: {value} hours")
        self.options_updated.emit()

    def _on_activity_stopped_fallback_changed(self, state: int) -> None:
        """
        Handle Activity Stopped fallback checkbox change.

        Args:
            state: The new checkbox state
        """
        from PyQt6.QtCore import Qt

        checked = state == Qt.CheckState.Checked.value
        self.options.use_activity_stopped_as_fallback = checked
        LOGGER.debug(f"Activity Stopped fallback changed to: {'enabled' if checked else 'disabled'}")
        self.options_updated.emit()

    def _on_apply_threshold_to_fallback_changed(self, state: int) -> None:
        """
        Handle apply threshold to Activity Stopped fallback checkbox change.

        Args:
            state: The new checkbox state
        """
        from PyQt6.QtCore import Qt

        checked = state == Qt.CheckState.Checked.value
        self.options.apply_threshold_to_activity_stopped_fallback = checked
        # Show/hide the threshold spinbox based on checkbox state
        self.threshold_layout_widget.setVisible(checked)
        LOGGER.debug(f"Apply threshold to Activity Stopped fallback changed to: {'enabled' if checked else 'disabled'}")
        self.options_updated.emit()

    def _on_parallel_processing_changed(self, state: int) -> None:
        """
        Handle parallel processing checkbox change.

        Args:
            state: The new checkbox state
        """
        from PyQt6.QtCore import Qt

        checked = state == Qt.CheckState.Checked.value
        self.options.parallel_processing = checked
        # Enable/disable the workers spinbox based on parallel processing state
        self.parallel_workers_spinbox.setEnabled(checked)
        LOGGER.debug(f"Parallel processing changed to: {'enabled' if checked else 'disabled'}")
        self.options_updated.emit()

    def _on_parallel_workers_changed(self, value: int) -> None:
        """
        Handle parallel workers spinbox change.

        Args:
            value: The new worker count value
        """
        self.options.parallel_max_workers = value if value > 0 else None
        LOGGER.debug(f"Parallel max workers changed to: {self.options.parallel_max_workers if self.options.parallel_max_workers else 'auto'}")
        self.options_updated.emit()

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

            QMessageBox.information(
                self.window(),
                "Timezones Found",
                f"Found {len(timezones)} timezones in the raw data files.",
            )

        except Exception as e:
            LOGGER.exception(msg="Error finding timezones")
            QMessageBox.critical(self.window(), "Error", text=f"Failed to find timezones: {e!s}")

    def _on_configure_same_app_interaction_types(self) -> None:
        """
        Open dialog to configure same app interaction types.
        """
        from chronicle_preprocessing_app.gui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

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
        from chronicle_preprocessing_app.gui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

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
        from chronicle_preprocessing_app.gui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

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

        # Disable algorithm settings
        self.allow_stop_reuse_radio.setEnabled(False)
        self.prevent_stop_reuse_radio.setEnabled(False)
        self.activity_stopped_fallback_checkbox.setEnabled(False)
        self.apply_threshold_to_fallback_checkbox.setEnabled(False)
        self.long_duration_threshold_spinbox.setEnabled(False)
        self.parallel_processing_checkbox.setEnabled(False)
        self.parallel_workers_spinbox.setEnabled(False)

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

        # Enable algorithm settings
        self.allow_stop_reuse_radio.setEnabled(True)
        self.prevent_stop_reuse_radio.setEnabled(True)
        self.activity_stopped_fallback_checkbox.setEnabled(True)
        self.apply_threshold_to_fallback_checkbox.setEnabled(True)
        self.long_duration_threshold_spinbox.setEnabled(True)
        self.parallel_processing_checkbox.setEnabled(True)
        # Only enable workers spinbox if parallel processing is enabled
        self.parallel_workers_spinbox.setEnabled(self.options.parallel_processing)
