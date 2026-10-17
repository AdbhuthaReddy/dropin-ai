import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from app.services.inventory import ConflictError, InventoryRepository


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = InventoryRepository(Path(self.temp.name) / "test.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def item(self, item_id="pmic"):
        return next(item for item in self.repo.snapshot()["items"] if item["id"] == item_id)

    def test_baseline_ten_parts(self):
        items = self.repo.snapshot()["items"]
        self.assertEqual(len(items), 10)
        self.assertEqual(len({item["id"] for item in items}), 10)

    def test_stale_tab_cannot_overwrite_same_item(self):
        stale = self.item()
        self.repo.update_stock("pmic", 0, stale["revision"])
        with self.assertRaises(ConflictError):
            self.repo.update_stock("pmic", 8000, stale["revision"])
        self.assertEqual(self.item()["stock"], 0)

    def test_different_item_edit_does_not_overwrite_first_tab(self):
        battery = self.item("battery")
        self.repo.update_stock("pmic", 0, self.item()["revision"])
        self.repo.update_stock("battery", 100, battery["revision"])
        self.assertEqual(self.item()["stock"], 0)

    def test_result_does_not_modify_inventory_metadata(self):
        original = self.item()
        token = uuid4()
        self.repo.begin_research("pmic", token, "alternative", original["revision"])
        self.repo.finish_research("pmic", token, result={"candidate_mpn": "TEST", "aml_authorization": True})
        updated = self.item()
        for field in ["stock", "vendor", "description", "leadTime", "mpn"]:
            self.assertEqual(updated[field], original[field])

    def test_completed_request_is_idempotent(self):
        token = uuid4()
        self.repo.begin_research("pmic", token, "exact", self.item()["revision"])
        self.repo.finish_research("pmic", token, result={"test": 1})
        completed = self.repo.snapshot()
        self.assertFalse(self.repo.begin_research("pmic", token, "exact", 0))
        self.repo.finish_research("pmic", token, result={"test": 2})
        self.assertEqual(completed, self.repo.snapshot())

    def test_overlapping_research_rejected(self):
        revision = self.item()["revision"]
        self.repo.begin_research("pmic", uuid4(), "exact", revision)
        with self.assertRaises(ConflictError):
            self.repo.begin_research("pmic", uuid4(), "alternative", revision)

    def test_reset_invalidates_pending_research(self):
        token = uuid4()
        self.repo.begin_research("pmic", token, "exact", self.item()["revision"])
        self.repo.reset(self.repo.snapshot()["revision"])
        reset = self.repo.snapshot()
        self.repo.finish_research("pmic", token, result={"test": 1})
        self.assertEqual(reset, self.repo.snapshot())

    def test_stock_edit_invalidates_pending_research(self):
        token = uuid4()
        self.repo.begin_research("pmic", token, "exact", self.item()["revision"])
        self.repo.update_stock("pmic", 0, self.item()["revision"])
        self.repo.finish_research("pmic", token, result={"test": 1})
        self.assertEqual(self.item()["stock"], 0)
        self.assertIsNone(self.item()["aiVerdict"])

    def test_new_stock_edit_invalidates_old_verdict(self):
        token = uuid4()
        self.repo.begin_research("pmic", token, "exact", self.item()["revision"])
        self.repo.finish_research("pmic", token, result={"test": 1})
        self.repo.update_stock("pmic", 0, self.item()["revision"])
        self.assertIsNone(self.item()["aiVerdict"])

    def test_restart_clears_orphan_processing(self):
        token = uuid4()
        self.repo.begin_research("pmic", token, "exact", self.item()["revision"])
        restarted = InventoryRepository(self.repo.path)
        restarted.recover_interrupted()
        item = next(item for item in restarted.snapshot()["items"] if item["id"] == "pmic")
        self.assertFalse(item["isProcessing"])
        self.assertIn("interrupted", item["researchError"])

    def test_stale_global_reset_is_rejected(self):
        revision = self.repo.snapshot()["revision"]
        self.repo.update_stock("pmic", 0, self.item()["revision"])
        with self.assertRaises(ConflictError):
            self.repo.reset(revision)

    def test_persistence_survives_new_repository(self):
        self.repo.update_stock("pmic", 42, self.item()["revision"])
        other = InventoryRepository(self.repo.path)
        self.assertEqual(next(item for item in other.snapshot()["items"] if item["id"] == "pmic")["stock"], 42)
