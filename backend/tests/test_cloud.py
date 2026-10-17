import copy
import os
import unittest
from unittest.mock import patch

from app.services.cloud_state import BudgetError, CloudRepository
from app.services.inventory import ConflictError
from google.api_core.exceptions import AlreadyExists


class Snapshot:
    def __init__(self, value):
        self.value = copy.deepcopy(value)

    def to_dict(self):
        return copy.deepcopy(self.value)


class Ref:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def get(self, transaction=None):
        return Snapshot(self.db.data.get(self.path))

    def create(self, value):
        if self.path in self.db.data:
            raise AlreadyExists("exists")
        self.db.data[self.path] = copy.deepcopy(value)


class Collection:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def document(self, name):
        return Ref(self.db, f"{self.name}/{name}")


class Transaction:
    def __init__(self, db):
        self.db, self.writes = db, []

    def set(self, ref, value):
        self.writes.append((ref.path, copy.deepcopy(value)))

    create = set

    def update(self, ref, value):
        self.set(ref, {**self.db.data[ref.path], **value})

    def commit(self):
        self.db.data.update(self.writes)


class Database:
    def __init__(self):
        self.data = {}

    def collection(self, name):
        return Collection(self, name)

    def transaction(self):
        return Transaction(self)


def transactional(function):
    def wrapped(tx):
        result = function(tx)
        tx.commit()
        return result
    return wrapped


class CloudStateTests(unittest.TestCase):
    def setUp(self):
        self.patch = patch("app.services.cloud_state.firestore.transactional", transactional)
        self.patch.start()
        self.environment = patch.dict(os.environ, {
            "AUTO_RESEARCH_ENABLED": "true", "USER_DAILY_JOBS": "3", "GLOBAL_DAILY_JOBS": "20",
            "USER_DAILY_ACTIONS": "40", "GLOBAL_DAILY_ACTIONS": "400",
        })
        self.environment.start()
        self.db = Database()
        self.repo = CloudRepository(self.db)

    def tearDown(self):
        self.environment.stop()
        self.patch.stop()

    def item(self):
        return next(item for item in self.repo.snapshot()["items"] if item["id"] == "pmic")

    def drop(self):
        return self.repo.change("reviewer", "stock", item_id="pmic", stock=1000, revision=self.item()["revision"])

    def test_crossing_enqueues_exactly_one_job_atomically(self):
        job_id = self.drop()
        self.assertEqual(self.repo.job(job_id)["state"], "queued")
        self.assertEqual(self.item()["stock"], 1000)
        self.assertTrue(self.item()["isProcessing"])
        self.assertIsNone(self.repo.change("reviewer", "stock", item_id="pmic", stock=900, revision=self.item()["revision"]))

    def test_equal_threshold_does_not_queue(self):
        self.assertIsNone(self.repo.change("reviewer", "stock", item_id="pmic", stock=self.item()["safetyStock"], revision=0))

    def test_auto_can_be_disabled(self):
        with patch.dict(os.environ, {"AUTO_RESEARCH_ENABLED": "false"}):
            self.assertIsNone(self.drop())

    def test_stale_edit_does_not_spend_budget_or_overwrite(self):
        self.drop()
        before = copy.deepcopy(self.db.data)
        with self.assertRaises(ConflictError):
            self.repo.change("reviewer", "stock", item_id="pmic", stock=8000, revision=0)
        self.assertEqual(before, self.db.data)

    def test_budget_rejection_rolls_back_inventory_and_job(self):
        with patch.dict(os.environ, {"USER_DAILY_JOBS": "0"}):
            with self.assertRaises(BudgetError):
                self.drop()
        self.assertEqual(self.item()["stock"], 8000)
        self.assertFalse(any(key.startswith("research_jobs/") for key in self.db.data))

    def test_global_budget_applies_to_other_users(self):
        self.drop()
        with patch.dict(os.environ, {"GLOBAL_DAILY_JOBS": "1"}):
            with self.assertRaises(BudgetError):
                self.repo.consume("another-reviewer")

    def test_live_lease_rejects_duplicate_worker(self):
        job_id = self.drop()
        self.repo.transition(job_id, "starting", claim=True)
        with self.assertRaises(ConflictError):
            self.repo.transition(job_id, "starting", claim=True)

    def test_reset_invalidates_late_completion(self):
        job_id = self.drop()
        self.repo.transition(job_id, "starting", claim=True)
        self.repo.change("reviewer", "reset", revision=self.repo.snapshot()["revision"])
        self.assertIsNone(self.repo.transition(job_id, "completed", result={"status": "research"}))
        self.assertEqual(self.item()["stock"], 8000)
        self.assertIsNone(self.item()["workflow"])
        self.assertEqual(self.repo.job(job_id)["state"], "cancelled")

    def test_completion_does_not_change_inventory_and_is_idempotent(self):
        job_id = self.drop()
        self.repo.transition(job_id, "starting", claim=True)
        self.repo.transition(job_id, "completed", result={"status": "review"})
        self.assertEqual(self.item()["stock"], 1000)
        self.assertFalse(self.item()["isProcessing"])
        revision = self.repo.snapshot()["revision"]
        self.assertIsNone(self.repo.transition(job_id, "completed", result={"status": "duplicate"}))
        self.assertEqual(self.repo.snapshot()["revision"], revision)

    def test_worker_recovery_is_bounded(self):
        job_id = self.drop()
        with patch("app.services.cloud_state.time.time", return_value=100):
            self.repo.transition(job_id, "starting", claim=True)
        with patch("app.services.cloud_state.time.time", return_value=1000):
            self.repo.transition(job_id, "starting", claim=True)
        with patch("app.services.cloud_state.time.time", return_value=2000):
            self.repo.transition(job_id, "starting", claim=True)
        self.assertEqual(self.repo.job(job_id)["state"], "failed")
        self.assertFalse(self.item()["isProcessing"])

    def test_report_size_is_bounded(self):
        job_id = self.drop()
        with self.assertRaises(ValueError):
            self.repo.transition(job_id, "completed", result={"large": "X" * 710_000})
        self.assertTrue(self.item()["isProcessing"])
