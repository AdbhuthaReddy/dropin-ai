import hashlib
import io

from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PAGES = 120
MAX_TEXT_CHARS = 160_000


class DocumentError(ValueError):
    pass


def extract_document(content: bytes, name: str) -> dict:
    if len(content) > MAX_PDF_BYTES:
        raise DocumentError("Each PDF must be at most 10 MiB.")
    if not content.startswith(b"%PDF-"):
        raise DocumentError("The selected file is not a PDF.")
    try:
        reader = PdfReader(io.BytesIO(content), strict=True)
        if reader.is_encrypted:
            raise DocumentError("Encrypted PDFs are not supported; provide an unencrypted datasheet.")
        if not 1 <= len(reader.pages) <= MAX_PAGES:
            raise DocumentError("PDFs must contain 1 to 120 pages.")
        pages = []
        total_chars = 0
        for page in reader.pages:
            text = page.extract_text() or ""
            total_chars += len(text)
            if total_chars > MAX_TEXT_CHARS:
                raise DocumentError("Extracted text exceeds 160,000 characters; provide a smaller datasheet.")
            pages.append(text)
    except (PdfReadError, OSError, RecursionError) as exc:
        raise DocumentError("The PDF is malformed or could not be read.") from exc
    if not any(text.strip() for text in pages):
        raise DocumentError("No extractable text found. Scanned/image PDFs require OCR, which is not configured.")
    return {
        "name": name, "sha256": hashlib.sha256(content).hexdigest(),
        "page_count": len(pages), "text_characters": total_chars, "pages": pages,
        "pages_without_text": [index + 1 for index, text in enumerate(pages) if not text.strip()],
    }
