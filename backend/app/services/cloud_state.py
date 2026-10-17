import hashlib
import json
import os
import time
import copy
import threading
from datetime import datetime, timezone
from uuid import uuid4

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore, tasks_v2
from google.protobuf.duration_pb2 import Duration

from app.services.inventory import BOM_PATH, ConflictError


class BudgetError(ValueError):
    pass


def charge_values(current: dict, *, research: bool) -> dict:
    values = {"actions": current.get("actions", 0) + 1, "research": current.get("research", 0) + int(research)}
    return values


class CloudRepository:
    """One small inventory document; separate bounded reports and transactional budgets."""

    def __init__(self, client=None):
        self.db = client or firestore.Client(project=os.environ["GOOGLE_CLOUD_PROJECT"])
        self.bom = json.loads(BOM_PATH.read_text(encoding="utf-8"))
        self.state = self.db.collection("demo").document("inventory")
        self.jobs = self.db.collection("research_jobs")
        self._cache = None
        self._cache_at = 0
        self._cache_lock = threading.Lock()
        try:
            self.state.create({"revision": 0, "items": [{
                **item, "revision": 0, "isProcessing": False, "researchMode": None,
                "aiVerdict": None, "researchError": None, "workflow": None,
            } for item in self.bom]})
        except AlreadyExists:
            pass

    def snapshot(self):
        with self._cache_lock:
            if self._cache is None or time.monotonic() - self._cache_at >= 3:
                self._cache = self.state.get().to_dict()
                self._cache_at = time.monotonic()
            return copy.deepcopy(self._cache)

    def invalidate(self):
        with self._cache_lock:
            self._cache = None

    def recover_interrupted(self):
        # Cloud Tasks delivery and expiring worker leases own recovery, not API cold starts.
        return None

    def _budget(self, tx, actor: str, research: bool):
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        user = hashlib.sha256(actor.encode()).hexdigest()
        refs = [self.db.collection("budgets").document(f"{day}-{user}"),
                self.db.collection("budgets").document(f"{day}-global")]
        snapshots = [ref.get(transaction=tx).to_dict() or {} for ref in refs]
        limits = [(int(os.getenv("USER_DAILY_ACTIONS", "40")), int(os.getenv("USER_DAILY_JOBS", "3"))),
                  (int(os.getenv("GLOBAL_DAILY_ACTIONS", "400")), int(os.getenv("GLOBAL_DAILY_JOBS", "20")))]
        updates = [charge_values(snapshot, research=research) for snapshot in snapshots]
        for update, (actions, jobs) in zip(updates, limits):
            if update["actions"] > actions or update["research"] > jobs:
                raise BudgetError("Demo daily action/research budget reached. Retry after UTC midnight.")
        return list(zip(refs, updates))

    def change(self, actor: str, operation: str, *, item_id=None, stock=None, revision=0, mode="automatic"):
        job_id = uuid4().hex

        @firestore.transactional
        def commit(tx):
            state = self.state.get(transaction=tx).to_dict()
            item = next((entry for entry in state["items"] if entry["id"] == item_id), None)
            if operation != "reset" and item is None:
                raise KeyError(item_id)
            actual_revision = state["revision"] if operation == "reset" else item["revision"]
            if actual_revision != revision:
                raise ConflictError("Inventory changed. Refresh and review before retrying.")
            enqueue = operation == "research"
            if enqueue and item["isProcessing"]:
                raise ConflictError("Research is already queued or running.")
            if operation == "stock":
                enqueue = (stock < item["safetyStock"] and item["stock"] >= item["safetyStock"]
                           and os.getenv("AUTO_RESEARCH_ENABLED") == "true")
            budget = self._budget(tx, actor, enqueue)
            if operation == "reset":
                for entry, base in zip(state["items"], self.bom):
                    entry.update(stock=base["stock"], revision=entry["revision"] + 1,
                                 isProcessing=False, workflow=None, researchMode=None,
                                 aiVerdict=None, researchError=None)
            else:
                if operation == "stock":
                    item.update(stock=stock, aiVerdict=None, researchError=None,
                                isProcessing=False, workflow=None, researchMode=None)
                item["revision"] += 1
                if enqueue:
                    item.update(isProcessing=True, researchError=None, aiVerdict=None,
                                researchMode=None, workflow={"job_id": job_id, "stage": "queued"})
                    tx.create(self.jobs.document(job_id), {
                        "item_id": item_id, "state": "queued", "stage": "queued", "mode": mode,
                        "created_at": time.time(), "lease_until": 0, "attempts": 0,
                        "input": {**item, "board_requirements": os.getenv("BOARD_REQUIREMENTS", "")[:8000]},
                        "result": None, "error": None,
                    })
            state["revision"] += 1
            tx.set(self.state, state)
            for ref, values in budget:
                tx.set(ref, values)
            return job_id if enqueue else None

        result = commit(self.db.transaction())
        self.invalidate()
        return result

    def consume(self, actor: str):
        @firestore.transactional
        def commit(tx):
            updates = self._budget(tx, actor, True)
            for ref, values in updates:
                tx.set(ref, values)
        commit(self.db.transaction())

    def job(self, job_id: str):
        data = self.jobs.document(job_id).get().to_dict()
        if data is None:
            raise KeyError(job_id)
        return data

    def transition(self, job_id: str, stage: str, *, result=None, error=None, claim=False):
        @firestore.transactional
        def commit(tx):
            job_ref = self.jobs.document(job_id)
            job = job_ref.get(transaction=tx).to_dict()
            state = self.state.get(transaction=tx).to_dict()
            if not job or job["state"] in ("completed", "failed", "cancelled"):
                return None
            item = next(entry for entry in state["items"] if entry["id"] == job["item_id"])
            if (item.get("workflow") or {}).get("job_id") != job_id:
                tx.update(job_ref, {"state": "cancelled", "stage": "cancelled"})
                return None
            if claim and job["lease_until"] > time.time():
                raise ConflictError("Job has an active worker lease.")
            next_stage = stage
            if claim and job["attempts"] >= 2:
                next_stage, error_value = "failed", "Worker interrupted repeatedly; retry explicitly."
            else:
                error_value = error
            terminal = next_stage in ("completed", "failed")
            updates = {"stage": next_stage, "state": next_stage if terminal else "running",
                       "lease_until": time.time() + 480, "error": error_value}
            if claim:
                updates["attempts"] = job["attempts"] + 1
            if result is not None:
                if len(json.dumps(result).encode()) > 700_000:
                    raise ValueError("Research report exceeded persistence limit.")
                updates["result"] = result
            item.update(isProcessing=not terminal, researchError=error_value,
                        workflow={"job_id": job_id, "stage": next_stage}, revision=item["revision"] + 1)
            state["revision"] += 1
            tx.update(job_ref, updates)
            tx.set(self.state, state)
            return {**job, **updates}
        result = commit(self.db.transaction())
        self.invalidate()
        return result

    def pending_jobs(self):
        now = time.time()
        # Bounded scan suitable for the hackathon budget, no composite index needed.
        for status in ("queued", "running"):
            for doc in self.jobs.where(filter=firestore.FieldFilter("state", "==", status)).limit(100).stream():
                job = doc.to_dict()
                if (job.get("lease_until", 0) < now
                        and (status != "queued" or now - job["created_at"] >= 120)):
                    # A new bounded recovery name also survives an exhausted task's dedup tombstone.
                    yield doc.id, f'{job.get("attempts", 0)}-recovery-{int(now // 900)}'


def dispatch(job_id: str, attempt=0):
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(os.environ["GOOGLE_CLOUD_PROJECT"], os.environ["TASK_REGION"], os.environ["TASK_QUEUE"])
    try:
        client.create_task(parent=parent, task=tasks_v2.Task(
            name=f"{parent}/tasks/research-{job_id}-{attempt}",
            http_request=tasks_v2.HttpRequest(
                http_method=tasks_v2.HttpMethod.POST,
                url=f'{os.environ["WORKER_URL"].rstrip("/")}/internal/jobs/{job_id}',
                headers={"Content-Type": "application/json"},
                body=b"{}",
                oidc_token=tasks_v2.OidcToken(
                    service_account_email=os.environ["TASK_SERVICE_ACCOUNT"],
                    audience=os.environ["WORKER_AUDIENCE"],
                ),
            ),
            dispatch_deadline=Duration(seconds=600),
        ))
    except AlreadyExists:
        pass
