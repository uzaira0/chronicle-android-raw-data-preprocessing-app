# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import os
import sys
import PyInstaller.config

block_cipher = None

# Determine platform
is_windows = sys.platform.startswith('win')
is_macos = sys.platform.startswith('darwin')

# List all modules that need to be included
hidden_imports = [
    # Application modules (src/ layout)
    'chronicle_preprocessing_app',
    'chronicle_preprocessing_app.config',
    'chronicle_preprocessing_app.config.constants',
    'chronicle_preprocessing_app.config.defaults',
    'chronicle_preprocessing_app.config.version',
    'chronicle_preprocessing_app.core',
    'chronicle_preprocessing_app.core.config',
    'chronicle_preprocessing_app.core.callbacks',
    'chronicle_preprocessing_app.core.exceptions',
    'chronicle_preprocessing_app.core.models',
    'chronicle_preprocessing_app.core.schemas',
    'chronicle_preprocessing_app.core.dataframe_provider',
    'chronicle_preprocessing_app.core.preprocessing',
    'chronicle_preprocessing_app.core.preprocessing.main_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.base_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.timezone_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.app_usage_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.app_filter_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.column_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.survey_data_preprocessor',
    'chronicle_preprocessing_app.core.preprocessing.study_date_provider',
    'chronicle_preprocessing_app.core.preprocessing.dataframe_api',
    'chronicle_preprocessing_app.core.preprocessing.algorithms',
    'chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_algorithms',
    'chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_details_optimizer',
    'chronicle_preprocessing_app.core.plotting',
    'chronicle_preprocessing_app.core.plotting.plotting_manager',
    'chronicle_preprocessing_app.gui',
    'chronicle_preprocessing_app.gui.windows',
    'chronicle_preprocessing_app.gui.windows.main_window',
    'chronicle_preprocessing_app.gui.panels',
    'chronicle_preprocessing_app.gui.panels.config_panel',
    'chronicle_preprocessing_app.gui.panels.options_panel',
    'chronicle_preprocessing_app.gui.panels.plotting_panel',
    'chronicle_preprocessing_app.gui.panels.status_panel',
    'chronicle_preprocessing_app.gui.dialogs',
    'chronicle_preprocessing_app.gui.dialogs.filter_dialog',
    'chronicle_preprocessing_app.gui.dialogs.interaction_dialogs',
    'chronicle_preprocessing_app.gui.workers',
    'chronicle_preprocessing_app.gui.workers.preprocessing_thread',
    'chronicle_preprocessing_app.gui.utils',
    'chronicle_preprocessing_app.gui.utils.config_manager',
    'chronicle_preprocessing_app.gui.utils.ui_helpers',
    'chronicle_preprocessing_app.cli',
    'chronicle_preprocessing_app.utils',
    'chronicle_preprocessing_app.utils.file_utils',
    'chronicle_preprocessing_app.web',
    # Third-party dependencies
    'pandas',
    'polars',
    'pyarrow',
    'numpy',
    'matplotlib',
    'pydantic',
    'pandera',
    'openpyxl',
    'openpyxl.styles',
    'pytz',
    'dateutil',
    'dateutil.parser',
    'dateutil.tz',
    'PyQt6',
    'PyQt6.QtCore',
    'PyQt6.QtGui',
    'PyQt6.QtWidgets',
    # Standard library
    'datetime',
    'json',
    'shutil',
    'logging',
    'sys',
    're',
    'contextlib',
    'functools',
    'typing',
    'dataclasses',
    'pathlib',
]

# Data files to bundle (non-Python files needed at runtime)
datas = [
    ('app_codebook_files', 'app_codebook_files'),
    ('apps_to_filter_files', 'apps_to_filter_files'),
]

a = Analysis(
    ['main.py'],
    pathex=['src'],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['_tkinter', 'tcl', 'tk', 'test', 'unittest', 'pydoc', 'doctest'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(
    a.pure, 
    a.zipped_data,
    cipher=block_cipher,
    compress=True
)

# Windows EXE configuration
if is_windows:
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name='ChronicleAndroidRawDataPreprocessingApp',
        debug=False,
        bootloader_ignore_signals=True,
        strip=True,
        upx=True,
        upx_exclude=['vcruntime140.dll', 'python*.dll', '*.pyd'],
        console=False,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon='ui/resources/icon.ico' if Path('ui/resources/icon.ico').exists() else None,
        uac_admin=False,
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=['vcruntime140.dll', 'python*.dll', '*.pyd'],
        name='ChronicleAndroidRawDataPreprocessingApp',
    )

# macOS App configuration
if is_macos:
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name='ChronicleAndroidRawDataPreprocessingApp',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,  # Setting to False to avoid stripping symbols that might be needed
        upx=True,
        console=False,
        disable_windowed_traceback=False,
        argv_emulation=True,  # Enable argv emulation for macOS
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon='ui/resources/icon.ico' if Path('ui/resources/icon.ico').exists() else None,
    )
    
    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=True,
        name='ChronicleAndroidRawDataPreprocessingApp',
    )
    
    app = BUNDLE(
        coll,
        name='ChronicleAndroidRawDataPreprocessingApp.app',
        icon='ui/resources/icon.ico' if Path('ui/resources/icon.ico').exists() else None,
        bundle_identifier='com.chronicle.rawdatapreprocessingapp',
        info_plist={
            'NSPrincipalClass': 'NSApplication',
            'NSAppleScriptEnabled': False,
            'NSHighResolutionCapable': True,
            'CFBundleDisplayName': 'Chronicle Android Raw Data Preprocessing App',
            'CFBundleName': 'ChronicleAndroidRawDataPreprocessingApp',
        },
    ) 