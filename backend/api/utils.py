# backend/api/utils.py
import csv
import io
import pandas as pd

def _determine_delimiter(csv_text: str) -> str:
    """
    Determines the delimiter (',' or '#') based on the first line of the CSV text.
    Defaults to ',' if the text is empty or has no clear delimiter preference.
    """
    if not csv_text or not csv_text.strip():
        return ',' # Default delimiter if empty

    # Get the first non-empty line
    lines = csv_text.strip().splitlines()
    if not lines:
        return ',' # Default if only whitespace lines

    first_line = lines[0]
    comma_count = first_line.count(',')
    hash_count = first_line.count('#')
    # Prefer comma if counts are equal or comma count is higher
    return ',' if comma_count >= hash_count else '#'

def csv_to_markdown(csv_text: str) -> str:

    delimiter = _determine_delimiter(csv_text)

    f = io.StringIO(csv_text)
    reader = csv.reader(f, delimiter=delimiter)
    rows = list(reader)
    if not rows:
        return ""
    
    headers = rows[0]
    md = "| " + " | ".join(headers) + " |\n"
    md += "| " + " | ".join(["---"] * len(headers)) + " |\n"
    for row in rows[1:]:
        md += "| " + " | ".join(row) + " |\n"
    return md

def csv_to_naturalized(csv_text: str) -> str:
    """
    Converts CSV text into a natural language description of the table.
    """
    if not csv_text.strip():
        return "Table is empty."

    try:
        delimiter = _determine_delimiter(csv_text)

        table_io = io.StringIO(csv_text)
        df = pd.read_csv(table_io, delimiter=delimiter)

        if df.empty:
            return "Table has headers but no data rows."

        rows_naturalized = []
        # Iterate using index and row data
        for i, row_data in df.iterrows():
            # Create a list of "Column: Value" pairs.
            descriptions = [f"{col}: {row_data[col]}" for col in df.columns]
            row_text = f"Row index {i}: " + ", ".join(descriptions) + "."
            rows_naturalized.append(row_text)
        # Join all rows into one natural language text.
        return " ".join(rows_naturalized)

    except Exception as e:
        print(f"Error during CSV naturalization: {e}")
        return f"Error processing table: {e}"