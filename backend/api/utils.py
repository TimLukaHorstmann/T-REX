# backend/api/utils.py
import csv
import io

def csv_to_markdown(csv_text: str) -> str:
    # Determine delimiter based on the first line: if there are more commas than '#' use comma.
    first_line = csv_text.splitlines()[0]
    comma_count = first_line.count(',')
    hash_count = first_line.count('#')
    delimiter = ',' if comma_count >= hash_count else '#'

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
