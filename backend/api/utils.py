# backend/api/utils.py
def csv_to_markdown(csv_text: str) -> str:
    """
    Converts CSV text into a Markdown-formatted table.
    Uses '#' as delimiter if present; otherwise uses comma.
    """
    lines = [line for line in csv_text.strip().splitlines() if line.strip()]
    if not lines:
        return ""
    delimiter = "#" if "#" in lines[0] else ","
    table_data = [line.split(delimiter) for line in lines]
    headers = table_data[0]
    rows = table_data[1:]
    md = "| " + " | ".join(headers) + " |\n"
    md += "| " + " | ".join(["---"] * len(headers)) + " |\n"
    for row in rows:
        md += "| " + " | ".join(row) + " |\n"
    return md