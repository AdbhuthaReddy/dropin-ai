import os
import tempfile
import threading
import unittest
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

with patch("dotenv.load_dotenv"):
    from app import main
from fastapi.testclient import TestClient
from app.services.gemini_engine import Provenance, ProviderUnavailable, normalize_verdict
from test_datasheets import pdf_fixture
from test_research import verdict_payload


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "INVENTORY_DB_PATH": str(Path(self.temp.name) / "api.sqlite3"), "GEMINI_API_KEY": "",
        })
        self.environment.start()
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.environment.stop()
        self.temp.cleanup()

    def item(self):
        return next(item for item in self.client.get("/api/inventory").json()["items"] if item["id"] == "pmic")

    def test_health_available_without_api_key(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        self.assertEqual(self.client.get("/ready").status_code, 503)

    def test_invalid_inputs(self):
        for payload in [
            {}, {"target_mpn": ""}, {"target_mpn": " "}, {"target_mpn": "X", "search_mode": "bad"},
            {"target_mpn": "X", "inventory_level": -1}, {"target_mpn": "X", "inventory_level": 1.5},
            {"target_mpn": "X", "inventory_level": None}, {"target_mpn": "X", "lead_time_weeks": -1},
            {"target_mpn": "X" * 201}, {"target_mpn": "X", "unrecognized": True},
        ]:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post("/api/webhooks/sap-line-down", json=payload).status_code, 422)

    def test_stock_api_validation(self):
        for stock in [-1, 1.5, None, True, 1_000_000_001]:
            self.assertEqual(self.client.post("/api/inventory/pmic/stock", json={
                "stock": stock, "expected_revision": 0,
            }).status_code, 422)

    def test_cors_preflight(self):
        for origin, expected in [("http://localhost:3000", 200), ("https://untrusted.example", 400)]:
            response = self.client.options("/api/inventory", headers={
                "Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
            })
            self.assertEqual(response.status_code, expected)

    def test_recommendation_always_hold_even_at_high_confidence(self):
        verdict = normalize_verdict(verdict_payload(), "PART-A", "alternative", Provenance())
        with patch.object(main, "evaluate_component_shortage", new_callable=AsyncMock, return_value=verdict):
            response = self.client.post("/api/webhooks/sap-line-down", json={"target_mpn": "PART-A"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["procurement_status"], "HOLD_FOR_ENGINEERING_REVIEW")
        self.assertFalse(response.json()["aml_authorization"])
        self.assertIsNone(response.json()["purchase_order_id"])

    def test_shared_research_never_changes_stock(self):
        item = self.item()
        verdict = normalize_verdict(verdict_payload(), item["mpn"], "alternative", Provenance())
        token = str(uuid4())
        with patch.object(main, "evaluate_component_shortage", new_callable=AsyncMock, return_value=verdict) as provider:
            response = self.client.post("/api/inventory/pmic/research", json={
                "request_id": token, "search_mode": "alternative", "expected_revision": item["revision"],
            })
            duplicate = self.client.post("/api/inventory/pmic/research", json={
                "request_id": token, "search_mode": "alternative", "expected_revision": item["revision"],
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(provider.await_count, 1)
        self.assertEqual(self.item()["stock"], item["stock"])
        self.assertFalse(self.item()["isProcessing"])
        self.assertIsNotNone(self.item()["aiVerdict"])

    def test_stock_conflict(self):
        self.assertEqual(self.client.post("/api/inventory/pmic/stock", json={"stock": 0, "expected_revision": 0}).status_code, 200)
        self.assertEqual(self.client.post("/api/inventory/pmic/stock", json={"stock": 8000, "expected_revision": 0}).status_code, 409)
        self.assertEqual(self.item()["stock"], 0)

    def test_reset_while_endpoint_is_waiting_rejects_late_result(self):
        started, release = threading.Event(), threading.Event()
        verdict = normalize_verdict(verdict_payload(), self.item()["mpn"], "alternative", Provenance())

        async def delayed(*args):
            started.set()
            await asyncio.to_thread(release.wait, 5)
            return verdict

        with patch.object(main, "evaluate_component_shortage", side_effect=delayed), ThreadPoolExecutor(max_workers=1) as worker:
            future = worker.submit(self.client.post, "/api/inventory/pmic/research", json={
                "request_id": str(uuid4()), "search_mode": "alternative", "expected_revision": 0,
            })
            try:
                self.assertTrue(started.wait(5))
                revision = self.client.get("/api/inventory").json()["revision"]
                reset = self.client.post("/api/inventory/reset", json={"expected_revision": revision})
                self.assertEqual(reset.status_code, 200)
            finally:
                release.set()
            self.assertEqual(future.result(timeout=5).status_code, 200)
        self.assertEqual(self.item()["stock"], 8000)
        self.assertIsNone(self.item()["aiVerdict"])
        self.assertFalse(self.item()["isProcessing"])

    def test_unknown_component(self):
        self.assertEqual(self.client.post("/api/inventory/unknown/stock", json={"stock": 0, "expected_revision": 0}).status_code, 404)

    def test_provider_failure_records_error_and_clears_processing(self):
        with patch.object(main, "evaluate_component_shortage", new_callable=AsyncMock, side_effect=ProviderUnavailable("SECRET")):
            response = self.client.post("/api/inventory/pmic/research", json={
                "request_id": str(uuid4()), "search_mode": "exact", "expected_revision": 0,
            })
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("SECRET", response.text)
        self.assertFalse(self.item()["isProcessing"])
        self.assertIn("Reference:", self.item()["researchError"])
        self.assertIn("x-request-id", response.headers)

    def test_rate_limit_failure_has_safe_actionable_detail(self):
        with patch.object(main, "evaluate_component_shortage", new_callable=AsyncMock,
                          side_effect=ProviderUnavailable("PRIVATE_PROVIDER_BODY", reason="rate_limited")):
            response = self.client.post("/api/webhooks/sap-line-down", json={"target_mpn": "TEST"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("HTTP 429", response.text)
        self.assertIn("does not by itself mean your account quota has been used", response.text)
        self.assertIn("Google AI Studio", response.text)
        self.assertNotIn("PRIVATE_PROVIDER_BODY", response.text)

    def test_depleted_prepayment_has_actionable_detail(self):
        with patch.object(main, "evaluate_component_shortage", new_callable=AsyncMock,
                          side_effect=ProviderUnavailable("PRIVATE_PROVIDER_BODY", reason="payment_required")):
            response = self.client.post("/api/webhooks/sap-line-down", json={"target_mpn": "TEST"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("prepayment credits", response.text)
        self.assertIn("Google AI Studio", response.text)
        self.assertNotIn("PRIVATE_PROVIDER_BODY", response.text)

    def test_unexpected_provider_error_has_sanitized_reference(self):
        with patch.object(main, "evaluate_component_shortage", new_callable=AsyncMock,
                          side_effect=RuntimeError("PRIVATE_TRANSPORT_DETAIL")):
            response = self.client.post("/api/webhooks/sap-line-down", json={"target_mpn": "TEST"})
        self.assertEqual(response.status_code, 502)
        self.assertIn("Reference:", response.text)
        self.assertNotIn("PRIVATE_TRANSPORT_DETAIL", response.text)

    def test_legacy_pdf_path_api_explicitly_removed(self):
        response = self.client.post("/api/evaluate-arbitrage", json={
            "original_pdf_path": "nonexistent.pdf", "candidate_pdf_path": "nonexistent.pdf",
        })
        self.assertEqual(response.status_code, 410)

    def test_pdf_workflow_has_total_deadline(self):
        async def stalled(*args):
            await asyncio.sleep(1)

        with patch.object(main, "DOCUMENT_DEADLINE_SECONDS", 0.01), \
                patch.object(main, "extract_pair", side_effect=stalled), \
                patch.object(main, "compare_documents", new_callable=AsyncMock) as provider:
            response = self.client.post("/api/datasheets/compare", files={
                "original": ("original.pdf", pdf_fixture(), "application/pdf"),
                "candidate": ("candidate.pdf", pdf_fixture(), "application/pdf"),
            })
        self.assertEqual(response.status_code, 503)
        self.assertIn("deadline exceeded", response.text)
        provider.assert_not_awaited()

    def test_real_pdf_upload_local_extraction(self):
        response = self.client.post("/api/datasheets/compare", files={
            "original": ("original.pdf", pdf_fixture(), "application/pdf"),
            "candidate": ("candidate.pdf", pdf_fixture(), "application/pdf"),
        }, data={"consent": "false"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "LOCAL_EXTRACTION_ONLY")
        self.assertFalse(response.json()["is_drop_in_replacement"])

    def test_invalid_pdf_upload(self):
        response = self.client.post("/api/datasheets/compare", files={
            "original": ("original.pdf", b"not a pdf", "application/pdf"),
            "candidate": ("candidate.pdf", pdf_fixture(), "application/pdf"),
        })
        self.assertEqual(response.status_code, 422)
