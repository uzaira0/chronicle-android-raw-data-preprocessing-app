"""Protocol definitions for framework-agnostic callbacks.

This module defines callback protocols that allow the core business logic to
communicate with different interfaces (GUI, CLI, web) without depending on
any specific framework.
"""

from __future__ import annotations

from typing import Protocol


class ProgressCallback(Protocol):
    """Protocol for reporting progress during operations.

    The GUI can implement this to emit Qt signals, the CLI can implement it
    to print progress bars, and automated pipelines can implement it to log
    progress or update monitoring systems.
    """

    def __call__(self, message: str, current: int, total: int) -> None:
        """Report progress.

        Args:
            message: Human-readable progress message
            current: Current item number (1-indexed)
            total: Total number of items
        """
        ...


class CancellationCheck(Protocol):
    """Protocol for checking if an operation should be cancelled.

    The GUI can implement this to check a Qt flag, the CLI can implement it
    to check for Ctrl+C, and automated pipelines can use timeouts or
    external signals.
    """

    def __call__(self) -> bool:
        """Check if operation should be cancelled.

        Returns:
            True if operation should be cancelled, False otherwise
        """
        ...


class LogCallback(Protocol):
    """Protocol for logging messages during operations.

    The GUI can implement this to emit signals to a log panel, the CLI can
    implement it to print to stderr, and automated pipelines can send logs
    to centralized logging systems.
    """

    def __call__(self, level: str, message: str) -> None:
        """Log a message.

        Args:
            level: Log level (debug, info, warning, error, critical)
            message: Log message
        """
        ...


class PlottingStartedCallback(Protocol):
    """Protocol for notification when plotting starts.

    Used to notify the interface that the plotting phase has begun,
    allowing UI updates or status changes.
    """

    def __call__(self) -> None:
        """Notify that plotting has started."""
        ...


class PlottingCompletedCallback(Protocol):
    """Protocol for notification when plotting completes.

    Used to notify the interface that the plotting phase has finished,
    allowing UI updates or status changes.
    """

    def __call__(self) -> None:
        """Notify that plotting has completed."""
        ...
