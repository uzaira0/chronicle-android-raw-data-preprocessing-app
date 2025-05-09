"""
Main entry point for the Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

import logging
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
    # Configure root logger first with console only
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)  # Capture all logs
    
    # Create formatters
    default_formatter = logging.Formatter(LOG_FORMAT)
    
    # Always add console handler first as fallback
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(default_formatter)
    root_logger.addHandler(console_handler)
    
    # Get logger for this module
    logger = logging.getLogger(__name__)
    
    # Try to set up file logging
    try:
        log_dir = Path("logs")
        log_dir.mkdir(exist_ok=True)

        log_file = log_dir / "Chronicle_Android_raw_data_preprocessing.log"
        debug_log_file = log_dir / "Chronicle_Android_raw_data_preprocessing_debug.log"

        # Create file handlers
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(default_formatter)

        debug_file_handler = logging.FileHandler(debug_log_file)
        debug_file_handler.setLevel(logging.DEBUG)
        debug_file_handler.setFormatter(default_formatter)

        # Add file handlers to root logger
        root_logger.addHandler(file_handler)
        root_logger.addHandler(debug_file_handler)
        
        logger.info(f"Starting Chronicle Android Raw Data Preprocessing Application v{__version__} Build {__build_date__}")
        logger.info(f"Log files created at: {log_dir.resolve()}")
    except PermissionError as e:
        logger.error(f"Permission denied when creating log files: {e}")
        logger.warning("Continuing with console logging only")
    except OSError as e:
        logger.error(f"Failed to set up file logging: {e}")
        logger.warning("Continuing with console logging only")
    except Exception as e:
        logger.error(f"Unexpected error setting up logging: {e}")
        logger.warning("Continuing with console logging only")
    
    return logger


def main() -> None:
    """
    Main function to start the application
    
    Returns:
        None
    """
    logger = setup_logging()

    try:
        sys.argv += ["-platform", "windows:darkmode=1"]
        app = QApplication(sys.argv)
        app.setStyle("Fusion")
        window = ChronicleAndroidRawDataPreprocessingGUI()
        window.show()
        sys.exit(app.exec())
    except Exception as e:
        logger.exception(f"Error starting application: {e}")
        
        # Attempt to write error to file even if logging setup failed
        try:
            error_file = Path("error_log.txt")
            with error_file.open("w", encoding="utf-8") as f:
                f.write(f"Application failed to start: {e}\n\n")
                f.write(traceback.format_exc())
        except Exception:
            pass  # Silently continue if error file can't be written
        
        raise


if __name__ == "__main__":
    main()
