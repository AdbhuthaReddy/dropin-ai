import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main
from app.services.cloud_state import CloudRepository, dispatch
from test_cloud import Database, transactional


class CloudApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "STATE_BACKEND": "sqlite", "INVENTORY_DB_PATH": str(Path(self.temp.name) / "api.sqlite3"),
            "AUTO_RESEARCH_ENABLED": "true", "PUBLIC_DATASHEET_CONSENT": "true",
            "USER_DAILY_JOBS": "3", "GLOBAL_DAILY_JOBS": "20",
            "USER_DAILY_ACTIONS": "40", "GLOBAL_DAILY_ACTIONS": "400",
        })
        self.environment.start()
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.repo = CloudRepository(Database())
        main.app.state.inventory = self.repo
        self.mode = patch.object(main, "cloud_mode", return_value=True)
        self.mode.start()
        self.tx = patch("app.services.cloud_state.firestore.transactional", transactional)
        self.tx.start()
        self.auth = patch.object(main, "require_user", return_value="jury")
        self.auth.start()

    def tearDown(self):
        self.auth.stop()
        self.tx.stop()
        self.mode.stop()
        self.client.__exit__(None, None, None)
        self.environment.stop()
        self.temp.cleanup()

    def test_anonymous_post_rejected_before_invalid_json_is_parsed(self):
        with patch.object(main, "require_user", side_effect=HTTPException(401, "Sign in")):
            response = self.client.post("/api/inventory/pmic/stock", content=b"not json",
                                        headers={"content-type": "application/json", "Origin": "http://localhost:3000"})
        self.assertEqual(response.status_code, 401)
        self.assertIn("x-request-id", response.headers)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")

    def test_stock_crossing_queues_and_worker_records_evidence_without_stock_change(self):
        with patch("app.services.cloud_state.dispatch") as enqueue:
            response = self.client.post("/api/inventory/pmic/stock", json={"stock": 1000, "expected_revision": 0})
        self.assertEqual(response.status_code, 200)
        enqueue.assert_called_once()
        item = next(entry for entry in response.json()["items"] if entry["id"] == "pmic")
        token = item["workflow"]["job_id"]
        report = {"status": "COMPARISON_READY_FOR_REVIEW", "inventory_changed": False}
        with patch.object(main, "require_worker"), \
                patch("app.services.workflow.run_workflow", new_callable=AsyncMock, return_value=report):
            result = self.client.post(f"/internal/jobs/{token}")
        self.assertEqual(result.status_code, 200)
        saved = self.client.get(f"/api/jobs/{token}").json()
        self.assertEqual(saved["result"], report)
        self.assertNotIn("input", saved)
        self.assertNotIn("actor", saved)
        item = next(entry for entry in self.repo.snapshot()["items"] if entry["id"] == "pmic")
        self.assertEqual(item["stock"], 1000)
        self.assertFalse(item["isProcessing"])

    def test_failed_dispatch_retains_durable_outbox(self):
        with patch("app.services.cloud_state.dispatch", side_effect=RuntimeError("queue temporarily unavailable")):
            response = self.client.post("/api/inventory/pmic/stock", json={"stock": 1000, "expected_revision": 0})
        self.assertEqual(response.status_code, 200)
        item = next(entry for entry in response.json()["items"] if entry["id"] == "pmic")
        self.assertEqual(self.repo.job(item["workflow"]["job_id"])["state"], "queued")

    def test_budget_returns_explicit_429(self):
        with patch.dict(os.environ, {"GLOBAL_DAILY_JOBS": "0"}):
            response = self.client.post("/api/inventory/pmic/stock", json={"stock": 1000, "expected_revision": 0})
        self.assertEqual(response.status_code, 429)

    def test_public_read_requires_no_identity(self):
        with patch.object(main, "require_user", side_effect=AssertionError("must not verify public reads")):
            self.assertEqual(self.client.get("/api/inventory").status_code, 200)

    def test_worker_cannot_be_invoked_without_service_identity(self):
        with patch.object(main, "require_worker", side_effect=HTTPException(401, "Worker identity required")):
            response = self.client.post("/internal/jobs/" + "a" * 32)
        self.assertEqual(response.status_code, 401)

    def test_duplicate_active_task_does_not_repeat_provider_work(self):
        with patch("app.services.cloud_state.dispatch"):
            response = self.client.post("/api/inventory/pmic/stock", json={"stock": 1000, "expected_revision": 0})
        item = next(entry for entry in response.json()["items"] if entry["id"] == "pmic")
        token = item["workflow"]["job_id"]
        self.repo.transition(token, "starting", claim=True)
        with patch.object(main, "require_worker"), patch("app.services.workflow.run_workflow", new_callable=AsyncMock) as worker:
            duplicate = self.client.post(f"/internal/jobs/{token}")
        self.assertEqual(duplicate.status_code, 503)
        worker.assert_not_awaited()

    def test_reset_before_worker_claim_cancels_without_provider_work(self):
        with patch("app.services.cloud_state.dispatch"):
            response = self.client.post("/api/inventory/pmic/stock", json={"stock": 1000, "expected_revision": 0})
        item = next(entry for entry in response.json()["items"] if entry["id"] == "pmic")
        token = item["workflow"]["job_id"]
        self.repo.change("reviewer", "reset", revision=self.repo.snapshot()["revision"])
        with patch.object(main, "require_worker"), patch("app.services.workflow.run_workflow", new_callable=AsyncMock) as worker:
            result = self.client.post(f"/internal/jobs/{token}")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.repo.job(token)["state"], "cancelled")
        worker.assert_not_awaited()

    def test_task_payload_has_oidc_and_deadline(self):
        with patch.dict(os.environ, {"GOOGLE_CLOUD_PROJECT": "demo", "TASK_REGION": "us-central1",
                                     "TASK_QUEUE": "research", "WORKER_URL": "https://worker.test",
                                     "WORKER_AUDIENCE": "https://worker.test",
                                     "TASK_SERVICE_ACCOUNT": "tasks@demo.iam.gserviceaccount.com"}), \
                patch("app.services.cloud_state.tasks_v2.CloudTasksClient") as factory:
            factory.return_value.queue_path.return_value = "projects/demo/locations/us-central1/queues/research"
            dispatch("a" * 32)
            task = factory.return_value.create_task.call_args.kwargs["task"]
        self.assertEqual(task.http_request.oidc_token.audience, "https://worker.test")
        self.assertEqual(task.dispatch_deadline.total_seconds(), 600)
        self.assertEqual(task.http_request.body, b"{}")
