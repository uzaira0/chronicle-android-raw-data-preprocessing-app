"""
Dialog windows for the Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from PyQt6.QtWidgets import (
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)

if TYPE_CHECKING:
    from pathlib import Path

    from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
    from ui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

LOGGER = logging.getLogger(__name__)


class BaseTableWindow(QDialog):
    def __init__(
        self,
        parent: ChronicleAndroidRawDataPreprocessingGUI,
        title: str = "Table Dialog",
    ) -> None:
        super().__init__(parent)
        self.parent_ = parent

        self.scale_factor = 1.0
        if hasattr(parent, "scale_factor"):
            self.scale_factor = parent.scale_factor  # type: ignore  # noqa: PGH003

        self.setWindowTitle(title)
        self.setGeometry(
            100, 100, int(600 * self.scale_factor), int(400 * self.scale_factor)
        )

        if parent is not None:
            self.center_on_parent()

        self.main_layout = QVBoxLayout(self)

        self.table = QTableWidget(self)
        self.main_layout.addWidget(self.table)

        self.buttons_layout = QHBoxLayout()

        self.ok_button = QPushButton("OK")
        self.ok_button.clicked.connect(self.accept)

        self.cancel_button = QPushButton("Cancel")
        self.cancel_button.clicked.connect(self.reject)

        self.buttons_layout.addStretch()
        self.buttons_layout.addWidget(self.ok_button)
        self.buttons_layout.addWidget(self.cancel_button)

        self.main_layout.addLayout(self.buttons_layout)

    def center_on_parent(self) -> None:
        """
        Center the dialog window on the parent widget.
        """
        if self.parent_ is None:
            return

        parent_geo = self.parent_.geometry()
        self_geo = self.geometry()

        x = parent_geo.x() + (parent_geo.width() - self_geo.width()) // 2
        y = parent_geo.y() + (parent_geo.height() - self_geo.height()) // 2

        self.move(x, y)

    def setup_table(self, headers: list[str], data: list[list[str]]) -> None:
        """
        Set up the table with headers and data.

        Args:
            headers (list): List of column headers
            data (list, optional): List of row data
        """
        self.table.setColumnCount(len(headers))
        self.table.setHorizontalHeaderLabels(headers)

        # Resize columns to content
        header = self.table.horizontalHeader()
        if header:
            for i in range(len(headers)):
                header.setSectionResizeMode(i, QHeaderView.ResizeMode.ResizeToContents)

        if data:
            self.table.setRowCount(len(data))
            for row_idx, row_data in enumerate(data):
                for col_idx, cell_data in enumerate(row_data):
                    item = QTableWidgetItem(str(cell_data))
                    self.table.setItem(row_idx, col_idx, item)


class AppsFilterDialog(BaseTableWindow):
    def __init__(
        self,
        parent: ChronicleAndroidRawDataPreprocessingGUI,
        options: ChronicleAndroidRawDataPreprocessingOptions,
    ) -> None:
        super().__init__(parent, "Configure App Filters")
        self.options = options
        self.app_filters = {}

        self.setGeometry(
            100, 100, int(600 * self.scale_factor), int(400 * self.scale_factor)
        )

        self.center_on_parent()

        self.setup_table(["Package Name", "App Label"], [])

        self.add_row_button = QPushButton("Add Row")
        self.add_row_button.clicked.connect(self.add_row)

        self.delete_row_button = QPushButton("Delete Selected Row")
        self.delete_row_button.clicked.connect(self.delete_row)

        toolbar_layout = QHBoxLayout()
        toolbar_layout.addWidget(self.add_row_button)
        toolbar_layout.addWidget(self.delete_row_button)
        toolbar_layout.addStretch()

        self.main_layout.insertLayout(0, toolbar_layout)

        if options and hasattr(options, "filter_file") and options.filter_file:
            try:
                self.import_filter_data_from_file(options.filter_file)
            except Exception as e:
                LOGGER.error(f"Error auto-loading filter file: {e}", exc_info=True)

                if (
                    hasattr(options, "apps_to_filter_dict")
                    and options.apps_to_filter_dict
                ):
                    self.load_app_filters(options.apps_to_filter_dict)
        elif (
            options
            and hasattr(options, "apps_to_filter_dict")
            and options.apps_to_filter_dict
        ):
            self.load_app_filters(options.apps_to_filter_dict)

    def load_app_filters(self, filters_dict: dict) -> None:
        """
        Load app filters from a dictionary.

        Args:
            filters_dict (dict): Dictionary of app filters
        """
        self.app_filters = filters_dict.copy()

        self.table.setRowCount(0)

        for row_idx, (package_name, app_label) in enumerate(filters_dict.items()):
            self.table.insertRow(row_idx)
            self.table.setItem(row_idx, 0, QTableWidgetItem(package_name))
            self.table.setItem(row_idx, 1, QTableWidgetItem(app_label))

    def import_from_file(self) -> None:
        """
        Import app filters from a CSV or XLSX file.
        """
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Import App Filters", "", "Filter Files (*.csv *.xlsx)"
        )

        if not file_path:
            return

        try:
            self.import_filter_data_from_file(file_path)

            self.options.filter_file = file_path

        except Exception as e:
            LOGGER.error(f"Error importing app filters: {e}", exc_info=True)
            QMessageBox.critical(
                self, "Import Error", f"Failed to import app filters: {str(e)}"
            )

    def add_row(self) -> None:
        """
        Add a new row to the table.
        """
        row_position = self.table.rowCount()
        self.table.insertRow(row_position)
        self.table.setItem(row_position, 0, QTableWidgetItem(""))
        self.table.setItem(row_position, 1, QTableWidgetItem(""))

    def delete_row(self) -> None:
        """
        Delete the selected row from the table.
        """
        selected_row = self.table.currentRow()
        if selected_row >= 0:
            self.table.removeRow(selected_row)

    def get_app_filters(self) -> dict[str, str]:
        """
        Get the app filters from the table.

        Returns:
            dict[str, str]: Dictionary of app filters
        """
        app_filters = {}

        for row_idx in range(self.table.rowCount()):
            package_name_item = self.table.item(row_idx, 0)
            app_label_item = self.table.item(row_idx, 1)

            if package_name_item and app_label_item:
                package_name = package_name_item.text().strip()
                app_label = app_label_item.text().strip()

                if package_name:
                    app_filters[package_name] = app_label

        return app_filters

    def accept(self) -> None:
        """
        Accept the dialog and store the app filters.
        """
        self.app_filters = self.get_app_filters()
        super().accept()

    def import_filter_data_from_file(self, file_path: str | Path) -> None:
        """
        Import app filters directly from a specified file path.
        This is used when a filter file is already specified in the options.

        Args:
            file_path (str | Path): The path to the filter file
        """
        try:
            from utils.file_utils import read_filter_file

            self.table.setRowCount(0)
            self.app_filters = {}

            self.app_filters = read_filter_file(file_path)

            for row_idx, (package_name, app_label) in enumerate(
                self.app_filters.items()
            ):
                self.table.insertRow(row_idx)
                self.table.setItem(row_idx, 0, QTableWidgetItem(package_name))
                self.table.setItem(row_idx, 1, QTableWidgetItem(app_label))

            if len(self.app_filters) > 0:
                self.resize_to_fit_content()

        except Exception as e:
            LOGGER.error(
                f"Error importing app filters from file {file_path}: {e}", exc_info=True
            )
            raise ValueError(f"Failed to import app filters from file: {e}")

    def resize_to_fit_content(self) -> None:
        """
        Resize the dialog to better fit the content in the table.
        """

        self.table.resizeColumnsToContents()
        self.table.resizeRowsToContents()

        table_width = (
            sum(self.table.columnWidth(i) for i in range(self.table.columnCount())) + 40
        )  # Add margin
        table_height = min(
            400, max(150, self.table.rowCount() * 25 + 40)
        )  # Min/max height based on row count

        dialog_width = max(500, min(800, table_width + 80))
        dialog_height = table_height + 120

        self.setFixedSize(
            int(dialog_width * self.scale_factor),
            int(dialog_height * self.scale_factor),
        )
