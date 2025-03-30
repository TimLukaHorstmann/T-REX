# backend/api/ocr.py
import io
import json
import httpx
import pytesseract
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = '/usr/bin/tesseract'

async def process_ocr(engine: str, model: str, image_bytes: bytes, OLLAMA_API_URL: str) -> str:
    """
    Process an image using the specified OCR engine and return CSV text with '#' delimiter.
    """
    if engine == "tesseract":
        return process_tesseract_ocr(image_bytes)
    elif engine == "ollama":
        return await process_ollama_ocr(image_bytes, model, OLLAMA_API_URL)
    else:
        raise ValueError("Unsupported OCR engine.")

def process_tesseract_ocr(image_bytes: bytes) -> str:
    # Convert bytes to image
    image = Image.open(io.BytesIO(image_bytes))
    # Perform OCR
    text = pytesseract.image_to_string(image, lang="eng")
    # Process text to CSV
    return process_ocr_text_to_csv(text)

async def process_ollama_ocr(image_bytes: bytes, model: str, OLLAMA_API_URL: str) -> str:
    # Convert image to base64
    import base64
    base64_string = base64.b64encode(image_bytes).decode("utf-8")
    
    payload = {
        "model": model,
        "prompt": "Return only the table extracted from the image as #-separated values! Do not include row numbers or any additional text. Preserve any commas that appear in numbers. DO NOT USE A COMMA AS A DELIMITER.",
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
            return process_ollama_csv(data["response"])
        except httpx.RequestError as e:
            raise Exception(f"Ollama API error: {str(e)}")

def process_ocr_text_to_csv(ocr_text: str) -> str:
    lines = ocr_text.split("\n")
    lines = [line.strip() for line in lines if line.strip()]
    if not lines:
        return ""
    
    # Replace multiple spaces/tabs with '#'
    lines = [line.replace("\t", "#").replace("  ", "#").strip() for line in lines]
    
    # Merge split header if second line is short
    if len(lines) > 1:
        header_tokens = lines[0].split("#")
        second_tokens = lines[1].split("#")
        if len(second_tokens) < 3:
            header_tokens[-1] = header_tokens[-1] + " " + " ".join(second_tokens)
            lines[0] = "#".join(header_tokens)
            lines.pop(1)
    
    expected_columns = lines[0].count("#") + 1
    processed_lines = [lines[0]]
    buffer = ""
    
    for line in lines[1:]:
        cols = line.split("#")
        if len(cols) < expected_columns:
            buffer += (buffer and " " or "") + line
            if buffer.count("#") + 1 >= expected_columns:
                processed_lines.append(buffer)
                buffer = ""
        else:
            if buffer:
                line = buffer + " " + line
                buffer = ""
            processed_lines.append(line)
    if buffer:
        processed_lines.append(buffer)
    
    return "\n".join(processed_lines)

def process_ollama_csv(csv_text: str) -> str:
    csv_text = csv_text.replace('"', '')
    placeholder = "THOUSANDSSEP"
    
    def protect_thousand_separators(text):
        regex = r"(\d),(\d{3})(?!\d)"
        import re
        while re.search(regex, text):
            text = re.sub(regex, r"\1" + placeholder + r"\2", text)
        return text
    
    csv_text = protect_thousand_separators(csv_text)
    lines = [line.strip() for line in csv_text.split("\n") if line.strip()]
    processed_lines = []
    
    for line in lines:
        cells = line.split(",")
        if cells[0] == "":
            cells.pop(0)
        processed_lines.append("#".join(cells))
    
    result = "\n".join(processed_lines)
    return result.replace(placeholder, ",")