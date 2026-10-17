"""Short-lived parser process; no provider credentials or network work."""
import json
import sys

if sys.platform != "win32":
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))

from app.services.pdf_extract import DocumentError, MAX_PDF_BYTES, extract_document

if __name__ == "__main__":
    try:
        print(json.dumps(extract_document(sys.stdin.buffer.read(MAX_PDF_BYTES + 1), sys.argv[1])))
    except DocumentError as exc:
        print(json.dumps({"error": str(exc)}))
