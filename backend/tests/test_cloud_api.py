import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import main
from app.services.cloud_state import CloudRepository
from app.services.gemini_engine import ProviderUnavailable
from test_cloud import Database, transactional


class CloudApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "STATE_BACKEND": "sqlite", "INVENTORY_DB_PATH": str(Path(self.temp.name) / "api.sqlite3"),
            "AUTO_RESEARCH_ENABLED": "true", "PUBLIC_DATASHEET_CONSENT": "true",
            "USER_DAILY_JOBS": "3", "GLOBAL_DAILY_JOBS": "3",
            "USER_DAILY_ACTIONS": "100", "GLOBAL_DAILY_ACTIONS": "100",
            "GOOGLE_CLOUD_PROJECT": "fixture", "DEMO_ACCESS_CODE": "x" * 24,
        })
        self.environment.start()
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.repo = CloudRepository(Database())
        main.app.state.inventory = self.repo
        self.mode = patch.dict(os.environ, {"STATE_BACKEND": "firestore"})
        self.mode.start()
        self.tx = patch("app.services.cloud_state.firestore.transactional", transactional)
        self.tx.start()
        self.headers = {"Authorization": "Bearer " + "x" * 24}

    def tearDown(self):
        self.tx.stop()
        self.mode.stop()
        self.client.__exit__(None, None, None)
        self.environment.stop()
        self.temp.cleanup()

    def item(self):
        return next(entry for entry in self.repo.snapshot()["items"] if entry["id"] == "pmic")

    def drop(self):
        return self.client.post("/api/inventory/pmic/stock", headers=self.headers,
                                json={"stock": 1000, "expected_revision": self.item()["revision"]})

    def test_auth_before_parsing_and_public_reads(self):
        for headers in ({}, {"Authorization": "Bearer wrong"}):
            self.assertEqual(self.client.post("/api/access", json={}, headers=headers).status_code, 401)
        self.assertEqual(self.client.post("/api/access", json={}, headers=self.headers).status_code, 200)
        response = self.client.post("/api/inventory/pmic/stock", content=b"invalid",
                                    headers={"content-type": "application/json", "Origin": "http://localhost:3000"})
        self.assertEqual(response.status_code, 401)
        self.assertIn("x-request-id", response.headers)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")
        self.assertEqual(self.client.get("/api/inventory").status_code, 200)

    def test_threshold_runs_inline_and_preserves_stock_with_public_evidence(self):
        report = {"status": "COMPARISON_READY_FOR_REVIEW", "inventory_changed": False}

        async def workflow(item, progress):
            await progress("exact_search")
            return report

        with patch("app.services.workflow.run_workflow", side_effect=workflow) as run:
            response = self.drop()
        self.assertEqual(response.status_code, 200)
        run.assert_called_once()
        item = self.item()
        self.assertEqual(item["stock"], 1000)
        self.assertEqual(item["workflow"]["stage"], "completed")
        self.assertFalse(item["isProcessing"])
        saved = self.client.get("/api/jobs/" + item["workflow"]["job_id"]).json()
        self.assertEqual(saved["result"], report)
        self.assertNotIn("input", saved)
        self.assertNotIn("actor", saved)

    def test_rate_limit_failure_is_saved_not_fabricated(self):
        with patch("app.services.workflow.run_workflow", side_effect=ProviderUnavailable("rate limited", reason="rate_limited")):
            self.assertEqual(self.drop().status_code, 200)
        item = self.item()
        self.assertEqual(item["stock"], 1000)
        self.assertEqual(item["workflow"]["stage"], "failed")
        self.assertIn("HTTP 429", item["researchError"])
        self.assertIn("does not by itself mean your account quota has been used", item["researchError"])
        self.assertIsNone(self.repo.job(item["workflow"]["job_id"])["result"])

    def test_resume_waits_for_lease_then_recovers_expired_work(self):
        token = self.repo.change("presenter", "stock", item_id="pmic", stock=1000, revision=0)
        self.repo.transition(token, "starting", claim=True)
        with patch("app.services.workflow.run_workflow", return_value={"status": "FIXTURE"}) as run:
            body = {"expected_revision": self.item()["revision"]}
            response = self.client.post("/api/inventory/pmic/workflow", json=body, headers=self.headers)
            self.assertEqual(response.status_code, 409)
            run.assert_not_called()
            with patch("app.services.cloud_state.time.time", return_value=self.repo.job(token)["lease_until"] + 1):
                response = self.client.post("/api/inventory/pmic/workflow", json=body, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.repo.job(token)["state"], "completed")
        self.assertEqual(self.repo.job(token)["attempts"], 2)

    def test_reset_before_claim_and_during_progress_cancels_obsolete_research(self):
        token = self.repo.change("presenter", "stock", item_id="pmic", stock=1000, revision=0)
        self.repo.change("presenter", "reset", revision=self.repo.snapshot()["revision"])
        self.assertIsNone(self.repo.transition(token, "starting", claim=True))

        async def workflow(item, progress):
            self.repo.change("presenter", "reset", revision=self.repo.snapshot()["revision"])
            await progress("alternative_discovery")
            raise AssertionError("Obsolete research must stop.")

        with patch("app.services.workflow.run_workflow", side_effect=workflow):
            self.assertEqual(self.drop().status_code, 200)
        self.assertEqual(self.item()["stock"], 8000)
        self.assertIsNone(self.item()["workflow"])

    def test_budget_and_consent_rejection(self):
        with patch.dict(os.environ, {"GLOBAL_DAILY_JOBS": "0"}):
            self.assertEqual(self.drop().status_code, 429)
        with patch.dict(os.environ, {"PUBLIC_DATASHEET_CONSENT": "false"}):
            response = self.client.post("/api/inventory/pmic/workflow",
                                        json={"expected_revision": 0}, headers=self.headers)
            self.assertEqual(response.status_code, 503)

    def test_removed_worker_routes_are_not_exposed(self):
        for path in ("/internal/dispatch", "/internal/jobs/" + "a" * 32):
            self.assertEqual(self.client.post(path, json={}, headers=self.headers).status_code, 404)

    def test_cloud_startup_needs_only_project_passcode_and_firestore(self):
        with patch.dict(os.environ, {"K_SERVICE": "dropin-demo"}), \
                patch("app.services.cloud_state.CloudRepository", return_value=self.repo):
            with TestClient(main.app) as client:
                self.assertEqual(client.get("/health").status_code, 200)
        with patch.dict(os.environ, {"DEMO_ACCESS_CODE": ""}):
            with self.assertRaisesRegex(RuntimeError, "presenter passcode"):
                with TestClient(main.app):
                    pass
