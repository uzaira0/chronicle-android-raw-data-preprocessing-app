from __future__ import annotations

import json
import logging
import sys
import traceback
import platform
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QGuiApplication
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QDialog,
    QHBoxLayout,
    QMainWindow,
    QMessageBox,
    QVBoxLayout,
    QWidget,
    QScrollArea,
)

from config.constants import APP_DISPLAY_NAME, DialogMessage, TimezoneHandlingOption, UIStatus
from config.version import __build_date__, __version__
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from models.processing_stats import ProcessingStats
from preprocessors.main_preprocessor import ChronicleAndroidRawDataPreprocessor
from ui.dialogs.filter_dialog import AppsFilterDialog
from ui.panels.config_panel import ConfigPanel
from ui.panels.options_panel import OptionsPanel
from ui.panels.plotting_panel import PlottingPanel
from ui.panels.status_panel import StatusPanel
from ui.workers.preprocessing_thread import PreprocessingThread

LOGGER = logging.getLogger(__name__)


class ChronicleAndroidRawDataPreprocessingGUI(QMainWindow):
    """
    Main window for the Chronicle Android Raw Data Preprocessing Application.

    This class provides the graphical user interface for the preprocessor,
    allowing users to configure options and run the preprocessing operation.
    The UI is organized into three main panels:
    - ConfigPanel: For basic configuration settings
    - OptionsPanel: For timezone and interaction options
    - StatusPanel: For status display and control buttons
    """

    def __init__(self) -> None:
        """
        Initialize the main window and UI components.
        """
        super().__init__()

        self.options = ChronicleAndroidRawDataPreprocessingOptions()
        self.scale_factor = self.get_scale_factor()
        self.is_initializing = True
        self.output_folder = None

        self.setup_ui()

        # Load configuration if available
        self._load_and_set_config()

        # Initialization complete
        self.is_initializing = False

        # Initialize the preprocessor (but don't run it yet)
        self.preprocessor = None
        self.worker_thread = None

    def get_scale_factor(self) -> float:
        """
        Calculate the display scaling factor based on screen DPI.

        Returns:
            float: The scaling factor for UI elements
        """
        try:
            if QGuiApplication.instance():
                screen = QGuiApplication.primaryScreen()
                if screen:
                    dpi = screen.physicalDotsPerInch()
                    return max(1.0, dpi / 96.0)
        except Exception as e:
            LOGGER.warning(f"Error calculating scale factor: {e}")
        return 1.0

    def setup_ui(self) -> None:
        """
        Set up the user interface components using the new panel structure.
        """
        self.setWindowTitle(f"{APP_DISPLAY_NAME} v{__version__} Build {__build_date__}")

        # Create scroll area
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setCentralWidget(scroll_area)

        # Create central widget and main layout
        central_widget = QWidget()
        scroll_area.setWidget(central_widget)

        # Set minimum size rather than fixed size to allow scrolling
        self.setMinimumSize(int(500 * self.scale_factor), int(600 * self.scale_factor))

        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(10, 10, 10, 10)
        main_layout.setSpacing(6)

        # Create processing mode checkboxes
        process_control_layout = QHBoxLayout()
        process_control_layout.setContentsMargins(0, 0, 0, 10)

        self.preprocess_checkbox = QCheckBox("Preprocess")
        self.preprocess_checkbox.setChecked(self.options.enable_preprocessing)
        self.preprocess_checkbox.stateChanged.connect(self._on_preprocess_state_changed)

        self.plot_checkbox = QCheckBox("Plot")
        self.plot_checkbox.setChecked(self.options.enable_plotting)
        self.plot_checkbox.stateChanged.connect(self._on_plot_state_changed)

        process_control_layout.addWidget(self.preprocess_checkbox)
        process_control_layout.addWidget(self.plot_checkbox)
        process_control_layout.addStretch()

        main_layout.addLayout(process_control_layout)

        # Create panels
        self.config_panel = ConfigPanel(self.options, central_widget, self.scale_factor)
        self.options_panel = OptionsPanel(self.options, central_widget, self.scale_factor)
        self.plotting_panel = PlottingPanel(self.options, central_widget, self.scale_factor)
        self.status_panel = StatusPanel(self.options, central_widget, self.scale_factor)

        # Connect signals
        self.config_panel.raw_data_folder_changed.connect(self._on_raw_data_folder_changed)
        self.config_panel.options_updated.connect(self._on_options_updated)
        self.options_panel.timezone_changed.connect(self._on_timezone_changed)
        self.options_panel.options_updated.connect(self._on_options_updated)
        self.status_panel.start_clicked.connect(self.start_preprocessing)

        # Add panels to main layout
        main_layout.addWidget(self.config_panel)
        main_layout.addWidget(self.options_panel)
        main_layout.addWidget(self.plotting_panel)
        main_layout.addWidget(self.status_panel)

        # Update UI visibility based on initial checkbox states
        self._update_ui_visibility()

    def _on_raw_data_folder_changed(self, folder: str) -> None:
        """
        Handle raw data folder change from ConfigPanel.

        Args:
            folder: The new raw data folder path
        """
        LOGGER.debug(f"Raw data folder changed to: {folder}")

        # Only show the timezone detection dialog if we're not during initialization
        if not self.is_initializing:
            # Create a message box to ask if the user wants to find all timezones in the selected folder
            msg_box = QMessageBox(self)
            msg_box.setWindowTitle("Find All Timezones in Selected Folder?")
            msg_box.setText("Would you like to find all timezones in the folder you just selected?")
            msg_box.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            msg_box.setDefaultButton(QMessageBox.StandardButton.Yes)

            if msg_box.exec() == QMessageBox.StandardButton.Yes:
                self.options_panel.on_find_all_timezones_clicked()

    def _on_timezone_changed(self, timezone: str) -> None:
        """
        Handle timezone selection change from OptionsPanel.

        Args:
            timezone: The new timezone selection
        """
        LOGGER.debug(f"Timezone changed to: {timezone}")

    def _on_options_updated(self) -> None:
        """
        Handle options updates from any panel.
        """
        LOGGER.debug("Options updated")

    def configure_app_filters(self) -> None:
        """
        Open dialog to configure app filters.
        """
        dialog = AppsFilterDialog(self, self.options)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            # Update options with the app filters
            self.options.apps_to_filter_dict = dialog.get_app_filters()

    # Options are now updated directly through panel signals

    def start_preprocessing(self) -> None:
        """
        Start the preprocessing operation after validating inputs.
        """
        # Check if at least one option is enabled
        if not self.options.enable_preprocessing and not self.options.enable_plotting:
            QMessageBox.warning(self, "Warning", "Please select at least one operation (Preprocess or Plot)")
            return

        # Validate inputs for preprocessing
        if self.options.enable_preprocessing:
            if not self.options.study_name:
                QMessageBox.warning(self, "Warning", DialogMessage.WARNING_STUDY_NAME)
                return

            if not self.options.raw_data_folder:
                QMessageBox.warning(self, "Warning", DialogMessage.WARNING_RAW_DATA_FOLDER)
                return

            # Only check for selected timezone when not using per-file mode
            is_per_file_option = (
                self.options.timezone_handling_option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE
                or self.options.timezone_handling_option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE
            )

            if not is_per_file_option and not self.options.selected_timezone:
                QMessageBox.warning(self, "Warning", DialogMessage.WARNING_TIMEZONE)
                return

        # Validate inputs for plotting only
        if not self.options.enable_preprocessing and self.options.enable_plotting:
            if not self.options.study_name:
                QMessageBox.warning(self, "Warning", DialogMessage.WARNING_STUDY_NAME)
                return

            if not self.options.raw_data_folder:
                QMessageBox.warning(self, "Warning", DialogMessage.WARNING_RAW_DATA_FOLDER)
                return

        # Create preprocessor
        self.preprocessor = ChronicleAndroidRawDataPreprocessor(self.options)

        # Create and start worker thread
        self.worker_thread = PreprocessingThread(self.preprocessor)
        self.worker_thread.progress_signal.connect(self._on_progress_update)
        self.worker_thread.file_progress_signal.connect(self._on_file_progress_update)
        self.worker_thread.completed_signal.connect(self._on_preprocessing_completed)
        self.worker_thread.error_signal.connect(self._on_preprocessing_error)
        self.worker_thread.plotting_started_signal.connect(self._on_plotting_started)
        self.worker_thread.plotting_completed_signal.connect(self._on_plotting_completed)

        # Disable UI elements during processing
        self.disable_ui_during_processing()

        # Update status and start the thread
        if self.options.enable_preprocessing and self.options.enable_plotting:
            status_message = "Preprocessing and plotting..."
        elif self.options.enable_preprocessing:
            status_message = "Preprocessing only..."
        else:
            status_message = "Plotting only..."

        self.status_panel.update_status(status_message)
        self.status_panel.update_progress("Starting...")
        self.worker_thread.start()

    def _on_progress_update(self, message: str) -> None:
        """
        Handle progress updates from the worker thread.

        Args:
            message: The progress message
        """
        self.status_panel.update_status(f"Status: {message}")

    def _on_file_progress_update(self, message: str, current_file: int, total_files: int) -> None:
        """
        Handle file progress updates from the worker thread.

        Args:
            message: The progress message
            current_file: Current file being processed
            total_files: Total number of files to process
        """
        self.status_panel.update_progress(message, current_file, total_files)

    def _on_preprocessing_completed(self, message: str, output_folder: Path, stats: ProcessingStats) -> None:
        """
        Handle completion of preprocessing.

        Args:
            message: The completion message
            output_folder: Path to the output folder
            stats: Processing statistics
        """
        # Store statistics
        self.processing_stats = stats
        try:
            # Update status and show output folder button
            self.status_panel.update_status(message)
            self.status_panel.hide_progress()
            self.status_panel.show_output_folder_button(output_folder)

            # Store output folder path
            self.output_folder = output_folder

            # If plot generation is enabled, show the plots folder button
            if getattr(self.options, "enable_plotting", True):
                # Determine the plots folder path based on the study name
                from config.constants import PLOTTED_FOLDER_SUFFIX

                plots_folder = Path(output_folder.parent) / f"{self.options.study_name + ' ' + PLOTTED_FOLDER_SUFFIX}"
                if plots_folder.exists():
                    self.status_panel.show_plots_folder_button(plots_folder)

            # After successful preprocessing, add the selected timezone to custom_timezones if not in available_timezones
            is_per_file_option = (
                self.options.timezone_handling_option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE
                or self.options.timezone_handling_option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE
            )

            # Only save selected timezone to custom timezones when not in per-file mode
            current_timezone = self.options.selected_timezone
            if not is_per_file_option and current_timezone and current_timezone not in self.options.available_timezones:
                LOGGER.debug(f"Adding verified custom timezone to custom_timezones: {current_timezone}")
                if not hasattr(self.options, "custom_timezones"):
                    self.options.custom_timezones = []
                # Make sure to convert to string if it's a tzinfo object
                if current_timezone not in self.options.custom_timezones:
                    timezone_str = str(current_timezone)
                    self.options.custom_timezones.append(timezone_str)
                # Update the dropdown with the combined timezones
                self.options_panel.update_timezone_dropdown()

            # Re-enable UI elements
            self.enable_ui_after_processing()

            # Save configuration upon successful completion
            self._save_config()

            # Show success message with statistics
            success_title = "Processing Completed Successfully"
            success_message = message

            # If there were any issues, update the title
            if self.processing_stats and (self.processing_stats.failed_files > 0 or self.processing_stats.plot_failed_files > 0):
                success_title = "Processing Completed with Some Issues"

            QMessageBox.information(self, success_title, success_message)

        except Exception as e:
            # Log any issues but don't interrupt the flow
            LOGGER.warning(f"Error in preprocessing_completed: {e}")

    def _on_preprocessing_error(self, error_message: str, stats: ProcessingStats) -> None:
        """
        Handle preprocessing error.

        Args:
            error_message: The error message
            stats: Processing statistics collected before the error
        """
        # Store statistics
        self.processing_stats = stats
        self.status_panel.update_status("Error: Preprocessing failed")
        self.status_panel.hide_progress()

        # Re-enable UI elements
        self.enable_ui_after_processing()

        # Get the log file path based on platform and execution context
        log_file_name = "Chronicle_Android_raw_data_preprocessing.log"

        if getattr(sys, "frozen", False):
            # Running as PyInstaller bundle
            bundle_dir = Path(sys.executable).parent
            if sys.platform.startswith("darwin"):
                # For macOS app bundles
                log_dir = Path.home() / "Library" / "Logs" / "ChronicleAndroidRawDataPreprocessing"
                log_path = log_dir / log_file_name
            else:
                # For Windows, keep log in same directory as executable
                log_path = bundle_dir / log_file_name
        # Running as script
        elif sys.platform.startswith("darwin"):
            # For macOS
            log_dir = Path.home() / "Library" / "Logs" / "ChronicleAndroidRawDataPreprocessing"
            log_path = log_dir / log_file_name
        else:
            # For Windows, use local logs directory
            log_dir = Path("logs").resolve()
            log_path = log_dir / log_file_name

        # Format error message with traceback if available
        detailed_message = error_message
        if hasattr(sys, "last_traceback"):
            detailed_message = f"{error_message}\n\nTraceback:\n{''.join(traceback.format_tb(sys.last_traceback))}"

        # Create error dialog with traceback
        msg_box = QMessageBox(self)
        msg_box.setWindowTitle("Preprocessing Error")
        msg_box.setIcon(QMessageBox.Icon.Critical)
        msg_box.setText("An error occurred during preprocessing.")
        msg_box.setInformativeText(f"Please check the log file for more details:\n{log_path}")
        msg_box.setDetailedText(detailed_message)

        # Set a reasonable size for the detail area
        msg_box.setMinimumWidth(600)
        msg_box.setMinimumHeight(400)

        # Add OK button
        msg_box.setStandardButtons(QMessageBox.StandardButton.Ok)

        # Execute the dialog
        msg_box.exec()

    def disable_ui_during_processing(self) -> None:
        """
        Disable all UI elements during processing.
        """
        self.preprocess_checkbox.setEnabled(False)
        self.plot_checkbox.setEnabled(False)

        # Disable panels
        self.config_panel.disable_during_processing()
        self.options_panel.disable_during_processing()
        self.plotting_panel.disable_during_processing()
        self.status_panel.disable_during_processing()

    def enable_ui_after_processing(self) -> None:
        """
        Enable all UI elements after processing completes.
        """
        self.preprocess_checkbox.setEnabled(True)
        self.plot_checkbox.setEnabled(True)

        # Enable panels
        self.config_panel.enable_after_processing()
        self.options_panel.enable_after_processing()
        self.plotting_panel.enable_after_processing()
        self.status_panel.enable_after_processing()

    def _load_and_set_config(self) -> None:
        """
        Load and set the configuration for the application.

        This method loads the configuration settings from a JSON file and applies them to the
        preprocessor options and UI elements. If the configuration file is not found, it logs a warning.
        """
        LOGGER.debug("Loading and setting configuration")
        config_file = Path("Chronicle_Android_raw_data_preprocessing_app_config.json")

        config: dict = {}
        try:
            if not config_file.exists():
                LOGGER.warning(f"Configuration file not found: {config_file}")
                return

            if not config_file.is_file():
                LOGGER.warning(f"Configuration path exists but is not a file: {config_file}")
                return

            with config_file.open("r", encoding="utf-8") as f:
                config = json.load(f)
            LOGGER.debug("Configuration file loaded successfully.")
        except PermissionError as e:
            LOGGER.error(f"Permission denied when accessing configuration file: {config_file}. Error: {e}")
            return
        except json.JSONDecodeError as e:
            LOGGER.error(f"Configuration file is corrupted or invalid JSON: {e}")
            return
        except Exception as e:
            LOGGER.exception(f"Error loading configuration: {e}")
            return

        # Skip applying the configuration if it's empty
        if not config:
            LOGGER.warning("Configuration file is empty or invalid, skipping configuration loading")
            return

        try:
            self._load_config_to_options(config)
            self._update_ui_from_options()
            LOGGER.info("Configuration loaded and applied successfully")
        except Exception as e:
            LOGGER.exception(f"Error applying configuration to options: {e}")

    def _load_config_to_options(self, config: dict) -> None:
        """
        Load configuration settings into the options object.

        Args:
            config: The configuration dictionary
        """
        # Set Study Name
        if "study_name" in config:
            self.options.study_name = config["study_name"]

        # Set the raw data folder from the configuration
        if config.get("raw_data_folder"):
            self.options.raw_data_folder = config["raw_data_folder"]

        # Set process control options
        if "enable_preprocessing" in config:
            self.options.enable_preprocessing = config["enable_preprocessing"]

        if "enable_plotting" in config:
            self.options.enable_plotting = config["enable_plotting"]

        # Set the filter file from the configuration
        if config.get("filter_file"):
            filter_file = config["filter_file"]
            self.options.filter_file = filter_file

            # If a filter file is specified, attempt to load it to populate apps_to_filter_dict
            if Path(filter_file).exists():
                try:
                    from utils.file_utils import read_filter_file

                    self.options.apps_to_filter_dict = read_filter_file(filter_file)
                    LOGGER.info(f"Loaded {len(self.options.apps_to_filter_dict)} app filters from {filter_file}")
                except Exception:
                    LOGGER.exception("Error loading filter file")

        # Set duration settings
        if "minimum_usage_duration" in config:
            self.options.minimum_usage_duration = int(config["minimum_usage_duration"])

        if "custom_app_engagement_duration" in config:
            self.options.custom_app_engagement_duration = int(config["custom_app_engagement_duration"])

        if "long_usage_duration_thresholds" in config:
            self.options.long_usage_duration_thresholds = config["long_usage_duration_thresholds"]

        if "long_data_time_gap_thresholds" in config:
            self.options.long_data_time_gap_thresholds = config["long_data_time_gap_thresholds"]

        # Set the correct duplicate event timestamps option from the configuration
        if "correct_duplicate_event_timestamps" in config:
            self.options.correct_duplicate_event_timestamps = config["correct_duplicate_event_timestamps"]

        # Set timezone options
        if "timezone_handling_option" in config:
            self.options.timezone_handling_option = TimezoneHandlingOption(config["timezone_handling_option"])

        if config.get("available_timezones"):
            self.options.available_timezones = config["available_timezones"]

        if config.get("custom_timezones"):
            self.options.custom_timezones = config["custom_timezones"]

        if config.get("selected_timezone"):
            self.options.selected_timezone = config["selected_timezone"]

        # Set the interaction types if available
        if "same_app_interaction_types_to_stop_usage_at" in config:
            self.options.same_app_interaction_types_to_stop_usage_at = set(config["same_app_interaction_types_to_stop_usage_at"])
            self.options.same_app_interaction_types_configured = True

        if "other_interaction_types_to_stop_usage_at" in config:
            self.options.other_interaction_types_to_stop_usage_at = set(config["other_interaction_types_to_stop_usage_at"])
            self.options.other_interaction_types_configured = True

        if "interaction_types_to_remove" in config:
            self.options.interaction_types_to_remove = set(config["interaction_types_to_remove"])
            self.options.interaction_types_to_remove_configured = True

        # Load plotting options
        if "enable_plotting" in config:
            self.options.enable_plotting = config["enable_plotting"]
            LOGGER.debug(f"Loaded enable_plotting: {self.options.enable_plotting}")

        if "include_filtered_app_usage_in_plots" in config:
            self.options.include_filtered_app_usage_in_plots = config["include_filtered_app_usage_in_plots"]
            LOGGER.debug(f"Loaded include_filtered_app_usage_in_plots: {self.options.include_filtered_app_usage_in_plots}")

        if "app_codebook_path" in config:
            self.options.app_codebook_path = config["app_codebook_path"]
            LOGGER.debug(f"Loaded app_codebook_path: {self.options.app_codebook_path}")

        if "use_app_codebook" in config:
            self.options.use_app_codebook = config["use_app_codebook"]
            LOGGER.debug(f"Loaded use_app_codebook: {self.options.use_app_codebook}")

        # Load filter options
        if "use_filter_file" in config:
            self.options.use_filter_file = config["use_filter_file"]

    def _update_ui_from_options(self) -> None:
        """
        Update the UI components based on the current options.
        """
        # Update process control checkboxes
        self.preprocess_checkbox.setChecked(self.options.enable_preprocessing)
        self.plot_checkbox.setChecked(self.options.enable_plotting)

        # Update UI visibility based on checkbox states
        self._update_ui_visibility()

        # Update ConfigPanel fields
        self.config_panel.set_study_name(self.options.study_name)
        self.config_panel.set_raw_data_folder(str(self.options.raw_data_folder))
        self.config_panel.set_filter_file(str(self.options.filter_file))
        self.config_panel.set_use_filter_file(self.options.use_filter_file)
        self.config_panel.set_minimum_usage_duration(self.options.minimum_usage_duration)
        self.config_panel.set_custom_app_engagement_duration(self.options.custom_app_engagement_duration)
        self.config_panel.set_long_usage_duration_thresholds(self.options.long_usage_duration_thresholds)
        self.config_panel.set_long_data_time_gap_thresholds(self.options.long_data_time_gap_thresholds)
        self.config_panel.set_correct_duplicate_event_timestamps(self.options.correct_duplicate_event_timestamps)

        # Update OptionsPanel fields
        if self.options.available_timezones:
            self.options_panel.set_timezones(self.options.available_timezones)

        if self.options.selected_timezone:
            self.options_panel.set_selected_timezone(str(self.options.selected_timezone))

        self.options_panel.set_timezone_handling_option(self.options.timezone_handling_option)

        # Update plotting options in plotting panel
        self.plotting_panel.set_use_app_codebook(self.options.use_app_codebook)
        self.plotting_panel.set_app_codebook_path(str(self.options.app_codebook_path))
        self.plotting_panel.set_include_filtered_app_usage(self.options.include_filtered_app_usage_in_plots)

    def _save_config(self) -> None:
        """
        Save the current configuration of the application.

        This method saves the current preprocessor options to a JSON file. It converts values to
        JSON serializable formats if necessary.

        Returns:
            None
        """
        LOGGER.debug("Saving configuration")

        # Create a dictionary to store the configuration
        config: dict[str, object] = {}

        # Add selected options from the options object
        for key, value in self.options.__dict__.items():
            # Skip the apps_to_filter_dict as it's loaded from the filter_file
            if key == "apps_to_filter_dict":
                continue

            # Skip interaction types that weren't specifically configured
            if key == "same_app_interaction_types_to_stop_usage_at" and not getattr(self.options, "same_app_interaction_types_configured", False):
                continue
            if key == "other_interaction_types_to_stop_usage_at" and not getattr(self.options, "other_interaction_types_configured", False):
                continue
            if key == "interaction_types_to_remove" and not getattr(self.options, "interaction_types_to_remove_configured", False):
                continue

            # Skip the configuration flags themselves
            if key.endswith("_configured"):
                continue

            # Skip non-serializable objects like tzinfo
            if key == "selected_timezone" and value is not None and not isinstance(value, str):
                config[key] = str(value)
            elif isinstance(value, (str, int, float, bool, type(None))):
                config[key] = value
            elif isinstance(value, (list, tuple, set)):
                # Ensure we have string representations for all elements in lists
                config[key] = [str(item) if not isinstance(item, (str, int, float, bool, type(None))) else item for item in value]
            elif hasattr(value, "value"):  # Handle Enum types
                config[key] = value.value
            else:
                config[key] = str(value)

        try:
            # Write the configuration to a file
            config_file = Path("Chronicle_Android_raw_data_preprocessing_app_config.json")

            # Ensure parent directory exists
            config_file.parent.mkdir(exist_ok=True)

            with config_file.open("w", encoding="utf-8") as f:
                json.dump(config, f, indent=4, ensure_ascii=False)
            LOGGER.debug("Configuration saved successfully.")
        except PermissionError as e:
            LOGGER.error(f"Permission denied when saving configuration file: {e}")
        except OSError as e:
            LOGGER.error(f"OS error when saving configuration file: {e}")
        except Exception as e:
            LOGGER.exception(f"Failed to save configuration: {e}")
            # Don't show an error dialog to the user, just log it

    def _on_plotting_started(self) -> None:
        """
        Handle start of plotting process.
        """
        self.status_panel.update_status(UIStatus.PLOTTING_IN_PROGRESS)
        self.status_panel.update_progress("Starting plot generation...")

    def _on_plotting_completed(self) -> None:
        """
        Handle completion of plotting process.
        """
        self.status_panel.update_status(UIStatus.PLOTTING_COMPLETE)

    def _on_preprocess_state_changed(self, state: int) -> None:
        """
        Handle change in preprocessing state.

        Args:
            state: The new state of the preprocessing checkbox
        """
        self.options.enable_preprocessing = state == Qt.CheckState.Checked.value
        self._update_ui_visibility()

        # If preprocessing is disabled but plotting is enabled, make sure the options.enable_plotting is True
        if not self.options.enable_preprocessing and self.options.enable_plotting:
            self.options.enable_plotting = True

    def _on_plot_state_changed(self, state: int) -> None:
        """
        Handle change in plotting state.

        Args:
            state: The new state of the plotting checkbox
        """
        self.options.enable_plotting = state == Qt.CheckState.Checked.value
        self._update_ui_visibility()

        # Update the enable_plotting option to match the plotting checkbox
        self.options.enable_plotting = self.options.enable_plotting

    def _update_ui_visibility(self) -> None:
        """
        Update the UI visibility based on the current state of the checkboxes.
        """
        self.config_panel.setVisible(self.preprocess_checkbox.isChecked())
        self.options_panel.setVisible(self.preprocess_checkbox.isChecked())
        self.plotting_panel.setVisible(self.plot_checkbox.isChecked())
        # self.status_panel.setVisible(self.preprocess_checkbox.isChecked())


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = ChronicleAndroidRawDataPreprocessingGUI()
    window.show()
    sys.exit(app.exec())
