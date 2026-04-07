"""
UI helper functions for Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

import logging

from PyQt6.QtWidgets import QApplication, QWidget

LOGGER = logging.getLogger(__name__)


def get_scale_factor() -> float:
    """
    Calculate the display scaling factor based on screen DPI.

    Returns:
        float: The scaling factor for UI elements
    """
    app = QApplication.instance()
    if app and isinstance(app, QApplication):
        screen = app.primaryScreen()
        if screen:
            dpi = screen.physicalDotsPerInch()
            return max(1.0, dpi / 96.0)
    return 1.0


def set_widget_size(
    widget: QWidget, width: int, height: int, scale_factor: float | None = None
) -> None:
    """
    Set the size of a widget with optional scaling.

    Args:
        widget: The widget to resize
        width: The base width
        height: The base height
        scale_factor: The scaling factor (uses get_scale_factor if None)
    """
    if scale_factor is None:
        scale_factor = get_scale_factor()

    widget.setFixedSize(int(width * scale_factor), int(height * scale_factor))
