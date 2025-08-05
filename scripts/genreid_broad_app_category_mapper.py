import pandas as pd
import argparse
import sys
from pathlib import Path


def map_genre_to_category(genre_id: str, category_dict: dict) -> str:
    """
    Map a genreId to its broad category using the consolidation dictionary.

    Args:
        genre_id: The genre ID to map
        category_dict: Dictionary mapping genre IDs to categories

    Returns:
        The broad category for the genre ID
    """
    if pd.isna(genre_id):
        return "Uncategorised"

    genre_id = str(genre_id).strip()

    # Check for exact match first
    if genre_id in category_dict:
        return category_dict[genre_id]

    # Check for GAME_ pattern match
    if genre_id.startswith("GAME_"):
        return "Games"

    return "Uncategorised"


def process_genre_column(
    df: pd.DataFrame,
    genre_column: str = "genreId",
    output_column: str = "broad_app_category",
) -> pd.DataFrame:
    """
    Process a DataFrame to map genreId column to broad_app_category.

    Args:
        df: Input DataFrame
        genre_column: Name of the column containing genre IDs
        output_column: Name of the output column for broad categories

    Returns:
        DataFrame with the new broad_app_category column
    """
    category_consolidation = {
        "GAME_": "Games",
        "GAME_BOARD": "Games",
        "GAME_PUZZLE": "Games",
        "GAME_STRATEGY": "Games",
        "GAME_ARCADE": "Games",
        "GAME_WORD": "Games",
        "GAME_EDUCATIONAL": "Games",
        "GAME_ACTION": "Games",
        "GAME_CASUAL": "Games",
        "GAME_ROLE_PLAYING": "Games",
        "GAME_CASINO": "Games",
        "GAME_ADVENTURE": "Games",
        "GAME_RACING": "Games",
        "GAME_SIMULATION": "Games",
        "GAME_CARD": "Games",
        "GAME_SPORTS": "Games",
        "GAME_MUSIC": "Games",
        "GAME_TRIVIA": "Games",
        "VIDEO_PLAYERS": "Video Players (e.g. YouTube)",
        "ENTERTAINMENT": "Entertainment",
        "COMICS": "Entertainment",
        "MUSIC_AND_AUDIO": "Entertainment",
        "BOOKS_AND_REFERENCE": "Entertainment",
        "SPORTS": "Entertainment",
        "LIFESTYLE": "Lifestyle",
        "BEAUTY": "Lifestyle",
        "FOOD_AND_DRINK": "Lifestyle",
        "HOUSE_AND_HOME": "Lifestyle",
        "PARENTING": "Lifestyle",
        "SHOPPING": "Lifestyle",
        "NEWS_AND_MAGAZINES": "Lifestyle",
        "SOCIAL": "Social & Communication",
        "COMMUNICATION": "Social & Communication",
        "DATING": "Social & Communication",
        "EVENTS": "Social & Communication",
        "BUSINESS": "Productivity & Business",
        "FINANCE": "Productivity & Business",
        "PRODUCTIVITY": "Productivity & Business",
        "TOOLS": "Productivity & Business",
        "PERSONALIZATION": "Productivity & Business",
        "ART_AND_DESIGN": "Productivity & Business",
        "AUTO_AND_VEHICLES": "Productivity & Business",
        "HEALTH_AND_FITNESS": "Health",
        "MEDICAL": "Health",
        "EDUCATION": "Education",
        "TRAVEL_AND_LOCAL": "Travel & Local",
        "MAPS_AND_NAVIGATION": "Travel & Local",
        "WEATHER": "Travel & Local",
        "PHOTOGRAPHY": "Photography",
    }

    df[output_column] = df[genre_column].apply(
        lambda x: map_genre_to_category(x, category_consolidation)
    )
    return df


def read_file(file_path: str) -> pd.DataFrame:
    """
    Read Excel or CSV file into a DataFrame.

    Args:
        file_path: Path to the input file

    Returns:
        DataFrame containing the file data
    """
    path_obj = Path(file_path)

    if not path_obj.exists():
        raise FileNotFoundError(f"Input file not found: {path_obj}")

    file_extension = path_obj.suffix.lower()

    if file_extension in [".xlsx", ".xls"]:
        return pd.read_excel(path_obj)
    elif file_extension == ".csv":
        return pd.read_csv(path_obj)
    else:
        raise ValueError(
            f"Unsupported file format: {file_extension}. Supported formats: .xlsx, .xls, .csv"
        )


