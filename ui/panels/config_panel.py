"""
Configuration panel component for Chronicle Android Raw Data Preprocessing Application.
This panel provides UI controls for configuration settings.
"""

from __future__ import annotations

import logging
from pathlib import Path

from PyQt6.QtCore import QSize, Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from config.constants import DEFAULT_APPS_TO_FILTER_FILE_PATH, DEFAULT_MINIMUM_USAGE_DURATION
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions

LOGGER = logging.getLogger(__name__)


class ConfigPanel(QWidget):
    """
    Panel for configuration settings in the Chronicle Android Raw Data Preprocessing Application.
    This panel provides UI controls for configuring study name, folder paths,
    duration settings, and other preprocessing options.
    """

    # Signals
    raw_data_folder_changed = pyqtSignal(str)
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

        # Create configuration group
        self.config_group = QGroupBox("Configuration")
        config_layout = QVBoxLayout()

        # Create form layout for text fields, etc.
        form_layout = QFormLayout()
        form_layout.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)

        # Study name input
        self.study_name_input = QLineEdit()
        self.study_name_input.setFixedHeight(int(26 * self.scale_factor))
        self.study_name_input.textChanged.connect(self._on_study_name_changed)
        form_layout.addRow("Study Name:", self.study_name_input)

        # Raw data folder with browse button
        raw_data_layout = QHBoxLayout()
        self.raw_data_folder_display = QLineEdit()
        self.raw_data_folder_display.setReadOnly(True)
        self.raw_data_folder_display.setFixedHeight(int(26 * self.scale_factor))
        self.raw_data_folder_button = QPushButton("Browse...")
        self.raw_data_folder_button.setFixedSize(QSize(int(80 * self.scale_factor), int(26 * self.scale_factor)))
        self.raw_data_folder_button.clicked.connect(self._on_select_raw_data_folder)
        raw_data_layout.addWidget(self.raw_data_folder_display)
        raw_data_layout.addWidget(self.raw_data_folder_button)
        form_layout.addRow("Raw Data Folder:", raw_data_layout)

        # Add the form layout to the main config layout
        config_layout.addLayout(form_layout)

        # Label filtered apps checkbox
        self.label_filtered_apps_checkbox = QCheckBox("Label and Do Not Calculate Duration for Apps in 'Apps to Filter' File")
        self.label_filtered_apps_checkbox.setChecked(self.options.use_filter_file)
        self.label_filtered_apps_checkbox.stateChanged.connect(self._on_use_filter_changed)
        config_layout.addWidget(self.label_filtered_apps_checkbox)

        # Filter file section (only shown when checkbox is checked)
        self.filter_file_widget = QWidget()
        filter_file_layout = QHBoxLayout(self.filter_file_widget)
        filter_file_layout.setContentsMargins(0, 0, 0, 0)

        filter_file_label = QLabel("Filter File:")
        filter_file_layout.addWidget(filter_file_label)

        self.filter_file_display = QLineEdit()
        self.filter_file_display.setReadOnly(True)
        self.filter_file_display.setFixedHeight(int(26 * self.scale_factor))

        self.filter_file_button = QPushButton("Browse...")
        self.filter_file_button.setFixedSize(QSize(int(80 * self.scale_factor), int(26 * self.scale_factor)))
        self.filter_file_button.clicked.connect(self._on_select_filter_file)

        filter_file_layout.addWidget(self.filter_file_display)
        filter_file_layout.addWidget(self.filter_file_button)

        # Add filter file widget to main layout and hide it initially
        config_layout.addWidget(self.filter_file_widget)
        self.filter_file_widget.setVisible(self.options.use_filter_file)

        # Add second form layout for numeric fields
        form_layout2 = QFormLayout()
        form_layout2.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)

        # Minimum usage duration
        self.minimum_usage_duration_input = QSpinBox()
        self.minimum_usage_duration_input.setMinimum(DEFAULT_MINIMUM_USAGE_DURATION)
        self.minimum_usage_duration_input.setMaximum(3600)
        self.minimum_usage_duration_input.setValue(self.options.minimum_usage_duration)
        self.minimum_usage_duration_input.valueChanged.connect(self._on_minimum_usage_duration_changed)
        form_layout2.addRow("Minimum Duration Required for an Instance of App Usage to be Counted (s):", self.minimum_usage_duration_input)

        # Custom app engagement duration
        self.custom_app_engagement_duration_input = QSpinBox()
        self.custom_app_engagement_duration_input.setMinimum(1)
        self.custom_app_engagement_duration_input.setMaximum(3600)
        self.custom_app_engagement_duration_input.setValue(self.options.custom_app_engagement_duration)
        self.custom_app_engagement_duration_input.valueChanged.connect(self._on_custom_app_engagement_duration_changed)
        form_layout2.addRow("Custom App Engagement Duration (s):", self.custom_app_engagement_duration_input)

        # Long usage duration thresholds
        self.long_usage_duration_thresholds_input = QLineEdit()
        self.long_usage_duration_thresholds_input.setText(", ".join(str(threshold) for threshold in self.options.long_usage_duration_thresholds))
        self.long_usage_duration_thresholds_input.textChanged.connect(self._on_long_usage_duration_thresholds_changed)
        form_layout2.addRow("Long Usage Duration Thresholds (hrs) (for flags):", self.long_usage_duration_thresholds_input)

        # Long data time gap thresholds
        self.long_data_time_gap_thresholds_input = QLineEdit()
        self.long_data_time_gap_thresholds_input.setText(", ".join(str(threshold) for threshold in self.options.long_data_time_gap_thresholds))
        self.long_data_time_gap_thresholds_input.textChanged.connect(self._on_long_data_time_gap_thresholds_changed)
        form_layout2.addRow("Long Data Time Gap Thresholds (hrs) (for flags):", self.long_data_time_gap_thresholds_input)

        # Add second form layout to config layout
        config_layout.addLayout(form_layout2)

        # Correct Duplicate Event Timestamps checkbox at the bottom
        self.correct_duplicate_event_timestamps_checkbox = QCheckBox("Correct Duplicate Event Timestamps")
        self.correct_duplicate_event_timestamps_checkbox.setChecked(self.options.correct_duplicate_event_timestamps)
        self.correct_duplicate_event_timestamps_checkbox.stateChanged.connect(self._on_correct_duplicate_event_timestamps_changed)
        config_layout.addWidget(self.correct_duplicate_event_timestamps_checkbox)

        # Survey data options (internal functionality)
        self._setup_survey_data_section(config_layout)

        # Set the config group layout
        self.config_group.setLayout(config_layout)

        # Add config group to main layout
        main_layout.addWidget(self.config_group)

        # Apply layout
        self.setLayout(main_layout)

        # Initialize tooltips for file paths
        if self.options.raw_data_folder:
            self._display_path_with_elide(self.raw_data_folder_display, str(self.options.raw_data_folder))
        if self.options.filter_file:
            self._display_path_with_elide(self.filter_file_display, str(self.options.filter_file))

    def _on_use_filter_changed(self, state: int) -> None:
        """
        Handle use filter checkbox change.

        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Use filter changed to: {checked}")
        self.options.use_filter_file = checked

        # Show/hide the filter file widget based on checkbox state
        self.filter_file_widget.setVisible(checked)

        # If enabled and no filter file is set, use the default
        if checked and not self.options.filter_file:
            # Convert relative path to absolute path
            default_path = str(Path(DEFAULT_APPS_TO_FILTER_FILE_PATH).absolute())
            self.options.filter_file = default_path
            self._display_path_with_elide(self.filter_file_display, default_path)

            # Try to load the default filter file
            try:
                from utils.file_utils import read_filter_file

                if Path(default_path).exists():
                    self.options.apps_to_filter_dict = read_filter_file(default_path)
                    LOGGER.info(f"Loaded {len(self.options.apps_to_filter_dict)} app filters from {default_path}")
            except Exception:
                LOGGER.exception("Error loading default filter file")

        self.options_updated.emit()

    def _on_study_name_changed(self, text: str | None = None) -> None:
        """
        Handle study name input change.

        Args:
            text: The new study name (optional, will use current text value if None)
        """
        if text is None:
            text = self.study_name_input.text()

        LOGGER.debug(f"Study name changed to: {text}")
        self.options.study_name = text
        self.options_updated.emit()

    def _on_select_raw_data_folder(self) -> None:
        """
        Open a dialog to select the raw data folder.
        """
        folder = QFileDialog.getExistingDirectory(self, "Select Raw Data Folder")
        if folder:
            self._display_path_with_elide(self.raw_data_folder_display, folder)
            self.options.raw_data_folder = folder
            self.raw_data_folder_changed.emit(folder)
            self.options_updated.emit()

    def _on_select_filter_file(self) -> None:
        """
        Open a dialog to select the filter file.
        """
        file, _ = QFileDialog.getOpenFileName(self, "Select Filter File", "", "Filter Files (*.csv *.xlsx)")
        if file:
            self._display_path_with_elide(self.filter_file_display, file)
            self.options.filter_file = file
            self.options_updated.emit()

            # Load the filter file
            try:
                from utils.file_utils import read_filter_file

                self.options.apps_to_filter_dict = read_filter_file(file)
                LOGGER.info(f"Loaded {len(self.options.apps_to_filter_dict)} app filters from {file}")
            except Exception:
                LOGGER.exception("Error loading filter file")

    def _on_minimum_usage_duration_changed(self, value: int) -> None:
        """
        Handle minimum usage duration change.

        Args:
            value: The new minimum usage duration
        """
        LOGGER.debug(f"Minimum usage duration changed to: {value}")
        self.options.minimum_usage_duration = value
        self.options_updated.emit()

    def _on_custom_app_engagement_duration_changed(self, value: int) -> None:
        """
        Handle custom app engagement duration change.

        Args:
            value: The new custom app engagement duration
        """
        LOGGER.debug(f"Custom app engagement duration changed to: {value}")
        self.options.custom_app_engagement_duration = value
        self.options_updated.emit()

    def _on_long_usage_duration_thresholds_changed(self) -> None:
        """
        Handle long usage duration thresholds change.
        """
        thresholds_text = self.long_usage_duration_thresholds_input.text().strip()
        if thresholds_text:
            try:
                thresholds = [int(float(threshold.strip())) for threshold in thresholds_text.split(",") if threshold.strip()]
                LOGGER.debug(f"Long usage duration thresholds changed to: {thresholds}")
                self.options.long_usage_duration_thresholds = thresholds
                self.options_updated.emit()
            except ValueError:
                LOGGER.warning(f"Invalid long usage duration thresholds: {thresholds_text}")
                # Set default values
                self.options.long_usage_duration_thresholds = [3, 6, 12, 24]
                self.long_usage_duration_thresholds_input.setText("3, 6, 12, 24")
        else:
            # Set default values
            self.options.long_usage_duration_thresholds = [3, 6, 12, 24]
            self.long_usage_duration_thresholds_input.setText("3, 6, 12, 24")
            self.options_updated.emit()

    def _on_long_data_time_gap_thresholds_changed(self) -> None:
        """
        Handle long data time gap thresholds change.
        """
        thresholds_text = self.long_data_time_gap_thresholds_input.text().strip()
        if thresholds_text:
            try:
                thresholds = [int(float(threshold.strip())) for threshold in thresholds_text.split(",") if threshold.strip()]
                LOGGER.debug(f"Long data time gap thresholds changed to: {thresholds}")
                self.options.long_data_time_gap_thresholds = thresholds
                self.options_updated.emit()
            except ValueError:
                LOGGER.warning(f"Invalid long data time gap thresholds: {thresholds_text}")
                # Set default values
                self.options.long_data_time_gap_thresholds = [3, 6, 12, 24]
                self.long_data_time_gap_thresholds_input.setText("3, 6, 12, 24")
        else:
            # Set default values
            self.options.long_data_time_gap_thresholds = [3, 6, 12, 24]
            self.long_data_time_gap_thresholds_input.setText("3, 6, 12, 24")
            self.options_updated.emit()

    def _on_correct_duplicate_event_timestamps_changed(self, state: int) -> None:
        """
        Handle correct duplicate event timestamps change.

        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Correct duplicate event timestamps changed to: {checked}")
        self.options.correct_duplicate_event_timestamps = checked
        self.options_updated.emit()

    def _check_internal_modules_available(self) -> bool:
        """
        Check if internal survey data modules are available.
        
        Returns:
            bool: True if internal modules are available, False otherwise
        """
        try:
            # Try to import the survey data preprocessor
            LOGGER.debug("Checking internal modules availability - attempting SurveyDataPreprocessor import")
            from preprocessors.survey_data_preprocessor import SurveyDataPreprocessor
            LOGGER.debug("SurveyDataPreprocessor import successful")
            
            # Also try to import key internal dependencies to ensure full functionality
            LOGGER.debug("Attempting P01_classes import")
            from internal.P01_classes import DeviceSharingStatus, ParticipantID, TrackingSheet
            LOGGER.debug("P01_classes import successful")
            
            LOGGER.debug("Attempting P01_utils_functions import")
            from internal.P01_utils_functions import write_df_to_excel_and_format
            LOGGER.debug("P01_utils_functions import successful")
            
            LOGGER.debug("All internal module imports successful - internal functionality will be available")
            return True
        except ImportError as e:
            LOGGER.debug(f"Internal module import failed: {e} - internal functionality will be hidden")
            return False

    def _setup_survey_data_section(self, layout: QVBoxLayout) -> None:
        """
        Set up the survey data options section (internal functionality).
        Only shown if internal modules are available.
        
        Args:
            layout: The layout to add the survey data section to
        """
        LOGGER.debug("_setup_survey_data_section called - checking internal module availability")
        # Check if internal modules are available
        if not self._check_internal_modules_available():
            LOGGER.debug("Internal survey data functionality not available - hiding survey options")
            return
        
        LOGGER.debug("Internal modules available - setting up survey data UI components")
            
        # Survey data checkbox
        self.use_survey_data_checkbox = QCheckBox("Enable Survey Data Processing (Internal Research)")
        self.use_survey_data_checkbox.setChecked(getattr(self.options, 'use_survey_data', False))
        self.use_survey_data_checkbox.stateChanged.connect(self._on_use_survey_data_changed)
        layout.addWidget(self.use_survey_data_checkbox)
        
        # Survey data folder section (only shown when checkbox is checked)
        self.survey_data_widget = QWidget()
        survey_data_layout = QHBoxLayout(self.survey_data_widget)
        survey_data_layout.setContentsMargins(0, 0, 0, 0)
        
        survey_data_label = QLabel("Survey Data Folder:")
        survey_data_layout.addWidget(survey_data_label)
        
        self.survey_data_folder_display = QLineEdit()
        self.survey_data_folder_display.setReadOnly(True)
        self.survey_data_folder_display.setFixedHeight(int(26 * self.scale_factor))
        
        self.survey_data_folder_button = QPushButton("Browse...")
        self.survey_data_folder_button.setFixedSize(QSize(int(80 * self.scale_factor), int(26 * self.scale_factor)))
        self.survey_data_folder_button.clicked.connect(self._on_select_survey_data_folder)
        
        survey_data_layout.addWidget(self.survey_data_folder_display)
        survey_data_layout.addWidget(self.survey_data_folder_button)
        
        # Add survey data widget to main layout
        layout.addWidget(self.survey_data_widget)
        self.survey_data_widget.setVisible(getattr(self.options, 'use_survey_data', False))
        
        # Compliance reporting checkbox
        self.compliance_reporting_checkbox = QCheckBox("Generate Compliance Reports (for Shared Devices)")
        self.compliance_reporting_checkbox.setChecked(getattr(self.options, 'compliance_reporting', False))
        self.compliance_reporting_checkbox.stateChanged.connect(self._on_compliance_reporting_changed)
        layout.addWidget(self.compliance_reporting_checkbox)
        self.compliance_reporting_checkbox.setVisible(getattr(self.options, 'use_survey_data', False))
        
        # Initialize survey data folder display if set
        if hasattr(self.options, 'survey_data_folder') and self.options.survey_data_folder:
            self._display_path_with_elide(self.survey_data_folder_display, str(self.options.survey_data_folder))

    def _on_use_survey_data_changed(self, state: int) -> None:
        """
        Handle use survey data checkbox change.
        
        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Use survey data changed to: {checked}")
        
        # Set the option (create if it doesn't exist)
        if not hasattr(self.options, 'use_survey_data'):
            self.options.use_survey_data = False
        self.options.use_survey_data = checked
        
        # Show/hide the survey data folder widget and compliance checkbox
        if hasattr(self, 'survey_data_widget'):
            self.survey_data_widget.setVisible(checked)
        if hasattr(self, 'compliance_reporting_checkbox'):
            self.compliance_reporting_checkbox.setVisible(checked)
        
        self.options_updated.emit()

    def _on_select_survey_data_folder(self) -> None:
        """
        Open a dialog to select the survey data folder.
        """
        folder = QFileDialog.getExistingDirectory(self, "Select Survey Data Folder")
        if folder:
            self._display_path_with_elide(self.survey_data_folder_display, folder)
            
            # Set the option (create if it doesn't exist)
            if not hasattr(self.options, 'survey_data_folder'):
                self.options.survey_data_folder = ""
            self.options.survey_data_folder = folder
            
            self.options_updated.emit()

    def _on_compliance_reporting_changed(self, state: int) -> None:
        """
        Handle compliance reporting checkbox change.
        
        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Compliance reporting changed to: {checked}")
        
        # Set the option (create if it doesn't exist)
        if not hasattr(self.options, 'compliance_reporting'):
            self.options.compliance_reporting = False
        self.options.compliance_reporting = checked
        
        self.options_updated.emit()

    def _display_path_with_elide(self, line_edit: QLineEdit, path: str) -> None:
        """
        Display a path in a line edit with elided text and tooltip.

        Args:
            line_edit: The QLineEdit to update
            path: The path to display
        """
        if not path:
            return

        # Always set the tooltip to show full path on hover
        line_edit.setToolTip(path)

        # Set the full text (tooltip will ensure user can see the full path)
        line_edit.setText(path)

    def set_study_name(self, name: str) -> None:
        """
        Set the study name input.

        Args:
            name: The study name to set
        """
        self.study_name_input.setText(name)

    def set_raw_data_folder(self, folder: str) -> None:
        """
        Set the raw data folder field.

        Args:
            folder: The folder path to set
        """
        if folder:
            self._display_path_with_elide(self.raw_data_folder_display, folder)
            self.options.raw_data_folder = folder

    def set_filter_file(self, file: str) -> None:
        """
        Set the filter file display.

        Args:
            file: The file path to set
        """
        if file:
            self._display_path_with_elide(self.filter_file_display, file)

    def set_minimum_usage_duration(self, duration: int) -> None:
        """
        Set the minimum usage duration input.

        Args:
            duration: The duration value to set
        """
        self.minimum_usage_duration_input.setValue(duration)

    def set_custom_app_engagement_duration(self, duration: int) -> None:
        """
        Set the custom app engagement duration input.

        Args:
            duration: The duration value to set
        """
        self.custom_app_engagement_duration_input.setValue(duration)

    def set_long_usage_duration_thresholds(self, thresholds: list[int]) -> None:
        """
        Set the long usage duration thresholds input.

        Args:
            thresholds: The list of threshold values to set
        """
        self.long_usage_duration_thresholds_input.setText(", ".join(str(threshold) for threshold in thresholds))

    def set_long_data_time_gap_thresholds(self, thresholds: list[int]) -> None:
        """
        Set the long data time gap thresholds input.

        Args:
            thresholds: The list of threshold values to set
        """
        self.long_data_time_gap_thresholds_input.setText(", ".join(str(threshold) for threshold in thresholds))

    def set_correct_duplicate_event_timestamps(self, checked: bool) -> None:
        """
        Set the correct duplicate event timestamps checkbox.

        Args:
            checked: Whether the checkbox should be checked
        """
        self.correct_duplicate_event_timestamps_checkbox.setChecked(checked)

    def set_use_filter_file(self, checked: bool) -> None:
        """
        Set the use filter file checkbox.

        Args:
            checked: Whether the checkbox should be checked
        """
        self.label_filtered_apps_checkbox.setChecked(checked)
        self.filter_file_widget.setVisible(checked)
        self.options.use_filter_file = checked

    def disable_during_processing(self) -> None:
        """
        Disable all interactive elements during processing.
        """
        self.study_name_input.setEnabled(False)
        self.raw_data_folder_button.setEnabled(False)
        self.label_filtered_apps_checkbox.setEnabled(False)
        self.filter_file_button.setEnabled(False)
        self.minimum_usage_duration_input.setEnabled(False)
        self.custom_app_engagement_duration_input.setEnabled(False)
        self.long_usage_duration_thresholds_input.setEnabled(False)
        self.long_data_time_gap_thresholds_input.setEnabled(False)
        self.correct_duplicate_event_timestamps_checkbox.setEnabled(False)
        
        # Disable survey data elements if they exist
        if hasattr(self, 'use_survey_data_checkbox'):
            self.use_survey_data_checkbox.setEnabled(False)
        if hasattr(self, 'survey_data_folder_button'):
            self.survey_data_folder_button.setEnabled(False)
        if hasattr(self, 'compliance_reporting_checkbox'):
            self.compliance_reporting_checkbox.setEnabled(False)

    def enable_after_processing(self) -> None:
        """
        Enable all interactive elements after processing is complete.
        """
        self.study_name_input.setEnabled(True)
        self.raw_data_folder_button.setEnabled(True)
        self.label_filtered_apps_checkbox.setEnabled(True)
        self.filter_file_button.setEnabled(True)
        self.minimum_usage_duration_input.setEnabled(True)
        self.custom_app_engagement_duration_input.setEnabled(True)
        self.long_usage_duration_thresholds_input.setEnabled(True)
        self.long_data_time_gap_thresholds_input.setEnabled(True)
        self.correct_duplicate_event_timestamps_checkbox.setEnabled(True)
        
        # Enable survey data elements if they exist
        if hasattr(self, 'use_survey_data_checkbox'):
            self.use_survey_data_checkbox.setEnabled(True)
        if hasattr(self, 'survey_data_folder_button'):
            self.survey_data_folder_button.setEnabled(True)
        if hasattr(self, 'compliance_reporting_checkbox'):
            self.compliance_reporting_checkbox.setEnabled(True)

    def set_use_survey_data(self, checked: bool) -> None:
        """
        Set the use survey data checkbox.
        Only works if internal modules are available.
        
        Args:
            checked: Whether the checkbox should be checked
        """
        if not self._check_internal_modules_available():
            LOGGER.debug("Internal modules not available - ignoring set_use_survey_data")
            return
            
        if hasattr(self, 'use_survey_data_checkbox'):
            self.use_survey_data_checkbox.setChecked(checked)
            # Update visibility of related elements
            if hasattr(self, 'survey_data_widget'):
                self.survey_data_widget.setVisible(checked)
            if hasattr(self, 'compliance_reporting_checkbox'):
                self.compliance_reporting_checkbox.setVisible(checked)

    def set_survey_data_folder(self, folder: str) -> None:
        """
        Set the survey data folder display.
        Only works if internal modules are available.
        
        Args:
            folder: The folder path to set
        """
        if not self._check_internal_modules_available():
            LOGGER.debug("Internal modules not available - ignoring set_survey_data_folder")
            return
            
        if folder and hasattr(self, 'survey_data_folder_display'):
            self._display_path_with_elide(self.survey_data_folder_display, folder)

    def set_compliance_reporting(self, checked: bool) -> None:
        """
        Set the compliance reporting checkbox.
        Only works if internal modules are available.
        
        Args:
            checked: Whether the checkbox should be checked
        """
        if not self._check_internal_modules_available():
            LOGGER.debug("Internal modules not available - ignoring set_compliance_reporting")
            return
            
        if hasattr(self, 'compliance_reporting_checkbox'):
            self.compliance_reporting_checkbox.setChecked(checked)
