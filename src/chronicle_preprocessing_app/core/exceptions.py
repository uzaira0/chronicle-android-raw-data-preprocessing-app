"""Custom exceptions for the Chronicle Android Raw Data Preprocessing package.

This module defines exception hierarchy for the preprocessing operations,
allowing external code to catch and handle specific error types.
"""

from __future__ import annotations


class PreprocessingError(Exception):
    """Base exception for all preprocessing errors.

    All custom exceptions in this package inherit from this base class,
    allowing external code to catch all preprocessing-related errors with
    a single exception handler.
    """


class ConfigurationError(PreprocessingError):
    """Invalid configuration provided.

    Raised when:
    - Required configuration fields are missing
    - Configuration values are invalid or out of range
    - Conflicting options are specified
    - Required files or directories don't exist
    """


class ValidationError(PreprocessingError):
    """Data validation failed.

    Raised when:
    - Input data doesn't match expected format
    - Required columns are missing from CSV files
    - Data contains invalid or unexpected values
    - Timestamp formats are incorrect
    """


class FileProcessingError(PreprocessingError):
    """Error during file processing.

    Raised when:
    - File cannot be read or written
    - File format is invalid
    - File is corrupted or incomplete
    - Permission errors accessing files
    """


class CancellationError(PreprocessingError):
    """Operation was cancelled by user or system.

    Raised when:
    - User cancels the operation through the GUI
    - CLI operation is interrupted with Ctrl+C
    - Automated pipeline cancels due to timeout or external signal
    """