def write_file(df: pd.DataFrame, file_path: str, output_format: str | None = None):
    """
    Write DataFrame to Excel or CSV file.

    Args:
        df: DataFrame to write
        file_path: Path to the output file
        output_format: Format to write ('xlsx', 'csv', or None for auto-detect)
    """
    path_obj = Path(file_path)

    if output_format:
        file_extension = f".{output_format}"
    else:
        file_extension = path_obj.suffix.lower()

    if file_extension in [".xlsx", ".xls"]:
        df.to_excel(path_obj, index=False)
    elif file_extension == ".csv":
        df.to_csv(path_obj, index=False)
    else:
        raise ValueError(
            f"Unsupported output format: {file_extension}. Supported formats: .xlsx, .xls, .csv"
        )


def insert_column_after(
    df: pd.DataFrame, new_column: str, after_column: str
) -> pd.DataFrame:
    """
    Insert a new column after a specified column.

    Args:
        df: Input DataFrame
        new_column: Name of the new column to insert
        after_column: Name of the column to insert after

    Returns:
        DataFrame with the new column inserted in the correct position
    """
    if after_column not in df.columns:
        raise ValueError(f"Column '{after_column}' not found in DataFrame")

    cols = list(df.columns)
    after_index = cols.index(after_column)

    new_cols = cols[: after_index + 1] + [new_column] + cols[after_index + 1 :]
    new_cols.remove(new_column)

    return df[new_cols]


def process_file(
    input_file: str,
    output_file: str | None = None,
    genre_column: str = "genreId",
    output_column: str = "broad_app_category",
    output_format: str | None = None,
):
    """
    Process an input file and save the result with the new column map.

    Args:
        input_file: Path to the input file
        output_file: Path to the output file (optional, auto-generated if not provided)
        genre_column: Name of the column containing genre IDs
        output_column: Name of the output column for broad categories
        output_format: Output format ('xlsx', 'csv', or None for auto-detect)
    """
    print(f"Reading input file: {input_file}")
    df = read_file(input_file)

    if genre_column not in df.columns:
        available_columns = ", ".join(df.columns)
        raise ValueError(
            f"Column '{genre_column}' not found in the file. Available columns: {available_columns}"
        )

    print(f"Processing {len(df)} rows...")
    df = process_genre_column(df, genre_column, output_column)

    df = insert_column_after(df, output_column, genre_column)

    if output_file is None:
        input_path = Path(input_file)
        output_file = str(
            input_path.parent / f"{input_path.stem}_with_categories{input_path.suffix}"
        )

    print(f"Writing output file: {output_file}")
    write_file(df, output_file, output_format)

    print(f"Processing complete! Output saved to: {output_file}")

    category_counts = df[output_column].value_counts()
    print("\nCategory distribution:")
    for category, count in category_counts.items():
        print(f"  {category}: {count}")


def main():
    parser = argparse.ArgumentParser(
        description="Map genre IDs to broad app categories"
    )
    parser.add_argument("input_file", help="Input file path (.xlsx, .xls, or .csv)")
    parser.add_argument("-o", "--output", help="Output file path (optional)")
    parser.add_argument(
        "-g",
        "--genre-column",
        default="genreId",
        help="Name of the column containing genre IDs (default: genreId)",
    )
    parser.add_argument(
        "-c",
        "--category-column",
        default="broad_app_category",
        help="Name of the output column for broad categories (default: broad_app_category)",
    )
    parser.add_argument(
        "-f",
        "--format",
        choices=["xlsx", "csv"],
        help="Output format (auto-detected from output file extension if not specified)",
    )

    args = parser.parse_args()

    try:
        process_file(
            input_file=args.input_file,
            output_file=args.output,
            genre_column=args.genre_column,
            output_column=args.category_column,
            output_format=args.format,
        )
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
