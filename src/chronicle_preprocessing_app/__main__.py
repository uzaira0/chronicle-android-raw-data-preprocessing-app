"""Package introspection - run with: python -m chronicle_preprocessing_app"""

from __future__ import annotations

from chronicle_preprocessing_app.config.version import __version__


def main():
    print("=" * 70)
    print("Chronicle Android Raw Data Preprocessing Package")
    print("=" * 70)
    print()
    print(f"Version: {__version__}")
    print()
    print("Available imports:")
    print("    from chronicle_preprocessing_app.core import MainPreprocessor, PreprocessingOptions")
    print("    from chronicle_preprocessing_app.core import PlottingManager, ProcessingStats")
    print("    from chronicle_preprocessing_app.core.preprocessing import TimestampPreprocessor")
    print("    from chronicle_preprocessing_app.core.preprocessing.algorithms import OptimizedAppUsageAlgorithm")
    print()
    print("Get help:")
    print("    >>> from chronicle_preprocessing_app.core import MainPreprocessor")
    print("    >>> help(MainPreprocessor)")
    print()
    print("Entry points:")
    print("    chronicle-preprocess-gui    # GUI interface")
    print()
    print("Example usage (programmatic):")
    print("    from pathlib import Path")
    print("    from chronicle_preprocessing_app.core import MainPreprocessor, PreprocessingOptions")
    print()
    print("    options = PreprocessingOptions(")
    print("        study_name='MyStudy',")
    print("        raw_data_folder=Path('raw_data/'),  # Folder with CSV files")
    print("    )")
    print()
    print("    def progress(pct, current, total):")
    print("        print(f'Progress: {pct}%')")
    print()
    print("    preprocessor = MainPreprocessor(")
    print("        options=options,")
    print("        progress_callback=progress,")
    print("    )")
    print("    preprocessor.preprocess()")
    print()


if __name__ == "__main__":
    main()
