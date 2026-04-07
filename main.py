"""
Main entry point for the Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

import logging
import os
import sys
import traceback
from pathlib import Path

from PyQt6.QtWidgets import QApplication

from config.constants import LOG_FORMAT
from config.version import __build_date__, __version__
from ui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI


def setup_logging() -> logging.Logger:
    """
    Set up logging configuration with fallback to console-only logging if file creation fails.

    Returns:
        logging.Logger: Configured logger for the main module
    """
    # Determine log file location based on platform and execution context
    log_file = "Chronicle_Android_raw_data_preprocessing.log"
    debug_log_file = "Chronicle_Android_raw_data_preprocessing_debug.log"

    try:
        if getattr(sys, "frozen", False):
            # Running as PyInstaller bundle
            bundle_dir = Path(sys.executable).parent
            if sys.platform.startswith("darwin"):
                # For macOS app bundles, use ~/Library/Logs/ChronicleAndroidRawDataPreprocessing/
                log_dir = (
                    Path.home()
                    / "Library"
                    / "Logs"
                    / "ChronicleAndroidRawDataPreprocessing"
                )
                log_dir.mkdir(parents=True, exist_ok=True)
                log_file = log_dir / log_file
                debug_log_file = log_dir / debug_log_file
            else:
                # For Windows, keep log in same directory as executable
                log_file = bundle_dir / log_file
                debug_log_file = bundle_dir / debug_log_file
        # Running as script
        elif sys.platform.startswith("darwin"):
            # For macOS, use ~/Library/Logs/ChronicleAndroidRawDataPreprocessing/
            log_dir = (
                Path.home()
                / "Library"
                / "Logs"
                / "ChronicleAndroidRawDataPreprocessing"
            )
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_dir / log_file
            debug_log_file = log_dir / debug_log_file
        else:
            # For Windows, use local logs directory
            log_dir = Path("logs")
            log_dir.mkdir(exist_ok=True)
            log_file = log_dir / log_file
            debug_log_file = log_dir / debug_log_file

        # Configure root logger with UTF-8 encoding for Unicode support
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(logging.Formatter(LOG_FORMAT))

        # Configure console handler with UTF-8 encoding
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(logging.Formatter(LOG_FORMAT))

        # Configure root logger
        logging.basicConfig(
            level=logging.INFO,
            format=LOG_FORMAT,
            handlers=[file_handler, console_handler],
        )

        # Add debug file handler with UTF-8 encoding
        root_logger = logging.getLogger()
        debug_handler = logging.FileHandler(debug_log_file, encoding="utf-8")
        debug_handler.setLevel(logging.DEBUG)
        debug_handler.setFormatter(logging.Formatter(LOG_FORMAT))
        root_logger.addHandler(debug_handler)

        # Get logger for this module
        logger = logging.getLogger(__name__)
        logger.info(
            f"Starting Chronicle Android Raw Data Preprocessing Application v{__version__} Build {__build_date__}"
        )
        logger.info(f"Log files created at: {log_file.parent.resolve()}")

        return logger

    except Exception:
        # Set up console-only logging if file logging fails
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(logging.Formatter(LOG_FORMAT))

        logging.basicConfig(
            level=logging.INFO,
            format=LOG_FORMAT,
            handlers=[console_handler],
        )
        logger = logging.getLogger(__name__)
        logger.exception("Failed to set up file logging")
        logger.warning("Continuing with console logging only")
        return logger


def main() -> None:
    """
    Main function to start the application

    Returns:
        None
    """
    # Set environment variables for proper Unicode handling on Windows
    if sys.platform.startswith("win"):
        os.environ["PYTHONIOENCODING"] = "utf-8"

    logger = setup_logging()

    try:
        # Use OS-specific platform plugin
        if sys.platform.startswith("win"):
            sys.argv += ["-platform", "windows:darkmode=1"]
            logger.info("Using windows platform for Windows")
        elif sys.platform.startswith("darwin"):
            # Ensure we're using the correct platform for macOS
            sys.argv += ["-platform", "cocoa"]
            logger.info("Using cocoa platform for macOS")

        app = QApplication(sys.argv)
        app.setStyle("Fusion")
        window = ChronicleAndroidRawDataPreprocessingGUI()
        window.show()
        sys.exit(app.exec())
    except Exception as e:
        logger.exception(f"Error starting application: {e}")

        # Attempt to write error to file even if logging setup failed
        try:
            error_file_name = "Chronicle_Android_error_log.txt"

            if getattr(sys, "frozen", False):
                # Running as PyInstaller bundle
                bundle_dir = Path(sys.executable).parent
                if sys.platform.startswith("darwin"):
                    # For macOS app bundles
                    error_log_dir = (
                        Path.home()
                        / "Library"
                        / "Logs"
                        / "ChronicleAndroidRawDataPreprocessing"
                    )
                    error_log_dir.mkdir(parents=True, exist_ok=True)
                    error_file = error_log_dir / error_file_name
                else:
                    # For Windows, keep log in same directory as executable
                    error_file = bundle_dir / error_file_name
            # Running as script
            elif sys.platform.startswith("darwin"):
                # For macOS
                error_log_dir = (
                    Path.home()
                    / "Library"
                    / "Logs"
                    / "ChronicleAndroidRawDataPreprocessing"
                )
                error_log_dir.mkdir(parents=True, exist_ok=True)
                error_file = error_log_dir / error_file_name
            else:
                # For Windows, use current directory
                error_file = Path(error_file_name)

            with error_file.open("w", encoding="utf-8") as f:
                f.write(f"Application failed to start: {e}\n\n")
                f.write(traceback.format_exc())

            logger.info(f"Error log written to: {error_file}")
        except Exception:
            logger.exception("Failed to write error log")
            # Silently continue if error file can't be written

        raise


if __name__ == "__main__":
    main()
