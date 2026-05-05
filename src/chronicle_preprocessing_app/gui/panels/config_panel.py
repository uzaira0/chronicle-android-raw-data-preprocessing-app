"""
Configuration panel component for Chronicle Android Raw Data Preprocessing Application.
This panel provides UI controls for configuration settings.
"""

from __future__ import annotations

import logging
from pathlib import Path

from PyQt6.QtCore import QSize, Qt, pyqtSignal
from PyQt6.QtGui import QWheelEvent
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

from chronicle_preprocessing_app.config.constants import UsageSessionMode
from chronicle_preprocessing_app.config.defaults import (
    DEFAULT_APPS_FORCING_SCREEN_OPEN_FILE_PATH,
    DEFAULT_APPS_TO_FILTER_FILE_PATH,
    DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS,
    DEFAULT_LONG_USAGE_DURATION_THRESHOLDS,
    DEFAULT_MINIMUM_USAGE_DURATION,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions

LOGGER = logging.getLogger(__name__)


class FocusOnlySpinBox(QSpinBox):
    """
    QSpinBox that only responds to scroll wheel when explicitly clicked/focused.
    This prevents accidental value changes when scrolling the parent widget.
    Industry standard behavior: user must click the spinbox before scroll wheel works.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # This is critical: prevent the widget from accepting focus from wheel events
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        # Install event filter on self
        self.installEventFilter(self)

    def eventFilter(self, obj, event):
        """Filter events to prevent wheel events from being processed."""
        if obj == self and event.type() == event.Type.Wheel:
            if not self.hasFocus():
                # Block the event completely - don't even pass it to wheelEvent
                event.ignore()
                return True  # Event handled, don't propagate further
        return super().eventFilter(obj, event)

    def wheelEvent(self, event: QWheelEvent) -> None:
        """
        Override wheel event as a backup.
        The eventFilter should catch it first, but this is a safety net.
        """
        if self.hasFocus():
            super().wheelEvent(event)
        else:
            event.ignore()

    def focusInEvent(self, event):
        """Enable scrolling when widget gains focus."""
        super().focusInEvent(event)
        # Select all text when focused for easy editing
        self.selectAll()


class ConfigPanel(QWidget):
    """
    Panel for configuration settings in the Chronicle Android Raw Data Preprocessing Application.
    This panel provides UI controls for configuring study name, folder paths,
    duration settings, and other preprocessing options.
    """

    # Signals
    raw_data_folder_changed = pyqtSignal(str)
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

        self.apps_forcing_screen_open_checkbox = QCheckBox("Use Keep-Awake App File for Screen Usage End-Reason Classification")
        self.apps_forcing_screen_open_checkbox.setChecked(self.options.use_apps_forcing_screen_open_file)
        self.apps_forcing_screen_open_checkbox.stateChanged.connect(self._on_use_apps_forcing_screen_open_changed)
        config_layout.addWidget(self.apps_forcing_screen_open_checkbox)

        self.apps_forcing_screen_open_file_widget = QWidget()
        apps_forcing_screen_open_file_layout = QHBoxLayout(self.apps_forcing_screen_open_file_widget)
        apps_forcing_screen_open_file_layout.setContentsMargins(0, 0, 0, 0)

        apps_forcing_screen_open_file_label = QLabel("Apps-Forcing-Screen-Open File:")
        apps_forcing_screen_open_file_layout.addWidget(apps_forcing_screen_open_file_label)

        self.apps_forcing_screen_open_file_display = QLineEdit()
        self.apps_forcing_screen_open_file_display.setReadOnly(True)
        self.apps_forcing_screen_open_file_display.setFixedHeight(int(26 * self.scale_factor))

        self.apps_forcing_screen_open_file_button = QPushButton("Browse...")
        self.apps_forcing_screen_open_file_button.setFixedSize(QSize(int(80 * self.scale_factor), int(26 * self.scale_factor)))
        self.apps_forcing_screen_open_file_button.clicked.connect(self._on_select_apps_forcing_screen_open_file)

        apps_forcing_screen_open_file_layout.addWidget(self.apps_forcing_screen_open_file_display)
        apps_forcing_screen_open_file_layout.addWidget(self.apps_forcing_screen_open_file_button)

        config_layout.addWidget(self.apps_forcing_screen_open_file_widget)
        self.apps_forcing_screen_open_file_widget.setVisible(self.options.use_apps_forcing_screen_open_file)

        self.app_usage_sessions_checkbox = QCheckBox("Generate App Usage File")
        self.app_usage_sessions_checkbox.setChecked(self.options.process_app_usage_sessions)
        self.app_usage_sessions_checkbox.stateChanged.connect(self._on_usage_session_checkbox_changed)
        config_layout.addWidget(self.app_usage_sessions_checkbox)

        self.screen_usage_sessions_checkbox = QCheckBox("Generate Screen Usage File")
        self.screen_usage_sessions_checkbox.setChecked(self.options.process_screen_usage_sessions)
        self.screen_usage_sessions_checkbox.stateChanged.connect(self._on_usage_session_checkbox_changed)
        config_layout.addWidget(self.screen_usage_sessions_checkbox)

        self.screen_usage_settings_widget = QWidget()
        screen_usage_settings_layout = QFormLayout(self.screen_usage_settings_widget)
        screen_usage_settings_layout.setContentsMargins(0, 0, 0, 0)
        screen_usage_settings_layout.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)

        self.screen_usage_auto_lock_timeout_input = FocusOnlySpinBox()
        self.screen_usage_auto_lock_timeout_input.setMinimum(1)
        self.screen_usage_auto_lock_timeout_input.setMaximum(3600)
        self.screen_usage_auto_lock_timeout_input.setValue(self.options.screen_usage_auto_lock_timeout_seconds)
        self.screen_usage_auto_lock_timeout_input.valueChanged.connect(self._on_screen_usage_auto_lock_timeout_changed)
        screen_usage_settings_layout.addRow(
            "Screen Usage Auto-Lock Timeout (s):",
            self.screen_usage_auto_lock_timeout_input,
        )

        self.screen_usage_auto_lock_tolerance_input = FocusOnlySpinBox()
        self.screen_usage_auto_lock_tolerance_input.setMinimum(0)
        self.screen_usage_auto_lock_tolerance_input.setMaximum(600)
        self.screen_usage_auto_lock_tolerance_input.setValue(self.options.screen_usage_auto_lock_tolerance_seconds)
        self.screen_usage_auto_lock_tolerance_input.valueChanged.connect(self._on_screen_usage_auto_lock_tolerance_changed)
        screen_usage_settings_layout.addRow(
            "Screen Usage Auto-Lock Tolerance (s):",
            self.screen_usage_auto_lock_tolerance_input,
        )

        self.screen_usage_manual_lock_max_tail_gap_input = FocusOnlySpinBox()
        self.screen_usage_manual_lock_max_tail_gap_input.setMinimum(0)
        self.screen_usage_manual_lock_max_tail_gap_input.setMaximum(600)
        self.screen_usage_manual_lock_max_tail_gap_input.setValue(self.options.screen_usage_manual_lock_max_tail_gap_seconds)
        self.screen_usage_manual_lock_max_tail_gap_input.valueChanged.connect(self._on_screen_usage_manual_lock_tail_gap_changed)
        screen_usage_settings_layout.addRow(
            "Screen Usage Manual-Lock Max Tail Gap (s):",
            self.screen_usage_manual_lock_max_tail_gap_input,
        )

        config_layout.addWidget(self.screen_usage_settings_widget)
        self.screen_usage_settings_widget.setVisible(self.options.process_screen_usage_sessions)

        # Add second form layout for numeric fields
        form_layout2 = QFormLayout()
        form_layout2.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)

        # Minimum usage duration
        self.minimum_usage_duration_input = FocusOnlySpinBox()
        self.minimum_usage_duration_input.setMinimum(DEFAULT_MINIMUM_USAGE_DURATION)
        self.minimum_usage_duration_input.setMaximum(3600)
        self.minimum_usage_duration_input.setValue(self.options.minimum_usage_duration)
        self.minimum_usage_duration_input.valueChanged.connect(self._on_minimum_usage_duration_changed)
        form_layout2.addRow(
            "Minimum Duration Required for an Instance of App Usage to be Counted (s):",
            self.minimum_usage_duration_input,
        )

        # Custom app engagement duration
        self.custom_app_engagement_duration_input = FocusOnlySpinBox()
        self.custom_app_engagement_duration_input.setMinimum(1)
        self.custom_app_engagement_duration_input.setMaximum(3600)
        self.custom_app_engagement_duration_input.setValue(self.options.custom_app_engagement_duration)
        self.custom_app_engagement_duration_input.valueChanged.connect(self._on_custom_app_engagement_duration_changed)
        form_layout2.addRow(
            "Custom App Engagement Duration (s):",
            self.custom_app_engagement_duration_input,
        )

        # Long usage duration thresholds
        self.long_usage_duration_thresholds_input = QLineEdit()
        self.long_usage_duration_thresholds_input.setText(", ".join(str(threshold) for threshold in self.options.long_usage_duration_thresholds))
        self.long_usage_duration_thresholds_input.textChanged.connect(self._on_long_usage_duration_thresholds_changed)
        form_layout2.addRow(
            "Long Usage Duration Thresholds (hrs) (for flags):",
            self.long_usage_duration_thresholds_input,
        )

        # Long data time gap thresholds
        self.long_data_time_gap_thresholds_input = QLineEdit()
        self.long_data_time_gap_thresholds_input.setText(", ".join(str(threshold) for threshold in self.options.long_data_time_gap_thresholds))
        self.long_data_time_gap_thresholds_input.textChanged.connect(self._on_long_data_time_gap_thresholds_changed)
        form_layout2.addRow(
            "Long Data Time Gap Thresholds (hrs) (for flags):",
            self.long_data_time_gap_thresholds_input,
        )

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
        if self.options.apps_forcing_screen_open_file:
            self._display_path_with_elide(
                self.apps_forcing_screen_open_file_display,
                str(self.options.apps_forcing_screen_open_file),
            )

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
                from chronicle_preprocessing_app.utils.file_utils import read_filter_file

                if Path(default_path).exists():
                    self.options.apps_to_filter_dict = read_filter_file(default_path)
                    LOGGER.info(f"Loaded {len(self.options.apps_to_filter_dict)} app filters from {default_path}")
            except Exception:
                LOGGER.exception("Error loading default filter file")

        self.options_updated.emit()

    def _on_use_apps_forcing_screen_open_changed(self, state: int) -> None:
        """
        Handle apps-forcing-screen-open file checkbox change.

        Args:
            state: The new checkbox state
        """
        checked = state == Qt.CheckState.Checked.value
        LOGGER.debug(f"Use apps-forcing-screen-open file changed to: {checked}")
        self.options.use_apps_forcing_screen_open_file = checked
        self.apps_forcing_screen_open_file_widget.setVisible(checked)

        if checked and not self.options.apps_forcing_screen_open_file:
            default_path = str(Path(DEFAULT_APPS_FORCING_SCREEN_OPEN_FILE_PATH).absolute())
            self.options.apps_forcing_screen_open_file = default_path
            self._display_path_with_elide(self.apps_forcing_screen_open_file_display, default_path)

            try:
                from chronicle_preprocessing_app.utils.file_utils import (
                    read_apps_forcing_screen_open_file,
                )

                if Path(default_path).exists():
                    self.options.apps_forcing_screen_open_dict = read_apps_forcing_screen_open_file(default_path)
                    LOGGER.info(f"Loaded {len(self.options.apps_forcing_screen_open_dict)} keep-awake apps from {default_path}")
            except Exception:
                LOGGER.exception("Error loading default apps-forcing-screen-open file")

        self.options_updated.emit()

    def _on_usage_session_checkbox_changed(self, _state: int) -> None:
        """
        Handle app/screen usage output checkbox changes.

        Args:
            _state: The changed checkbox state
        """
        if not self.app_usage_sessions_checkbox.isChecked() and not self.screen_usage_sessions_checkbox.isChecked():
            self.app_usage_sessions_checkbox.blockSignals(True)
            self.app_usage_sessions_checkbox.setChecked(True)
            self.app_usage_sessions_checkbox.blockSignals(False)

        self._sync_usage_session_mode_from_checkboxes()
        self.screen_usage_settings_widget.setVisible(self.options.process_screen_usage_sessions)
        LOGGER.debug(f"Usage session mode changed to: {self.options.usage_session_mode}")
        self.options_updated.emit()

    def _sync_usage_session_mode_from_checkboxes(self) -> None:
        app_enabled = self.app_usage_sessions_checkbox.isChecked()
        screen_enabled = self.screen_usage_sessions_checkbox.isChecked()
        if app_enabled and screen_enabled:
            mode = UsageSessionMode.APP_AND_SCREEN_USAGE
        elif screen_enabled:
            mode = UsageSessionMode.SCREEN_USAGE
        else:
            mode = UsageSessionMode.APP_USAGE

        self.options.usage_session_mode = mode
        self.options.derive_screen_usage_sessions = screen_enabled

    def _on_screen_usage_auto_lock_timeout_changed(self, value: int) -> None:
        """
        Handle screen usage auto-lock timeout change.

        Args:
            value: The new timeout in seconds
        """
        self.options.screen_usage_auto_lock_timeout_seconds = value
        self.options_updated.emit()

    def _on_screen_usage_auto_lock_tolerance_changed(self, value: int) -> None:
        """
        Handle screen usage auto-lock tolerance change.

        Args:
            value: The new tolerance in seconds
        """
        self.options.screen_usage_auto_lock_tolerance_seconds = value
        self.options_updated.emit()

    def _on_screen_usage_manual_lock_tail_gap_changed(self, value: int) -> None:
        """
        Handle screen usage manual-lock tail gap change.

        Args:
            value: The new maximum tail gap in seconds
        """
        self.options.screen_usage_manual_lock_max_tail_gap_seconds = value
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
                from chronicle_preprocessing_app.utils.file_utils import read_filter_file

                self.options.apps_to_filter_dict = read_filter_file(file)
                LOGGER.info(f"Loaded {len(self.options.apps_to_filter_dict)} app filters from {file}")
            except Exception:
                LOGGER.exception("Error loading filter file")

    def _on_select_apps_forcing_screen_open_file(self) -> None:
        """
        Open a dialog to select the apps-forcing-screen-open file.
        """
        file, _ = QFileDialog.getOpenFileName(self, "Select Keep-Awake Apps File", "", "Keep-Awake App Files (*.csv *.xlsx)")
        if file:
            self._display_path_with_elide(self.apps_forcing_screen_open_file_display, file)
            self.options.apps_forcing_screen_open_file = file
            self.options_updated.emit()

            try:
                from chronicle_preprocessing_app.utils.file_utils import (
                    read_apps_forcing_screen_open_file,
                )

                self.options.apps_forcing_screen_open_dict = read_apps_forcing_screen_open_file(file)
                LOGGER.info(f"Loaded {len(self.options.apps_forcing_screen_open_dict)} keep-awake apps from {file}")
            except Exception:
                LOGGER.exception("Error loading apps-forcing-screen-open file")

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
                self._reset_long_usage_duration_thresholds()
        else:
            self._reset_long_usage_duration_thresholds()
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
                self._reset_long_data_time_gap_thresholds()
        else:
            self._reset_long_data_time_gap_thresholds()
            self.options_updated.emit()

    def _reset_long_usage_duration_thresholds(self) -> None:
        """Reset long usage duration thresholds to application defaults."""
        thresholds = list(DEFAULT_LONG_USAGE_DURATION_THRESHOLDS)
        self.options.long_usage_duration_thresholds = thresholds
        self.set_long_usage_duration_thresholds(thresholds)

    def _reset_long_data_time_gap_thresholds(self) -> None:
        """Reset long data time gap thresholds to application defaults."""
        thresholds = list(DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS)
        self.options.long_data_time_gap_thresholds = thresholds
        self.set_long_data_time_gap_thresholds(thresholds)

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
            from chronicle_preprocessing_app.core.preprocessing import SurveyDataPreprocessor  # noqa: F401

            LOGGER.debug("SurveyDataPreprocessor import successful")

            # Also try to import key internal dependencies to ensure full functionality
            LOGGER.debug("Attempting chronicle_preprocessing_internal import")
            from chronicle_preprocessing_internal import (  # noqa: F401
                DeviceSharingStatus,
                ParticipantID,
                TrackingSheet,
                write_df_to_excel_and_format,
            )

            LOGGER.debug("chronicle_preprocessing_internal import successful")

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
        self.use_survey_data_checkbox.setChecked(getattr(self.options, "use_survey_data", False))
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
        self.survey_data_widget.setVisible(getattr(self.options, "use_survey_data", False))

        # Compliance reporting checkbox
        self.compliance_reporting_checkbox = QCheckBox("Generate Compliance Reports (for Shared Devices)")
        self.compliance_reporting_checkbox.setChecked(getattr(self.options, "compliance_reporting", False))
        self.compliance_reporting_checkbox.stateChanged.connect(self._on_compliance_reporting_changed)
        layout.addWidget(self.compliance_reporting_checkbox)
        self.compliance_reporting_checkbox.setVisible(getattr(self.options, "use_survey_data", False))

        # Initialize survey data folder display if set
        if hasattr(self.options, "survey_data_folder") and self.options.survey_data_folder:
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
        if not hasattr(self.options, "use_survey_data"):
            self.options.use_survey_data = False
        self.options.use_survey_data = checked

        # Show/hide the survey data folder widget and compliance checkbox
        if hasattr(self, "survey_data_widget"):
            self.survey_data_widget.setVisible(checked)
        if hasattr(self, "compliance_reporting_checkbox"):
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
            if not hasattr(self.options, "survey_data_folder"):
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
        if not hasattr(self.options, "compliance_reporting"):
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

    def set_apps_forcing_screen_open_file(self, file: str) -> None:
        """
        Set the apps-forcing-screen-open file display.

        Args:
            file: The file path to set
        """
        if file:
            self._display_path_with_elide(self.apps_forcing_screen_open_file_display, file)

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

    def set_use_apps_forcing_screen_open_file(self, checked: bool) -> None:
        """
        Set the use apps-forcing-screen-open file checkbox.

        Args:
            checked: Whether the checkbox should be checked
        """
        self.apps_forcing_screen_open_checkbox.setChecked(checked)
        self.apps_forcing_screen_open_file_widget.setVisible(checked)
        self.options.use_apps_forcing_screen_open_file = checked

    def set_usage_session_mode(self, mode: UsageSessionMode | str) -> None:
        """
        Set the usage session mode.

        Args:
            mode: Usage session mode to select
        """
        usage_session_mode = mode if isinstance(mode, UsageSessionMode) else UsageSessionMode(mode)
        self.options.usage_session_mode = usage_session_mode
        self.options.derive_screen_usage_sessions = usage_session_mode != UsageSessionMode.APP_USAGE
        self.app_usage_sessions_checkbox.blockSignals(True)
        self.screen_usage_sessions_checkbox.blockSignals(True)
        self.app_usage_sessions_checkbox.setChecked(usage_session_mode in {UsageSessionMode.APP_USAGE, UsageSessionMode.APP_AND_SCREEN_USAGE})
        self.screen_usage_sessions_checkbox.setChecked(usage_session_mode in {UsageSessionMode.SCREEN_USAGE, UsageSessionMode.APP_AND_SCREEN_USAGE})
        self.app_usage_sessions_checkbox.blockSignals(False)
        self.screen_usage_sessions_checkbox.blockSignals(False)
        self.screen_usage_settings_widget.setVisible(self.options.process_screen_usage_sessions)

    def set_screen_usage_auto_lock_timeout(self, value: int) -> None:
        """
        Set the screen usage auto-lock timeout.

        Args:
            value: Timeout in seconds
        """
        self.screen_usage_auto_lock_timeout_input.setValue(value)

    def set_screen_usage_auto_lock_tolerance(self, value: int) -> None:
        """
        Set the screen usage auto-lock tolerance.

        Args:
            value: Tolerance in seconds
        """
        self.screen_usage_auto_lock_tolerance_input.setValue(value)

    def set_screen_usage_manual_lock_max_tail_gap(self, value: int) -> None:
        """
        Set the screen usage manual-lock maximum tail gap.

        Args:
            value: Tail gap in seconds
        """
        self.screen_usage_manual_lock_max_tail_gap_input.setValue(value)

    def disable_during_processing(self) -> None:
        """
        Disable all interactive elements during processing.
        """
        self.study_name_input.setEnabled(False)
        self.raw_data_folder_button.setEnabled(False)
        self.label_filtered_apps_checkbox.setEnabled(False)
        self.filter_file_button.setEnabled(False)
        self.apps_forcing_screen_open_checkbox.setEnabled(False)
        self.apps_forcing_screen_open_file_button.setEnabled(False)
        self.app_usage_sessions_checkbox.setEnabled(False)
        self.screen_usage_sessions_checkbox.setEnabled(False)
        self.screen_usage_auto_lock_timeout_input.setEnabled(False)
        self.screen_usage_auto_lock_tolerance_input.setEnabled(False)
        self.screen_usage_manual_lock_max_tail_gap_input.setEnabled(False)
        self.minimum_usage_duration_input.setEnabled(False)
        self.custom_app_engagement_duration_input.setEnabled(False)
        self.long_usage_duration_thresholds_input.setEnabled(False)
        self.long_data_time_gap_thresholds_input.setEnabled(False)
        self.correct_duplicate_event_timestamps_checkbox.setEnabled(False)

        # Disable survey data elements if they exist
        if hasattr(self, "use_survey_data_checkbox"):
            self.use_survey_data_checkbox.setEnabled(False)
        if hasattr(self, "survey_data_folder_button"):
            self.survey_data_folder_button.setEnabled(False)
        if hasattr(self, "compliance_reporting_checkbox"):
            self.compliance_reporting_checkbox.setEnabled(False)

    def enable_after_processing(self) -> None:
        """
        Enable all interactive elements after processing is complete.
        """
        self.study_name_input.setEnabled(True)
        self.raw_data_folder_button.setEnabled(True)
        self.label_filtered_apps_checkbox.setEnabled(True)
        self.filter_file_button.setEnabled(True)
        self.apps_forcing_screen_open_checkbox.setEnabled(True)
        self.apps_forcing_screen_open_file_button.setEnabled(True)
        self.app_usage_sessions_checkbox.setEnabled(True)
        self.screen_usage_sessions_checkbox.setEnabled(True)
        self.screen_usage_auto_lock_timeout_input.setEnabled(True)
        self.screen_usage_auto_lock_tolerance_input.setEnabled(True)
        self.screen_usage_manual_lock_max_tail_gap_input.setEnabled(True)
        self.minimum_usage_duration_input.setEnabled(True)
        self.custom_app_engagement_duration_input.setEnabled(True)
        self.long_usage_duration_thresholds_input.setEnabled(True)
        self.long_data_time_gap_thresholds_input.setEnabled(True)
        self.correct_duplicate_event_timestamps_checkbox.setEnabled(True)

        # Enable survey data elements if they exist
        if hasattr(self, "use_survey_data_checkbox"):
            self.use_survey_data_checkbox.setEnabled(True)
        if hasattr(self, "survey_data_folder_button"):
            self.survey_data_folder_button.setEnabled(True)
        if hasattr(self, "compliance_reporting_checkbox"):
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

        if hasattr(self, "use_survey_data_checkbox"):
            self.use_survey_data_checkbox.setChecked(checked)
            # Update visibility of related elements
            if hasattr(self, "survey_data_widget"):
                self.survey_data_widget.setVisible(checked)
            if hasattr(self, "compliance_reporting_checkbox"):
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

        if folder and hasattr(self, "survey_data_folder_display"):
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

        if hasattr(self, "compliance_reporting_checkbox"):
            self.compliance_reporting_checkbox.setChecked(checked)
