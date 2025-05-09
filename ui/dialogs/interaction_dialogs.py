"""
Specialized interaction type dialog windows for Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from PyQt6.QtCore import QSize, Qt, QTimer
from PyQt6.QtGui import QShowEvent
from PyQt6.QtWidgets import (
    QCheckBox,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from config.constants import (
    POSSIBLE_INTERACTION_TYPES_TO_REMOVE,
    POSSIBLE_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    POSSIBLE_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    InteractionType,
)

if TYPE_CHECKING:
    from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
    from ui.windows.main_window import ChronicleAndroidRawDataPreprocessingGUI

LOGGER = logging.getLogger(__name__)


class BaseInteractionTypesDialog(QDialog):
    def __init__(
        self,
        parent: ChronicleAndroidRawDataPreprocessingGUI,
        title: str,
        options: ChronicleAndroidRawDataPreprocessingOptions,
        interaction_types_map: dict,
        default_selections: list[InteractionType],
        locked_selections: list[InteractionType],
    ) -> None:
        super().__init__(parent)
        self.parent_ = parent
        self.options = options
        self.interaction_types_map = interaction_types_map
        self.default_selections = default_selections
        self.locked_selections = locked_selections

        self.scale_factor = 1.0
        if hasattr(parent, "scale_factor"):
            self.scale_factor = parent.scale_factor  # type: ignore  # noqa: PGH003

        self.setWindowTitle(title)
        self.setMinimumWidth(int(500 * self.scale_factor))  # Smaller minimum width
        self.setFixedWidth(int(500 * self.scale_factor))  # Smaller fixed width
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)  # Allow height to adjust based on content

        self.main_layout = QVBoxLayout(self)

        description_label = QLabel("Check the box for each interaction type you want to select for this category.")
        description_label.setWordWrap(True)
        description_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        description_label.setStyleSheet("font-size: 11pt; margin-bottom: 10px;")
        self.main_layout.addWidget(description_label)

        if locked_selections:
            note_label = QLabel("Note: Items marked with (*) are selected by default.")
            note_label.setStyleSheet("color: #606060; font-style: italic; margin-bottom: 10px;")
            note_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.main_layout.addWidget(note_label)

        self.create_interaction_types_checkboxes()

        self.buttons_layout = QHBoxLayout()

        self.ok_button = QPushButton("OK")
        self.ok_button.clicked.connect(self.accept)
        self.ok_button.setFixedSize(QSize(int(80 * self.scale_factor), int(30 * self.scale_factor)))

        self.cancel_button = QPushButton("Cancel")
        self.cancel_button.clicked.connect(self.reject)
        self.cancel_button.setFixedSize(QSize(int(80 * self.scale_factor), int(30 * self.scale_factor)))

        self.buttons_layout.addStretch()
        self.buttons_layout.addWidget(self.ok_button)
        self.buttons_layout.addWidget(self.cancel_button)

        self.main_layout.addLayout(self.buttons_layout)

        QTimer.singleShot(0, self.center_on_parent)

    def showEvent(self, a0: QShowEvent | None) -> None:
        """
        Handle the dialog show event to ensure proper centering.
        """
        super().showEvent(a0)

        self.center_on_parent()

    def center_on_parent(self) -> None:
        """
        Center the dialog window on the parent widget.
        """
        if self.parent_ is None:
            return

        self.adjustSize()

        parent_geo = self.parent_.geometry()
        self_geo = self.geometry()

        x = parent_geo.x() + (parent_geo.width() - self_geo.width()) // 2
        y = parent_geo.y() + (parent_geo.height() - self_geo.height()) // 2

        x = max(x, 0)
        y = max(y, 0)

        self.move(x, y)

    def create_interaction_types_checkboxes(self) -> None:
        """
        Create a scrollable list of interaction types with checkboxes.
        """

        scroll_widget = QWidget()
        self.scroll_layout = QVBoxLayout(scroll_widget)
        self.scroll_layout.setContentsMargins(10, 10, 10, 10)
        self.scroll_layout.setSpacing(10)

        self.scroll_layout.setAlignment(Qt.AlignmentFlag.AlignLeft)

        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setWidget(scroll_widget)
        scroll_area.setFrameShape(QFrame.Shape.StyledPanel)  # Add a subtle frame
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)

        self.checkboxes = {}

        sorted_types = sorted(self.interaction_types_map.items(), key=lambda x: x[0])

        for description, interaction_type in sorted_types:
            is_default = interaction_type in self.default_selections
            is_locked = interaction_type in self.locked_selections

            label_text = f"{description} ({interaction_type.value})"
            if is_locked:
                label_text = f"(*) {label_text}"

            checkbox = QCheckBox(label_text)
            checkbox.setChecked(is_default)
            checkbox.setToolTip(f"Interaction type: {interaction_type.value}")
            checkbox.setStyleSheet("""
                QCheckBox {
                    font-size: 10pt;
                    padding: 5px;
                    min-height: 25px;
                }
                QCheckBox::indicator {
                    width: 20px;
                    height: 20px;
                }
            """)

            if is_locked:
                checkbox.setEnabled(False)
                checkbox.setStyleSheet(
                    checkbox.styleSheet()
                    + """
                    QCheckBox:disabled {
                        color: #404040;
                        font-weight: bold;
                    }
                """
                )
                checkbox.setToolTip("This option is required and cannot be changed")

            self.checkboxes[interaction_type] = checkbox

            self.scroll_layout.addWidget(checkbox)

            if (description, interaction_type) != sorted_types[-1]:
                line = QFrame()
                line.setFrameShape(QFrame.Shape.HLine)
                line.setFrameShadow(QFrame.Shadow.Sunken)
                line.setStyleSheet("background-color: #E0E0E0;")
                line.setFixedHeight(1)  # Make the separator line thinner
                self.scroll_layout.addWidget(line)

        scroll_area.setMinimumHeight(int(200 * self.scale_factor))
        scroll_area.setMaximumHeight(int(300 * self.scale_factor))
        self.main_layout.addWidget(scroll_area)

    def get_selected_interaction_types(self) -> set[InteractionType]:
        """
        Get the selected interaction types.

        Returns:
            set[InteractionType]: Set of selected interaction types
        """
        selected_types = set()

        for interaction_type, checkbox in self.checkboxes.items():
            if checkbox.isChecked():
                selected_types.add(interaction_type)

        for locked_type in self.locked_selections:
            selected_types.add(locked_type)

        return selected_types


class SameAppInteractionTypesDialog(BaseInteractionTypesDialog):
    def __init__(self, parent: ChronicleAndroidRawDataPreprocessingGUI, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
        locked_selections = [InteractionType.ACTIVITY_PAUSED]

        if options.same_app_interaction_types_configured and options.same_app_interaction_types_to_stop_usage_at:
            default_selections = list(options.same_app_interaction_types_to_stop_usage_at)
        else:
            default_selections = [InteractionType.ACTIVITY_PAUSED]

        super().__init__(
            parent=parent,
            title="Configure Same App Interaction Types to Stop Usage At",
            options=options,
            interaction_types_map=POSSIBLE_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT,
            default_selections=default_selections,
            locked_selections=locked_selections,
        )


class OtherInteractionTypesDialog(BaseInteractionTypesDialog):
    def __init__(self, parent: ChronicleAndroidRawDataPreprocessingGUI, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
        locked_selections = [InteractionType.DEVICE_SHUTDOWN]

        if options.other_interaction_types_configured and options.other_interaction_types_to_stop_usage_at:
            default_selections = list(options.other_interaction_types_to_stop_usage_at)
        else:
            default_selections = [InteractionType.DEVICE_SHUTDOWN]

        super().__init__(
            parent=parent,
            title="Configure Other Interaction Types to Stop Usage At",
            options=options,
            interaction_types_map=POSSIBLE_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT,
            default_selections=default_selections,
            locked_selections=locked_selections,
        )


class InteractionTypesToRemoveDialog(BaseInteractionTypesDialog):
    def __init__(self, parent: ChronicleAndroidRawDataPreprocessingGUI, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
        locked_selections = []

        if options.interaction_types_to_remove_configured and options.interaction_types_to_remove:
            default_selections = list(options.interaction_types_to_remove)
        else:
            default_selections = []

        super().__init__(
            parent=parent,
            title="Configure Interaction Types to Remove from Final Output",
            options=options,
            interaction_types_map=POSSIBLE_INTERACTION_TYPES_TO_REMOVE,
            default_selections=default_selections,
            locked_selections=locked_selections,
        )
