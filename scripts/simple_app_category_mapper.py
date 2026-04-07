import pandas as pd
import sys
import os
from pathlib import Path
from PyQt6.QtWidgets import (
    QApplication,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QProgressBar,
    QTextEdit,
    QFileDialog,
    QMessageBox,
    QFrame,
)
from PyQt6.QtCore import QThread, pyqtSignal, Qt
from PyQt6.QtGui import QFont


class ProcessingThread(QThread):
    progress_updated = pyqtSignal(int)
    status_updated = pyqtSignal(str)
    log_updated = pyqtSignal(str)
    finished = pyqtSignal()
    error_occurred = pyqtSignal(str)

    def __init__(self, input_folder, output_folder, app_codebook_path):
        super().__init__()
        self.input_folder = input_folder
        self.output_folder = output_folder
        self.app_codebook_path = app_codebook_path

    def run(self):
        try:
            self.log_updated.emit("Loading app codebook...")
            app_codebook = self.load_app_codebook()
            if app_codebook is None:
                self.log_updated.emit("Failed to load app codebook")
                return

            self.log_updated.emit(f"Loaded app codebook with {len(app_codebook)} entries")

            input_path = Path(self.input_folder)
            output_path = Path(self.output_folder)
            output_path.mkdir(exist_ok=True)

            csv_files = list(input_path.glob("*.csv"))
            if not csv_files:
                self.log_updated.emit("No CSV files found in input folder")
                return

            self.log_updated.emit(f"Found {len(csv_files)} CSV files to process")

            for i, csv_file in enumerate(csv_files):
                self.status_updated.emit(f"Processing {csv_file.name}...")
                self.progress_updated.emit(int((i / len(csv_files)) * 100))

                try:
                    self.process_single_file(csv_file, output_path, app_codebook)
                    self.log_updated.emit(f"✓ Processed: {csv_file.name}")
                except Exception as e:
                    self.log_updated.emit(f"✗ Error processing {csv_file.name}: {str(e)}")

            self.progress_updated.emit(100)
            self.status_updated.emit("Processing complete!")
            self.log_updated.emit("All files processed successfully!")

        except Exception as e:
            self.error_occurred.emit(str(e))
        finally:
            self.finished.emit()

    def load_app_codebook(self):
        try:
            codebook_path = Path(self.app_codebook_path)

            if codebook_path.suffix.lower() == ".csv":
                app_codebook = pd.read_csv(codebook_path)
            elif codebook_path.suffix.lower() in (".xlsx", ".xls"):
                app_codebook = pd.read_excel(codebook_path, sheet_name=0)
            else:
                self.log_updated.emit(f"Unsupported codebook file type: {codebook_path.suffix}")
                return None

            required_columns = ["app_package_name", "genreId", "broad_app_category"]
            missing_columns = [col for col in required_columns if col not in app_codebook.columns]

            if missing_columns:
                self.log_updated.emit(f"Missing required columns in app codebook: {missing_columns}")
                return None

            return app_codebook

        except Exception as e:
            self.log_updated.emit(f"Error loading app codebook: {str(e)}")
            return None

    def process_single_file(self, input_file: Path, output_folder: Path, app_codebook: pd.DataFrame):
        self.log_updated.emit(f"Reading {input_file.name}...")
        df = pd.read_csv(input_file)

        if "app_package_name" not in df.columns:
            raise ValueError("Column 'app_package_name' not found in file")

        self.log_updated.emit(f"Processing {len(df)} rows...")

        df["genreId"] = df["app_package_name"].map(app_codebook.set_index("app_package_name")["genreId"]).fillna("Unknown")
        df["broad_app_category"] = df["app_package_name"].map(app_codebook.set_index("app_package_name")["broad_app_category"]).fillna("Unknown")

        output_file = output_folder / f"{input_file.stem}_with_categories{input_file.suffix}"
        df.to_csv(output_file, index=False)

        self.log_updated.emit(f"Saved to: {output_file.name}")

        category_counts = df["broad_app_category"].value_counts()
        self.log_updated.emit("Category distribution:")
        for category, count in category_counts.head(10).items():
            self.log_updated.emit(f"  {category}: {count}")


class AppCategoryMapperGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.processing_thread = None
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Simple App Category Mapper for Already Preprocessed Files")
        self.setGeometry(100, 100, 700, 600)

        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        layout = QVBoxLayout(central_widget)
        layout.setSpacing(10)
        layout.setContentsMargins(20, 20, 20, 20)

        title_label = QLabel("Simple App Category Mapper for Already Preprocessed Files")
        title_font = QFont()
        title_font.setPointSize(16)
        title_font.setBold(True)
        title_label.setFont(title_font)
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title_label)

        input_layout = QHBoxLayout()
        input_label = QLabel("Input Folder (Already Preprocessed CSV Files):")
        self.input_edit = QLineEdit()
        self.input_edit.setPlaceholderText("Select folder containing already preprocessed CSV files...")
        input_button = QPushButton("Browse")
        input_button.clicked.connect(self.browse_input_folder)

        input_layout.addWidget(input_label)
        input_layout.addWidget(self.input_edit)
        input_layout.addWidget(input_button)
        layout.addLayout(input_layout)

        output_layout = QHBoxLayout()
        output_label = QLabel("Output Folder:")
        self.output_edit = QLineEdit()
        self.output_edit.setPlaceholderText("Select output folder...")
        output_button = QPushButton("Browse")
        output_button.clicked.connect(self.browse_output_folder)

        output_layout.addWidget(output_label)
        output_layout.addWidget(self.output_edit)
        output_layout.addWidget(output_button)
        layout.addLayout(output_layout)

        codebook_layout = QHBoxLayout()
        codebook_label = QLabel("App Codebook:")
        self.codebook_edit = QLineEdit()
        self.codebook_edit.setPlaceholderText("Select app codebook file (NOT the backup file)...")
        codebook_button = QPushButton("Browse")
        codebook_button.clicked.connect(self.browse_app_codebook)

        codebook_layout.addWidget(codebook_label)
        codebook_layout.addWidget(self.codebook_edit)
        codebook_layout.addWidget(codebook_button)
        layout.addLayout(codebook_layout)

        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.HLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)
        layout.addWidget(separator)

        self.process_button = QPushButton("Map")
        self.process_button.clicked.connect(self.start_processing)
        self.process_button.setMinimumHeight(40)
        layout.addWidget(self.process_button)

        progress_layout = QHBoxLayout()
        progress_label = QLabel("Progress:")
        self.progress_bar = QProgressBar()
        progress_layout.addWidget(progress_label)
        progress_layout.addWidget(self.progress_bar)
        layout.addLayout(progress_layout)

        status_layout = QHBoxLayout()
        status_label = QLabel("Status:")
        self.status_label = QLabel("Ready")
        status_layout.addWidget(status_label)
        status_layout.addWidget(self.status_label)
        layout.addLayout(status_layout)

        log_label = QLabel("Log:")
        layout.addWidget(log_label)

        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        layout.addWidget(self.log_text)

    def browse_input_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Input Folder")
        if folder:
            self.input_edit.setText(folder)

    def browse_output_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Output Folder")
        if folder:
            self.output_edit.setText(folder)

    def browse_app_codebook(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "Select App Codebook File", "", "Excel files (*.xlsx);;CSV files (*.csv);;All files (*.*)")
        if file_path:
            self.codebook_edit.setText(file_path)

    def start_processing(self):
        if not self.input_edit.text():
            QMessageBox.critical(self, "Error", "Please select an input folder")
            return

        if not self.output_edit.text():
            QMessageBox.critical(self, "Error", "Please select an output folder")
            return

        if not self.codebook_edit.text():
            QMessageBox.critical(self, "Error", "Please select an app codebook file")
            return

        self.process_button.setEnabled(False)
        self.progress_bar.setValue(0)
        self.status_label.setText("Processing...")
        self.log_text.clear()

        self.processing_thread = ProcessingThread(self.input_edit.text(), self.output_edit.text(), self.codebook_edit.text())

        self.processing_thread.progress_updated.connect(self.progress_bar.setValue)
        self.processing_thread.status_updated.connect(self.status_label.setText)
        self.processing_thread.log_updated.connect(self.log_message)
        self.processing_thread.finished.connect(self.processing_finished)
        self.processing_thread.error_occurred.connect(self.processing_error)

        self.processing_thread.start()

    def log_message(self, message):
        self.log_text.append(message)
        self.log_text.ensureCursorVisible()

    def processing_finished(self):
        self.process_button.setEnabled(True)

    def processing_error(self, error_message):
        self.log_message(f"Error: {error_message}")
        self.status_label.setText("Error occurred")
        self.process_button.setEnabled(True)


def main():
    app = QApplication(sys.argv)
    window = AppCategoryMapperGUI()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
