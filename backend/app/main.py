import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from app.services.datasheets import MAX_PDF_BYTES, DocumentError, compare_documents, extract_pair
from app.services.gemini_engine import AgentHardwareVerdict, ProviderUnavailable, evaluate_component_shortage, provider_configured
from app.services.inventory import ConflictError, InventoryRepository
from app.services.identity import cloud_mode, require_user

logger = logging.getLogger(__name__)
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
_document_slots = asyncio.Semaphore(2)
DOCUMENT_DEADLINE_SECONDS = 55


class ObsoleteWorkflow(Exception):
    pass


def provider_detail(exc: ProviderUnavailable, reference: str) -> str:
    reason = {
        "quota_exhausted": "Gemini quota exhausted. Check provider limits or configure an available model/account.",
        "not_configured": "Gemini is not configured. Set the backend API key and restart the service.",
        "model_unavailable": "Configured Gemini models are unavailable. Check model IDs and account access.",
        "deadline_exceeded": "Gemini request deadline exceeded. Retry later.",
    }.get(exc.reason, "Research provider unavailable. Retry later or check backend logs.")
    return f"{reason} Reference: {reference}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("STATE_BACKEND", "sqlite") not in ("sqlite", "firestore"):
        raise RuntimeError("STATE_BACKEND must be sqlite (local) or firestore (cloud).")
    if os.getenv("K_SERVICE") and not cloud_mode():
        raise RuntimeError("Cloud Run requires STATE_BACKEND=firestore; ephemeral SQLite is forbidden.")
    if cloud_mode():
        from app.services.cloud_state import CloudRepository
        if not os.getenv("GOOGLE_CLOUD_PROJECT") or len(os.getenv("DEMO_ACCESS_CODE", "")) < 24:
            raise RuntimeError("Cloud deployment requires GOOGLE_CLOUD_PROJECT and a presenter passcode of at least 24 characters.")
        if os.getenv("AUTO_RESEARCH_ENABLED") == "true" and os.getenv("PUBLIC_DATASHEET_CONSENT") != "true":
            raise RuntimeError("Automatic public document research requires deployment-level consent.")
        app.state.inventory = CloudRepository()
    else:
        app.state.inventory = InventoryRepository(Path(os.getenv(
            "INVENTORY_DB_PATH", str(Path(__file__).resolve().parents[1] / "data" / "inventory.sqlite3")
        )))
    app.state.inventory.recover_interrupted()
    yield


app = FastAPI(title="DropIn.ai Evidence Research Demo", version="5.0.0", lifespan=lifespan)


