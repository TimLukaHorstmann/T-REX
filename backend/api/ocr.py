import io
import csv
import json
import re
import httpx
import pytesseract
from PIL import Image

# Set tesseract executable path
pytesseract.pytesseract.tesseract_cmd = '/usr/bin/tesseract'

async def process_ocr(engine: str, model: str, image_bytes: bytes, OLLAMA_API_URL: str) -> str:
    """
    Process an image using the specified OCR engine and return CSV text with commas as delimiters.
    """
    if engine == "tesseract":
        return process_tesseract_ocr(image_bytes)
    elif engine == "ollama":
        return await process_ollama_ocr(image_bytes, model, OLLAMA_API_URL)
    else:
        raise ValueError("Unsupported OCR engine.")
    
def process_tesseract_ocr(image_bytes: bytes) -> str:
    """
    Process the image using Tesseract OCR and convert the resulting text into CSV.
    """
    # Convert bytes to an image
    image = Image.open(io.BytesIO(image_bytes))
    # Perform OCR to get text
    ocr_text = pytesseract.image_to_string(image, lang="eng")
    return process_text_to_csv(ocr_text)

async def process_ollama_ocr(image_bytes: bytes, model: str, OLLAMA_API_URL: str) -> str:
    """
    Process the image with Ollama OCR. It sends the image (encoded in base64) to the API,
    then processes the CSV text returned by the API.
    
    The payload prompt now requests a CSV output with commas as delimiters.
    """
    import base64
    base64_string = base64.b64encode(image_bytes).decode("utf-8")
    
    payload = {
        "model": model,
        "prompt": (
            "Return only the table extracted from the image as CSV with commas as delimiters. "
            "Wrap cells that contain commas in double quotes. Do not include row numbers or any additional text."
        ),
        "images": [base64_string],
        "stream": False,
        "keep_alive": 0
    }
    
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        try:
            response = await client.post(OLLAMA_API_URL, json=payload)
            response.raise_for_status()
            data = response.json()
            if "response" not in data:
                raise ValueError("Ollama response missing 'response' key.")
            return process_csv_text(data["response"])
        except httpx.RequestError as e:
            raise Exception(f"Ollama API error: {str(e)}")

def process_text_to_csv(ocr_text: str) -> str:
    """
    Convert raw OCR text into a CSV formatted string.
    
    This function splits the text into non-empty lines, then splits each line into cells based
    on tabs or two-or-more consecutive whitespace characters. It then writes the rows to a CSV
    string using Python’s csv.writer, ensuring that any cells containing commas are automatically
    quoted.
    
    Before writing the CSV, it checks if the first column is an index column 
    (header cell is empty and all other first cells are numbers) and, if so, removes it.
    """
    # Split the OCR output into non-empty lines.
    lines = [line.strip() for line in ocr_text.splitlines() if line.strip()]
    if not lines:
        return ""
    
    rows = []
    for line in lines:
        # Split on tabs or two or more whitespace characters.
        cells = re.split(r'\t+|\s{2,}', line)
        # Remove extra spaces from each cell.
        cells = [cell.strip() for cell in cells if cell.strip()]
        rows.append(cells)
        
    output = io.StringIO()
    writer = csv.writer(output, delimiter=',', quoting=csv.QUOTE_MINIMAL)
    for row in rows:
        writer.writerow(row)
    return output.getvalue()

def process_csv_text(csv_text: str) -> str:
    """
    Process CSV text received from the Ollama OCR API.
    
    This function attempts to read the API text as CSV (using csv.reader) and then re-writes it 
    using csv.writer to ensure standard CSV formatting (i.e. correct quoting of cells with commas).
    
    It also removes the first column if it detects an index column (empty header cell and numeric values).
    """
    input_io = io.StringIO(csv_text)
    try:
        reader = csv.reader(input_io, delimiter=',')
        rows = list(reader)
    except Exception:
        # Fallback: If csv.reader fails, manually split into rows and cells.
        rows = [line.split(',') for line in csv_text.splitlines() if line.strip()]
    
    # Remove the index column if applicable.
    rows = [row[1:] for row in rows]
    
    output = io.StringIO()
    writer = csv.writer(output, delimiter=',', quoting=csv.QUOTE_MINIMAL)
    for row in rows:
        writer.writerow(row)
    return output.getvalue()