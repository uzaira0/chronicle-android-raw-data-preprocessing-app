"""
Configuration manager for Chronicle Android Raw Data Preprocessing Application.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from config.constants import TimezoneHandlingOption
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions

LOGGER = logging.getLogger(__name__)

CONFIG_FILE = "Chronicle_Android_raw_data_preprocessing_app_config.json"


class ConfigManager:
    """
    Manager for loading and saving application configuration.
    """

    def __init__(self, config_file: str = CONFIG_FILE) -> None:
        """
        Initialize the configuration manager.

        Args:
            config_file: The configuration file path
        """
        self.config_file = Path(config_file)

    def load_config(self) -> dict | None:
        """
        Load configuration from file.

        Returns:
            dict | None: The loaded configuration or None if file not found
        """
        LOGGER.debug(f"Loading configuration from {self.config_file}")

        try:
            with self.config_file.open("r") as f:
                config = json.load(f)
                LOGGER.debug("Configuration file loaded successfully")
                return config
        except FileNotFoundError:
            LOGGER.warning("Configuration file not found")
            return None
        except json.JSONDecodeError:
            LOGGER.exception("Configuration file is corrupted or invalid")
            return None
        except Exception:
            LOGGER.exception("Error loading configuration")
            return None

    def save_config(self, options: ChronicleAndroidRawDataPreprocessingOptions) -> bool:
        """
        Save configuration to file.

        Args:
            options: The options to save

        Returns:
            bool: True if saved successfully, False otherwise
        """
        LOGGER.debug(f"Saving configuration to {self.config_file}")

        config = {}

        for key, value in options.__dict__.items():
            if key == "apps_to_filter_dict":
                continue

            if key == "same_app_interaction_types_to_stop_usage_at" and not getattr(options, "same_app_interaction_types_configured", False):
                continue
            if key == "other_interaction_types_to_stop_usage_at" and not getattr(options, "other_interaction_types_configured", False):
                continue
            if key == "interaction_types_to_remove" and not getattr(options, "interaction_types_to_remove_configured", False):
                continue

            if key.endswith("_configured"):
                continue

            if key == "selected_timezone" and value is not None and not isinstance(value, str):
                config[key] = str(value)
            elif isinstance(value, (str, int, float, bool, type(None))):
                config[key] = value
            elif isinstance(value, (list, tuple, set)):
                config[key] = list(value)
            elif hasattr(value, "value"):  # Handle Enum types
                config[key] = value.value
            else:
                config[key] = str(value)

        try:
            with self.config_file.open("w") as f:
                json.dump(config, f, indent=4)
            LOGGER.debug("Configuration saved successfully")
        except Exception as e:
            LOGGER.exception(f"Failed to save configuration: {e}")
            return False
        else:
            return True

    def apply_config_to_options(
        self, options: ChronicleAndroidRawDataPreprocessingOptions, config: dict
    ) -> ChronicleAndroidRawDataPreprocessingOptions:
        """
        Apply configuration to options object.

        Args:
            options: The options object to update
            config: The configuration dictionary

        Returns:
            ChronicleAndroidRawDataPreprocessingOptions: The updated options
        """
        LOGGER.debug("Applying configuration to options")

        if "study_name" in config:
            options.study_name = config["study_name"]

        if "raw_data_folder" in config:
            options.raw_data_folder = config["raw_data_folder"]

        # Process control options
        if "enable_preprocessing" in config:
            options.enable_preprocessing = config["enable_preprocessing"]

        if "enable_plotting" in config:
            options.enable_plotting = config["enable_plotting"]

        # Survey data options
        if "use_survey_data" in config:
            options.use_survey_data = config["use_survey_data"]

        if "survey_data_folder" in config:
            options.survey_data_folder = config["survey_data_folder"]

        if "filter_file" in config:
            options.filter_file = config["filter_file"]

        if "minimum_usage_duration" in config:
            options.minimum_usage_duration = int(config["minimum_usage_duration"])

        if "custom_app_engagement_duration" in config:
            options.custom_app_engagement_duration = int(config["custom_app_engagement_duration"])

        if "long_usage_duration_thresholds" in config:
            options.long_usage_duration_thresholds = config["long_usage_duration_thresholds"]

        if "long_data_time_gap_thresholds" in config:
            options.long_data_time_gap_thresholds = config["long_data_time_gap_thresholds"]

        if "correct_duplicate_event_timestamps" in config:
            options.correct_duplicate_event_timestamps = config["correct_duplicate_event_timestamps"]

        if "timezone_handling_option" in config:
            options.timezone_handling_option = TimezoneHandlingOption(config["timezone_handling_option"])

        if "available_timezones" in config:
            options.available_timezones = config["available_timezones"]

        if "selected_timezone" in config:
            options.selected_timezone = config["selected_timezone"]

        if "same_app_interaction_types_to_stop_usage_at" in config:
            options.same_app_interaction_types_to_stop_usage_at = set(config["same_app_interaction_types_to_stop_usage_at"])
            options.same_app_interaction_types_configured = True

        if "other_interaction_types_to_stop_usage_at" in config:
            options.other_interaction_types_to_stop_usage_at = set(config["other_interaction_types_to_stop_usage_at"])
            options.other_interaction_types_configured = True

        if "interaction_types_to_remove" in config:
            options.interaction_types_to_remove = set(config["interaction_types_to_remove"])
            options.interaction_types_to_remove_configured = True

        if "use_app_codebook" in config:
            options.use_app_codebook = config["use_app_codebook"]

        if "app_codebook_path" in config:
            options.app_codebook_path = config["app_codebook_path"]

        LOGGER.debug("Configuration applied successfully")
        return options
