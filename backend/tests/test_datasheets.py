import io
import unittest
from unittest.mock import AsyncMock, patch

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from app.services import datasheets, pdf_extract
from app.services.gemini_engine import Provenance


def pdf_fixture(text="Supply range 1.8V to 3.3V"):
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=400)
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)}),
    })
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 20 200 Td ({text}) Tj ET".encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class DocumentTests(unittest.TestCase):
    def test_real_pdf_extraction_with_hash_and_pages(self):
        document = datasheets.extract_document(pdf_fixture(), "test.pdf")
        self.assertEqual(document["page_count"], 1)
        self.assertEqual(len(document["sha256"]), 64)
        self.assertIn("Supply range 1.8V to 3.3V", document["pages"][0])
        self.assertNotIn("pages", datasheets.document_summary(document))

    def test_not_pdf_rejected(self):
        with self.assertRaises(datasheets.DocumentError):
            datasheets.extract_document(b"not a pdf", "test.pdf")

    def test_malformed_pdf_rejected(self):
        with self.assertRaises(datasheets.DocumentError):
            datasheets.extract_document(b"%PDF-invalid", "test.pdf")

    def test_encrypted_pdf_rejected(self):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.encrypt("secret")
        output = io.BytesIO()
        writer.write(output)
        with self.assertRaises(datasheets.DocumentError):
            datasheets.extract_document(output.getvalue(), "test.pdf")

    def test_image_or_blank_pdf_rejected(self):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        output = io.BytesIO()
        writer.write(output)
        with self.assertRaises(datasheets.DocumentError):
            datasheets.extract_document(output.getvalue(), "test.pdf")

    def test_size_limit(self):
        with patch.object(pdf_extract, "MAX_PDF_BYTES", 10), self.assertRaises(datasheets.DocumentError):
            datasheets.extract_document(pdf_fixture(), "test.pdf")

    def test_page_limit(self):
        with patch.object(pdf_extract, "MAX_PAGES", 0), self.assertRaises(datasheets.DocumentError):
            datasheets.extract_document(pdf_fixture(), "test.pdf")

    def test_text_limit(self):
        with patch.object(pdf_extract, "MAX_TEXT_CHARS", 10), self.assertRaises(datasheets.DocumentError):
            datasheets.extract_document(pdf_fixture(), "test.pdf")


class ComparisonTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original = datasheets.extract_document(pdf_fixture(), "original.pdf")
        self.candidate = datasheets.extract_document(pdf_fixture("Supply range 2.4V to 3.3V"), "candidate.pdf")
        self.draft = {
            "comparisons": [{
                "parameter": "Supply", "finding": "difference", "explanation": "Minimum supply differs.",
                "original": {"page": 1, "quote": "Supply range 1.8V to 3.3V"},
                "candidate": {"page": 1, "quote": "Supply range 2.4V to 3.3V"},
            }],
            "limitations": ["Circuit requirements need engineering review"],
        }

    async def test_no_consent_means_no_provider_call(self):
        with patch.object(datasheets, "generate_json", new_callable=AsyncMock) as generate:
            result = await datasheets.compare_documents(self.original, self.candidate, "", False)
        generate.assert_not_called()
        self.assertEqual(result["status"], "LOCAL_EXTRACTION_ONLY")
        self.assertFalse(result["is_drop_in_replacement"])

    async def test_genuine_evidence_is_returned_but_never_approved(self):
        with patch.object(datasheets, "generate_json", new_callable=AsyncMock) as generate:
            generate.return_value = (self.draft, Provenance(model="fixture", grounding_status="document_text"))
            result = await datasheets.compare_documents(self.original, self.candidate, "Needs 1.8V", True)
        self.assertFalse(result["is_drop_in_replacement"])
        self.assertEqual(result["status"], "HOLD_FOR_ENGINEERING_REVIEW")
        self.assertEqual(len(result["comparisons"]), 1)
        self.assertEqual(result["documents"]["original"]["sha256"], self.original["sha256"])
        self.assertIn("Needs 1.8V", generate.call_args.args[1])
        self.assertFalse(generate.call_args.kwargs["search"])

    async def test_hallucinated_excerpt_rejected(self):
        self.draft["comparisons"][0]["candidate"]["quote"] = "Not in either document"
        with patch.object(datasheets, "generate_json", new_callable=AsyncMock) as generate:
            generate.return_value = (self.draft, Provenance())
            with self.assertRaises(datasheets.DocumentError):
                await datasheets.compare_documents(self.original, self.candidate, "", True)

    async def test_nonexistent_page_rejected(self):
        self.draft["comparisons"][0]["original"]["page"] = 2
        with patch.object(datasheets, "generate_json", new_callable=AsyncMock) as generate:
            generate.return_value = (self.draft, Provenance())
            with self.assertRaises(datasheets.DocumentError):
                await datasheets.compare_documents(self.original, self.candidate, "", True)

    async def test_missing_firmware_assessment_remains_unknown(self):
        with patch.object(datasheets, "generate_json", new_callable=AsyncMock, return_value=(self.draft, Provenance())):
            result = await datasheets.compare_documents(self.original, self.candidate, "", True)
        self.assertEqual(len(result["change_assessment"]), 8)
        self.assertTrue(all(entry["status"] == "unknown" for entry in result["change_assessment"]))

    async def test_change_claim_requires_valid_evidence_reference(self):
        for indices in ([], [10], [-1]):
            self.draft["change_assessment"] = [{
                "area": "firmware", "status": "change_required", "explanation": "Register map differs.",
                "evidence_indices": indices,
            }]
            with patch.object(datasheets, "generate_json", new_callable=AsyncMock, return_value=(self.draft, Provenance())):
                with self.assertRaises(datasheets.DocumentError):
                    await datasheets.compare_documents(self.original, self.candidate, "", True)

    async def test_change_claim_with_cited_evidence_is_still_not_approval(self):
        self.draft["change_assessment"] = [{
            "area": "power", "status": "change_required", "explanation": "Minimum supply differs.",
            "evidence_indices": [0],
        }]
        with patch.object(datasheets, "generate_json", new_callable=AsyncMock, return_value=(self.draft, Provenance())):
            result = await datasheets.compare_documents(self.original, self.candidate, "", True)
        self.assertEqual(next(entry for entry in result["change_assessment"] if entry["area"] == "power")["status"], "change_required")
        self.assertFalse(result["is_drop_in_replacement"])
