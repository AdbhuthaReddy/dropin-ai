import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import UUID

BOM_PATH = Path(__file__).resolve().parents[3] / "shared" / "bom.json"


class ConflictError(ValueError):
    pass


class InventoryRepository:
    """SQLite transactions protect demo state from stale-tab and late-response writes."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.bom = json.loads(BOM_PATH.read_text(encoding="utf-8"))
        with self.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)")
            db.execute("INSERT OR IGNORE INTO meta VALUES (1, 0)")
            db.execute(
                "CREATE TABLE IF NOT EXISTS inventory "
                "(id TEXT PRIMARY KEY, stock INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, "
                "request_id TEXT, processing INTEGER NOT NULL DEFAULT 0, mode TEXT, result TEXT, error TEXT)"
            )
            for item in self.bom:
                db.execute("INSERT OR IGNORE INTO inventory (id, stock) VALUES (?, ?)", (item["id"], item["stock"]))

    @contextmanager
    def transaction(self):
        with closing(sqlite3.connect(self.path, timeout=5)) as db, db:
            db.row_factory = sqlite3.Row
            db.execute("BEGIN IMMEDIATE")
            yield db

    @staticmethod
    def bump(db):
        db.execute("UPDATE meta SET revision=revision+1 WHERE id=1")

    def recover_interrupted(self):
        with self.transaction() as db:
            changed = db.execute(
                "UPDATE inventory SET processing=0, request_id=NULL, revision=revision+1, "
                "error='Research interrupted by server restart; please retry.' WHERE processing=1"
            ).rowcount
            if changed:
                self.bump(db)

    def snapshot(self) -> dict:
        with self.transaction() as db:
            revision = db.execute("SELECT revision FROM meta WHERE id=1").fetchone()[0]
            rows = {row["id"]: row for row in db.execute("SELECT * FROM inventory")}
            return {
                "revision": revision,
                "items": [
                    {
                        **item, "stock": rows[item["id"]]["stock"],
                        "revision": rows[item["id"]]["revision"],
                        "isProcessing": bool(rows[item["id"]]["processing"]),
                        "researchMode": rows[item["id"]]["mode"],
                        "aiVerdict": json.loads(rows[item["id"]]["result"]) if rows[item["id"]]["result"] else None,
                        "researchError": rows[item["id"]]["error"],
                    }
                    for item in self.bom
                ],
            }

    def get_item(self, item_id: str) -> dict:
        return next(item for item in self.bom if item["id"] == item_id)

    def update_stock(self, item_id: str, stock: int, expected_revision: int):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM inventory WHERE id=?", (item_id,)).fetchone()
            if row is None:
                raise KeyError(item_id)
            if row["revision"] != expected_revision:
                raise ConflictError("Inventory changed in another request. Review the refreshed value and retry.")
            db.execute(
                "UPDATE inventory SET stock=?, revision=revision+1, request_id=NULL, processing=0, "
                "mode=NULL, result=NULL, error=NULL WHERE id=?", (stock, item_id),
            )
            self.bump(db)

    def reset(self, expected_revision: int):
        with self.transaction() as db:
            if db.execute("SELECT revision FROM meta").fetchone()[0] != expected_revision:
                raise ConflictError("Inventory changed. Review the refreshed state before resetting.")
            for item in self.bom:
                db.execute(
                    "UPDATE inventory SET stock=?, revision=revision+1, request_id=NULL, processing=0, "
                    "mode=NULL, result=NULL, error=NULL WHERE id=?", (item["stock"], item["id"]),
                )
            self.bump(db)

    def begin_research(self, item_id: str, request_id: UUID, mode: str, expected_revision: int) -> bool:
        with self.transaction() as db:
            row = db.execute("SELECT * FROM inventory WHERE id=?", (item_id,)).fetchone()
            if row is None:
                raise KeyError(item_id)
            if row["request_id"] == str(request_id):
                return False
            if row["revision"] != expected_revision or row["processing"]:
                raise ConflictError("This component changed or already has research running. Refresh before retrying.")
            db.execute(
                "UPDATE inventory SET request_id=?, mode=?, processing=1, revision=revision+1, "
                "error=NULL WHERE id=?", (str(request_id), mode, item_id),
            )
            self.bump(db)
            return True

    def finish_research(self, item_id: str, request_id: UUID, *, result: dict | None = None, error: str | None = None):
        with self.transaction() as db:
            changed = db.execute(
                "UPDATE inventory SET processing=0, revision=revision+1, result=?, error=? "
                "WHERE id=? AND request_id=? AND processing=1",
                (json.dumps(result) if result is not None else None, error, item_id, str(request_id)),
            ).rowcount
            if changed:
                self.bump(db)
