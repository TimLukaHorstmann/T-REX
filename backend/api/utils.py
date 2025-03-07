# backend/api/utils.py
import pandas as pd
import io
import json

def format_table_to_markdown(csv_text: str) -> str:
    """
    Converts CSV text (using "#" as delimiter) into a Markdown table.
    """
    try:
        df = pd.read_csv(io.StringIO(csv_text), delimiter="#")
        return df.to_markdown(index=False)
    except Exception as e:
        return "Error formatting table: " + str(e)


def naturalize_table(df: pd.DataFrame) -> str:
    """
    Convert a pandas DataFrame to a natural language description.
    Each row is described in a sentence.
    """
    rows = []
    for i, row in df.iterrows():
        # Create a list of "Column: Value" pairs.
        descriptions = [f"{col}: {row[col]}" for col in df.columns]
        row_text = f"Row {i + 1}: " + ", ".join(descriptions) + "."
        rows.append(row_text)
    # Join all rows into one natural language text.
    return " ".join(rows)


def format_table_to_json(table: pd.DataFrame) -> str:
    """
    Convert a pandas DataFrame to a JSON-formatted string.
    The JSON will have two keys: "columns" and "data".
    """
    table_dict = {
        "columns": list(table.columns),
        "data": table.values.tolist()
    }
    return json.dumps(table_dict, indent=2)


def format_table_to_html(table: pd.DataFrame) -> str:
    """
    Convert a pandas DataFrame to an HTML-formatted table.
    The resulting HTML includes a simple border and a CSS class for further styling.
    """
    # You can customize the HTML (e.g. add Bootstrap classes) if desired.
    return table.to_html(index=False, border=1, classes="table table-striped")