@app.middleware("http")
async def correlate(request: Request, call_next):
    request.state.request_id = str(uuid4())
    started = time.monotonic()
    if cloud_mode() and request.method == "POST" and request.url.path.startswith("/api/"):
        try:
            request.state.actor = await asyncio.to_thread(require_user, request)
            length = request.headers.get("content-length")
            if not length or not length.isdigit():
                raise HTTPException(411, "A valid Content-Length is required.")
            if int(length) > 22 * 1024 * 1024:
                raise HTTPException(413, "Request exceeds the 22 MiB upload limit.")
            if request.url.path == "/api/datasheets/compare":
                from app.services.cloud_state import BudgetError
                try:
                    await asyncio.to_thread(repository(request).consume, request.state.actor)
                except BudgetError as exc:
                    raise HTTPException(429, str(exc)) from exc
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail},
                                headers={"X-Request-ID": request.state.request_id})
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    if request.method != "GET":
        logger.info(
            "request_id=%s method=%s path=%s status=%d elapsed_ms=%d",
            request.state.request_id, request.method, request.url.path,
            response.status_code, round((time.monotonic() - started) * 1000),
        )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[value.strip() for value in os.getenv(
        "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",") if value.strip()],
    allow_credentials=False, allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Request-ID", "Authorization"], expose_headers=["X-Request-ID"],
)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    reference = getattr(request.state, "request_id", str(uuid4()))
    logger.error("request_id=%s unexpected request failure", reference, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Unexpected server failure. Reference: {reference}"},
        headers={"X-Request-ID": reference},
    )


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SAPLineDownWebhook(StrictRequest):
    target_mpn: Text
    target_description: Description = "Unknown Component"
    search_mode: Literal["exact", "alternative"] = "exact"
    inventory_level: int = Field(default=0, ge=0, le=1_000_000_000, strict=True)
    lead_time_weeks: int = Field(default=52, ge=0, le=520, strict=True)
    erp_system: Text = "Local ERP simulation"
    plant_id: Text = "HYD-01"
    factory_location: Text = "Demo plant"


class StockUpdate(StrictRequest):
    stock: int = Field(ge=0, le=1_000_000_000, strict=True)
    expected_revision: int = Field(ge=0, strict=True)


class ResetRequest(StrictRequest):
    expected_revision: int = Field(ge=0, strict=True)


class ResearchRequest(ResetRequest):
    request_id: UUID
    search_mode: Literal["exact", "alternative"]


class WorkflowRequest(ResetRequest):
    pass


def research_response(target_mpn: str, verdict: AgentHardwareVerdict) -> dict:
    if verdict.workflow_route in ("OEM_CUSTOM_ESCALATION", "EXACT_ORIGINAL_UNAVAILABLE"):
        status = verdict.workflow_route
    else:
        status = "HOLD_FOR_ENGINEERING_REVIEW"
    return {
        **verdict.model_dump(),
        "original_mpn": target_mpn,
        "aml_authorization": False,
        "procurement_status": status,
        "purchase_order_id": None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def research(target_mpn: str, description: str, mode: str, request_id: str) -> dict:
    try:
        verdict = await evaluate_component_shortage(target_mpn, description, mode)
        return research_response(target_mpn, verdict)
    except ProviderUnavailable as exc:
        logger.warning("request_id=%s provider unavailable: %s", request_id, exc)
        raise HTTPException(503, provider_detail(exc, request_id)) from exc
    except (ValidationError, ValueError) as exc:
        logger.exception("request_id=%s invalid research evidence", request_id)
        raise HTTPException(502, f"Provider returned invalid research. Reference: {request_id}") from exc
    except Exception as exc:
        logger.exception("request_id=%s sourcing transport or processing failure", request_id)
        raise HTTPException(502, f"Research failed. Reference: {request_id}") from exc


@app.post("/api/webhooks/sap-line-down")
async def handle_sap_line_down(webhook: SAPLineDownWebhook, request: Request):
    await asyncio.to_thread(require_user, request)
    if cloud_mode():
        raise HTTPException(410, "Use versioned inventory edits to trigger the durable workflow; this demo is not a SAP connector.")
    return await research(
        webhook.target_mpn, webhook.target_description, webhook.search_mode, request.state.request_id,
    )


def repository(request: Request) -> InventoryRepository:
    return request.app.state.inventory


async def cloud_change(request, operation, **kwargs):
    from app.services.cloud_state import BudgetError
    actor = await asyncio.to_thread(require_user, request)
    repo = repository(request)
    try:
        job_id = await asyncio.to_thread(repo.change, actor, operation, **kwargs)
    except BudgetError as exc:
        raise HTTPException(429, str(exc)) from exc
    except (ConflictError, KeyError) as exc:
        mutation_error(exc)
    if job_id:
        await run_job(job_id, request)
    return await asyncio.to_thread(repo.snapshot)


def mutation_error(exc: Exception):
    if isinstance(exc, ConflictError):
        raise HTTPException(409, str(exc)) from exc
    raise HTTPException(404, "Unknown BOM component.") from exc


@app.get("/api/inventory")
async def get_inventory(request: Request):
    return await asyncio.to_thread(repository(request).snapshot)


@app.get("/api/config")
async def public_configuration():
    return {"cloud_workflow": cloud_mode(),
            "automatic_research": cloud_mode() and os.getenv("AUTO_RESEARCH_ENABLED") == "true"}


@app.post("/api/access")
async def check_access(request: Request):
    await asyncio.to_thread(require_user, request)
    return {"authorized": True}


@app.post("/api/inventory/reset")
async def reset_inventory(body: ResetRequest, request: Request):
    if cloud_mode():
        return await cloud_change(request, "reset", revision=body.expected_revision)
    repo = repository(request)
    try:
        repo.reset(body.expected_revision)
    except ConflictError as exc:
        mutation_error(exc)
    return repo.snapshot()


@app.post("/api/inventory/{item_id}/stock")
async def update_stock(item_id: str, body: StockUpdate, request: Request):
    if cloud_mode():
        return await cloud_change(request, "stock", item_id=item_id, stock=body.stock, revision=body.expected_revision)
    repo = repository(request)
    try:
        repo.update_stock(item_id, body.stock, body.expected_revision)
    except (ConflictError, KeyError) as exc:
        mutation_error(exc)
    return repo.snapshot()


@app.post("/api/inventory/{item_id}/research")
async def request_research(item_id: str, body: ResearchRequest, request: Request):
    if cloud_mode():
        raise HTTPException(410, "Use the /workflow action for cloud research.")
    repo = repository(request)
    try:
        started = repo.begin_research(item_id, body.request_id, body.search_mode, body.expected_revision)
    except (ConflictError, KeyError) as exc:
        mutation_error(exc)
    if not started:
        return repo.snapshot()
    item = repo.get_item(item_id)
    try:
        result = await research(item["mpn"], item["description"], body.search_mode, request.state.request_id)
        repo.finish_research(item_id, body.request_id, result=result)
    except HTTPException as exc:
        repo.finish_research(item_id, body.request_id, error=str(exc.detail))
        raise
    except asyncio.CancelledError:
        repo.finish_research(item_id, body.request_id, error="Research cancelled; please retry.")
        raise
    except Exception as exc:
        logger.exception("request_id=%s research failed", request.state.request_id)
        repo.finish_research(item_id, body.request_id, error=f"Research failed. Reference: {request.state.request_id}")
        raise HTTPException(502, f"Research failed. Reference: {request.state.request_id}") from exc
    return repo.snapshot()


@app.post("/api/datasheets/compare")
async def compare_uploaded(
    request: Request,
    original: UploadFile = File(...),
    candidate: UploadFile = File(...),
    consent: bool = Form(False),
    requirements: str = Form("", max_length=8000),
):
    try:
        await asyncio.to_thread(require_user, request)
        async with asyncio.timeout(DOCUMENT_DEADLINE_SECONDS), _document_slots:
            documents = await extract_pair(
                await original.read(MAX_PDF_BYTES + 1), "original.pdf",
                await candidate.read(MAX_PDF_BYTES + 1), "candidate.pdf",
            )
            return await compare_documents(*documents, requirements, consent)
    except HTTPException:
        raise
    except DocumentError as exc:
        raise HTTPException(422, str(exc)) from exc
    except ProviderUnavailable as exc:
        raise HTTPException(503, provider_detail(exc, request.state.request_id)) from exc
    except TimeoutError as exc:
        raise HTTPException(503, f"Document processing deadline exceeded. Reference: {request.state.request_id}") from exc
    except (ValidationError, ValueError) as exc:
        logger.exception("request_id=%s invalid document comparison", request.state.request_id)
        raise HTTPException(502, "Provider comparison was invalid; no approval was created.") from exc
    except Exception as exc:
        logger.exception("request_id=%s document processing failure", request.state.request_id)
        raise HTTPException(502, f"Document processing failed. Reference: {request.state.request_id}") from exc
    finally:
        await original.close()
        await candidate.close()


@app.post("/api/evaluate-arbitrage")
async def evaluate_arbitrage():
    raise HTTPException(
        410, "Path-based PDF evaluation was removed. Upload both PDFs to /api/datasheets/compare; consent is required for Gemini processing.",
    )


@app.get("/health")
async def health():
    return {
        "status": "running", "provider_configured": provider_configured(),
        "erp_connector": "not configured; shared demo inventory only",
        "cloud_workflow": cloud_mode(),
        "automatic_research": cloud_mode() and os.getenv("AUTO_RESEARCH_ENABLED") == "true",
        "purchase_orders": "not created or transmitted",
        "stock_verification": "not configured; search-reported estimates only",
        "datasheets": "local PDF extraction; consent-gated Gemini comparison; human engineering review required",
    }


@app.get("/ready")
async def ready():
    if not provider_configured():
        raise HTTPException(503, "Gemini API key is not configured. Inventory and local PDF extraction remain available.")
    return {"status": "configured", "provider_reachability": "not probed"}


@app.post("/api/inventory/{item_id}/workflow")
async def queue_workflow(item_id: str, body: WorkflowRequest, request: Request):
    if not cloud_mode():
        raise HTTPException(409, "Automatic workflow requires a Firestore deployment. See DEPLOYMENT.md for the single-service demo.")
    if os.getenv("PUBLIC_DATASHEET_CONSENT") != "true":
        raise HTTPException(503, "Automatic public datasheet processing has not been enabled by the operator.")
    repo = repository(request)
    snapshot = await asyncio.to_thread(repo.snapshot)
    item = next((entry for entry in snapshot["items"] if entry["id"] == item_id), None)
    if item and item["isProcessing"]:
        from app.services.cloud_state import BudgetError
        try:
            actor = await asyncio.to_thread(require_user, request)
            token = await asyncio.to_thread(repo.resume, actor, item_id, body.expected_revision)
        except BudgetError as exc:
            raise HTTPException(429, str(exc)) from exc
        except (ConflictError, KeyError) as exc:
            mutation_error(exc)
        await run_job(token, request)
        return await asyncio.to_thread(repo.snapshot)
    return await cloud_change(request, "research", item_id=item_id, revision=body.expected_revision)


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: UUID, request: Request):
    if not cloud_mode():
        raise HTTPException(404, "Cloud workflow is not enabled.")
    try:
        job = await asyncio.to_thread(repository(request).job, job_id.hex)
    except KeyError as exc:
        raise HTTPException(404, "Research job not found.") from exc
    # Never expose user identity, private board requirements, tokens or internal exceptions.
    return {key: job.get(key) for key in ("state", "stage", "created_at", "result", "error")}


async def run_job(token: str, request: Request):
    if os.getenv("PUBLIC_DATASHEET_CONSENT") != "true":
        raise HTTPException(503, "Public document processing is not enabled.")
    from app.services.workflow import run_workflow
    from app.services.public_sources import SourceError
    repo = repository(request)
    try:
        job = await asyncio.to_thread(repo.transition, token, "starting", claim=True)
    except ConflictError as exc:
        # A duplicate must not acknowledge a still-running job whose first worker could crash.
        raise HTTPException(503, "Worker lease active; retry later.") from exc
    if not job or job["state"] == "failed":
        return {"state": "not_running"}

    async def progress(stage):
        current = await asyncio.to_thread(repo.transition, token, stage)
        if current is None:
            raise ObsoleteWorkflow("Inventory changed; obsolete workflow stopped.")

    try:
        async with asyncio.timeout(360):
            result = await run_workflow(job["input"], progress)
        await asyncio.to_thread(repo.transition, token, "completed", result=result)
    except ObsoleteWorkflow:
        return {"state": "cancelled"}
    except asyncio.CancelledError:
        # A presenter can explicitly resume interrupted work after the lease expires.
        raise
    except ProviderUnavailable as exc:
        await asyncio.to_thread(repo.transition, token, "failed",
                                error=provider_detail(exc, request.state.request_id))
    except (SourceError, DocumentError) as exc:
        await asyncio.to_thread(repo.transition, token, "failed",
                                error=f"Evidence incomplete: {str(exc)[:2500]} Reference: {request.state.request_id}")
    except Exception:
        logger.exception("request_id=%s job_id=%s workflow failed", request.state.request_id, token)
        await asyncio.to_thread(repo.transition, token, "failed",
                                error=f"Research could not complete; no substitution approved. Reference: {request.state.request_id}")
    return {"state": "recorded"}
