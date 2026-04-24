from __future__ import annotations

import argparse
from pathlib import Path

from chronicle_preprocessing_app.utils.pathological_fixture_builder import (
    write_pathological_raw_folder,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-folder", type=Path, required=True)
    parser.add_argument("--files", type=int, default=8)
    parser.add_argument("--repetitions", type=int, default=32)
    parser.add_argument("--weeks", type=int, default=6)
    parser.add_argument("--seed", type=int, default=20260423)
    args = parser.parse_args()

    write_pathological_raw_folder(
        args.output_folder,
        file_count=args.files,
        repetitions=args.repetitions,
        weeks=args.weeks,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
