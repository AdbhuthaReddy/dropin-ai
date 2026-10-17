# DropIn.ai technical reference

Current implementation includes local development and a single-service Google Cloud hackathon deployment. Cleanup and verification boundaries are recorded in [CHANGE_REPORT.md](./CHANGE_REPORT.md). Cloud provisioning/live acceptance has not been executed here; see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Recommended hackathon deployment

[deploy/demo.ps1](./deploy/demo.ps1) builds one image and deploys one Cloud Run service plus the default Firestore Native database. `STATE_BACKEND=firestore` enables durable revisions, transactions, daily budgets, job leases, the evidence pipeline and report APIs. Authenticated mutations use a constant-time comparison against a 24+ character presenter passcode mounted from Secret Manager; the frontend keeps it only in memory and validates it through `/api/access`. This is shared demo access, not personal identity or multi-tenant authorization.

```mermaid
flowchart LR
  Browser[Viewer / passcode presenter] --> Proxy[Cloud Run: Nginx :8080]
  Proxy --> Next[Next.js standalone :3000]
  Proxy --> API[FastAPI :8081]
  API <--> DB[(Firestore: inventory + jobs/reports + budgets)]
  API --> Workflow[Request-bound exact-to-alternative workflow]
  Workflow --> Gemini[Gemini / Search]
  Workflow --> PDF[Permitted source retrieval / PDF parsing]
```

The combined [Dockerfile](./deploy/Dockerfile) builds Next with same-origin API URLs, cloud workflow UI and presenter mode. [serve.py](./deploy/serve.py) supervises Node, Uvicorn and Nginx, forwarding termination and failing the container if any child exits. The [proxy](./deploy/nginx.conf) routes API/health/docs separately from web assets/pages, with a 22 MiB upload limit and 420-second API read timeout. The client allows 420 seconds for cloud POSTs; Cloud Run allows 480 seconds. Workflow execution remains bounded at 360 seconds; each individual provider operation retains its own 45-second deadline.

On threshold crossing, the existing atomic Firestore edit reserves a job budget and creates a durable job. Instead of dispatching a task, the API awaits the existing leased job runner inside the initiating HTTP request; request-based CPU remains available while it executes. Completed inventory/reports survive cold starts. Interrupted jobs remain resumable explicitly after the last 480-second lease expires; a presenter Resume checks revision, active lease and daily action budget, then uses the same bounded worker claim. There is no unattended outbox sweep or guaranteed background completion in this mode. Existing reset/edit association guards still reject obsolete results.

Default deployment limits: us-central1, min instances 0, max instances 1, 1 CPU/1 GiB RAM, concurrency 10, three shared research jobs and 100 shared actions per UTC day. One job/resume can make multiple provider calls, including model fallback. Public inventory polls every five seconds; the server snapshot cache is three seconds. Authentication is enforced before parsing API POSTs. Private document uploads retain consent and share the daily research budget; public read access remains unauthenticated. There are no separate worker endpoints.

This targets Google free allowances with billing enabled, not guaranteed zero cost: Cloud Run, Firestore, Cloud Build, Artifact Registry, Secret Manager, egress and Gemini/Search have separate eligibility/limits. Budgets are alerts, not hard caps. The [deployment guide](./DEPLOYMENT.md) includes setup, pricing sources, a live checklist and cleanup.

## Automatic evidence research

`cloud_state.py` uses one bounded inventory document, separate job documents and presenter/day plus global/day budget counters. Firestore transaction retries protect concurrent writes; tests use a controlled transactional implementation. Public report routes never expose job inputs, private board requirements or credentials. Startup does not clear active jobs. Explicit Resume uses expiring leases and at most two claims. Reset/edit invalidates job associations, preventing stale reports from attaching.

`workflow.py` performs real sequential stages, not timer-simulated agent progress. `public_sources.py` applies a permitted-domain HTTPS policy, public-address DNS checks, redirect revalidation, robots disallow/delay checks, byte/time limits and explicit refusal of blocked/non-PDF sources. It does not run an arbitrary crawler or bypass access controls. Approved domains are a trust boundary: an attacker-controlled/rebound domain must not be added; these checks are not a substitute for production egress isolation.

Exact availability is a **reported page observation**, never authoritative distributor stock. Manufacturer/MPN and quantity quotations must appear in the fetched page; a whole-number quantity must cover `max(1, safetyStock-stock)`, with explicit availability wording and no recognized backorder/unavailable wording. AI interpretation and product/quantity context still require review.

The alternative model receives actual original PDF text. Both documents need MPN relevance, hashes, source URLs and extraction. Comparisons validate exact page quotations and reject repeated parameters. Eight change-assessment areas (software, firmware, pinout, power, mechanical, thermal, qualification and timing) default to unknown when unsupported; non-unknown claims require valid comparison-evidence indices. These references do not independently prove model conclusions. Similarity is `100 * match_count / reported_parameter_count`, with unknown comparisons included in the denominator. Missing change assessments keep potential at insufficient evidence even if all reported parameters match. No hard-coded score grants approval.

`pdf_extract.py` contains the shared local parser; `pdf_worker.py` runs it in a credential-free subprocess. Linux limits CPU/address space/file output, and the parent kills a parser exceeding its wall timeout or cancellation. PDF extraction is not OCR, table/diagram certification or complete sandboxing. Private uploads retain per-request consent; automatic public downloads use the operator's explicit deployment opt-in.

This is a shared hackathon BOM, not a multi-tenant ERP. API keys stay in Secret Manager and Cloud Run rejects SQLite startup. No cloud client libraries are shipped to the browser.

### Local-mode reference

Windows fresh-clone bootstrap is [setup.ps1](./setup.ps1): it checks Node 22+/Python 3.12+, optionally installs missing runtimes through winget, creates/reuses `backend\.venv`, installs `requirements-dev.txt` and lockfile-based npm dependencies, and checks pip consistency/imports and TypeScript. It copies tracked local-mode environment templates only when the target files do not exist. It never asks for or prints a key, replaces existing configuration/inventory, activates Python globally, starts services or provisions cloud resources. `-SkipRuntimeInstall` disables winget and `-Python` selects the interpreter for a new environment. [start.ps1](./start.ps1) now prefers that project environment automatically. See the [README setup instructions](./README.md#one-command-windows-setup).

The numbered sections below describe the local/manual path unless explicitly noted. Cloud behavior above supersedes local-only assumptions about persistence, authentication, polling, automatic triggers and process recovery.

## 1. Purpose and boundaries

DropIn.ai is an evidence-assisted component-shortage prototype. It demonstrates a 3D BOM, a SAP-style inventory table, optional Google Search research through Gemini, and consent-gated comparison of actual PDF text.

It does not connect to SAP, retrieve authoritative distributor stock, reserve/receive goods, dispatch purchase orders, approve an AML, prove pin compatibility, or send OEM escalations. There is no automatic replacement approval, including for high-confidence model responses.

## 2. Technology stack

| Layer | Implementation |
|---|---|
| Web framework | Next.js 16.4 App Router, React 19.3, TypeScript |
| UI | Tailwind CSS 4, Lucide icons |
| 3D | Three.js, React Three Fiber, Drei (lights/environment/controls/lines/shadows) |
| Client state | Zustand; typed in-memory cache, not localStorage persistence |
| API | FastAPI, Pydantic 2, Uvicorn |
| Persistence | Local SQLite; cloud Firestore transactions, budgets and durable reports |
| Cloud identity / hosting | Presenter passcode, one Cloud Run service, Secret Manager |
| Gen AI | Google Gen AI SDK async client; configurable model routing and Google Search tool |
| Documents | pypdf text extraction, SHA-256, Pydantic evidence schemas |
| Quality | Python unittest, Node native test runner, TypeScript, ESLint, Next production build, GitHub Actions |

The cloud workflow has explicit sequential research/evidence stages, not independent autonomous procurement agents. Local manual research uses one prompted provider operation with bounded fallback.

## 3. Repository map

```text
shared/
  bom.json                        One ten-component seed BOM
backend/
  app/
    main.py                       API, lifecycle, error boundaries, upload endpoints
    services/
      inventory.py                SQLite persistence and revision/token guards
      gemini_engine.py            Provider calls, provenance, output normalization
      datasheets.py               PDF extraction and exact citation verification
      cloud_state.py              Firestore transactions, leases, budgets and reports
      identity.py                 Presenter-passcode verification
      workflow.py                 Exact-to-alternative evidence stages
      public_sources.py           Permitted robots-aware public retrieval
      pdf_extract.py, pdf_worker.py Pure PDF parser and isolated process entry point
  tests/
    test_api.py                   HTTP validation/error/lifecycle integration tests
    test_inventory.py             Shared-state, reset, duplicate, and restart tests
    test_research.py               Provider/normalization/concurrency tests
    test_datasheets.py             Synthetic PDFs, consent, hashes, citation tests
  requirements.txt                Runtime dependencies
  requirements-dev.txt            Developer install entry point including runtime/test client
  data/inventory.sqlite3           Runtime demo state, ignored by Git
  datasheets/                     Optional local PDFs, ignored; not auto-submitted
frontend/
  src/
    app/
      layout.tsx                  Metadata, fonts, InventorySync
      page.tsx                    Dashboard shell, navigation, research console toggle
      erp-simulator/page.tsx       Stock table, filters, stock edit forms, shared research card
      datasheets/page.tsx          Two-PDF upload, per-request consent, JSON evidence download
      globals.css                 Tailwind/theme configuration
    components/
      ThreeDBudsPro.tsx            Procedural meshes, springs, projected DOM tooltip, controls
      AIPanel.tsx                  Responsive component selector and shared ResearchCard
      ResearchCard.tsx             Same research controls/result semantics in both dashboards
      InventorySync.tsx            Non-overlapping polling, focus refresh, explicit error banner
      DemoIdentity.tsx             Presenter unlock/lock (cloud only)
      WorkflowReport.tsx           Structured evidence, stages and explicit Resume
    store/useInventoryStore.ts     Typed snapshot guards, stale-snapshot protection, actions
    lib/api.ts                    Configured API origin, JSON errors and client timeout
    lib/auth-client.ts             In-memory presenter credential and mode flag
  tests/inventory.test.mjs         Tests actual transpiled store with mocked HTTP
  next.config.ts                  Shared-repo Turbopack root and Tailwind loader
  eslint.config.mjs               Next/TypeScript lint
  tsconfig.json                   Strict TypeScript and Next route types
  package.json, package-lock.json  Scripts/dependency metadata
  AGENTS.md                       Next.js development guidance
start.ps1                         Configurable Windows launcher with readiness checks
.github/workflows/checks.yml      Offline tests, lint and production build
README.md                         Intern overview and setup
CHANGE_REPORT.md                  Cleanup verification and go-live gates
deploy/                           Single image, build, deploy script, proxy and supervisor
DEPLOYMENT.md                     Only supported deployment guide and go-live checklist
```

The package `__init__.py` files establish Python imports. Ignore files keep credentials, runtime state, caches, installed dependencies, and local PDFs out of Git. A fresh clone needs dependency installation; no commercial datasheet fixture is required because tests generate original synthetic PDFs.

## 4. System architecture

```mermaid
flowchart TB
  subgraph Browser["Browser tabs"]
    Scene[3D dashboard]
    ERP[ERP simulator]
    Card[Shared ResearchCard]
    Cache[Typed Zustand cache]
    Sync[InventorySync: poll and focus refresh]
    PDFs[PDF upload and explicit consent]
    Scene <--> Cache
    ERP <--> Cache
    Scene --> Card
    ERP --> Card
    Card --> Cache
    Sync <--> Cache
  end
  subgraph Backend["Local FastAPI, one worker"]
    API[Validation / correlation IDs]
    Repo[InventoryRepository]
    DB[(SQLite)]
    Engine[Async Gemini research]
    Extract[pypdf local extraction]
    Compare[Comparison and citation checks]
    API <--> Repo
    Repo <--> DB
    API --> Engine
    API --> Extract
    Extract --> Compare
  end
  Cache <-->|GET snapshots / versioned actions| API
  PDFs -->|multipart PDF bytes| API
  Engine -->|Search tool enabled| Google[Google Gemini]
  Compare -->|only with per-request consent| Google
```

## 5. Inventory state and concurrency

### Source of truth

[The shared BOM](./shared/bom.json) supplies fixed display metadata and initial stock for ten illustrative components: shell, acoustic mesh, touch film, audio SoC, PMIC, microphone array, IMU, battery, driver, and eartip. These are demo records, not a certified teardown or real SAP material master.

SQLite persists mutable state by component ID:

- `stock`: whole, nonnegative demo on-hand units.
- `revision`: per-item optimistic concurrency token.
- `request_id`, `processing`, `mode`: current/last explicit research request.
- `result`, `error`: recorded research or explicit failure.
- A separate global revision orders full snapshots and protects Reset All.

Every write runs in a short `BEGIN IMMEDIATE` transaction. Connections are explicitly closed. Snapshot reads are transactionally consistent. User actions send only the affected value and expected revision, never a stale full-inventory replacement.

### Update sequence

```mermaid
sequenceDiagram
  participant A as Tab A
  participant API as FastAPI
  participant DB as SQLite
  participant B as Tab B
  A->>API: stock=0, expected_revision=r
  API->>DB: atomically check r and update one item
  DB-->>API: item revision r+1, global revision g+1
  API-->>A: current snapshot
  B->>API: GET inventory (poll)
  API-->>B: updated snapshot
  B->>API: edit using stale revision r
  API-->>B: 409 conflict; refresh and review before retrying
```

Tabs poll one second **after** the preceding poll finishes and refresh on focus. The client applies only snapshots at least as new as the currently applied global revision. A slow older GET cannot roll back a newer POST result. There is no claim of instantaneous or offline synchronization; an unreachable API produces a visible error and disables writes.

Legacy browser localStorage is ignored, not migrated or deleted, because old AI-driven additions may have fabricated on-hand stock. New shared state is seeded from the canonical BOM.

Backend state survives page navigation, reload, and process restart. On startup, orphaned pending requests are marked interrupted with a retry message. Run one backend worker: startup recovery and in-process provider capacity are not a distributed job scheduler.

### Inventory versus analysis

`stock < safetyStock` means a stock exception; equality is in spec. `stock == 0` is line down. A demo shortage sets `floor(safetyStock * 0.4)`.

Research completion is separate. It cannot alter stock, manufacturer/vendor metadata, lead time, description, or the component MPN. There is no `markResolved` or additive replacement-inventory action. A new explicit stock edit clears obsolete research and invalidates pending results for that item.

## 6. Research lifecycle and Gen AI

Both dashboards expose the same explicit **exact** and **alternative** research actions. Selection, shortages, rendering, and reload do not automatically call the provider. Progress says only that a request is running; no artificial agent-stage timeline is displayed.

```mermaid
sequenceDiagram
  participant UI as Shared research control
  participant API as FastAPI
  participant DB as SQLite
  participant G as Gemini async client
  UI->>API: item ID, mode, UUID, expected item revision
  API->>DB: begin request if token/revision is valid
  API->>G: research prompt, Google Search enabled
  G-->>API: JSON text plus optional grounding metadata
  API->>API: validate, normalize, remove authorization
  API->>DB: finish only if request token is still current
  API-->>UI: current shared snapshot
  Note over DB: A concurrent reset/edit invalidates the old token
```

### Provider behavior

- The API key is checked at call time, not module import. Inventory/liveness/local extraction work without it.
- `GEMINI_MODELS` configures at most two ordered attempts.
- Calls use the SDK's asynchronous transport, with a 20-second HTTP timeout and one SDK attempt.
- A 45-second deadline includes waiting for capacity and model fallback.
- At most two provider operations run concurrently per backend process.
- Search stays enabled for all sourcing model attempts. There is no silent tool-free sourcing fallback or process-global exhausted-model flag.
- Invalid/empty JSON or API errors can try the next configured model. Exhaustion, timeout, and invalid business data produce explicit errors, not fake candidates.
- Grounding URLs/titles come from SDK metadata, not invented model JSON. HTTPS sources are preserved. Source presence does not prove every assertion, current stock, or physical compatibility.
- Response provenance includes the actual successful model, evidence mode, elapsed provider-operation time, and explicit false stock/datasheet-verification fields.

### Algorithms and routing

JSON extraction accepts one object, including simple code fences or surrounding prose, then Pydantic validates types and numeric bounds. Nonfinite/negative quotes and out-of-range confidence are rejected.

Normalization is deterministic:

| Condition | Behavior |
|---|---|
| Exact mode, model identifies the original MPN | Positive reported stock and the matching route can produce an availability-reported route, never approval |
| Exact mode, different or missing model MPN | Discard its quote and return `ENGINEERING_REVIEW_REQUIRED`; never relabel another part's availability as original stock |
| No exact stock / unavailable route | `EXACT_ORIGINAL_UNAVAILABLE`, no catalog link |
| Proprietary/OEM result | `OEM_CUSTOM_ESCALATION`, zero/default quote, no fabricated contact/escalation |
| Missing, same, suffixed-original, or unvalidated alternative | `ENGINEERING_REVIEW_REQUIRED`, no suggested substitution |
| Distinct candidate | Research-only alternative route |
| All routes | `aml_authorization=false`; no order or physical inventory mutation |

Legacy route strings `EXACT_ORIGINAL_PROCURED` and `ALTERNATIVE_ENGINEERED` are retained in response data for compatibility, but the UI describes research, not actual procurement or engineered approval. All non-unavailable/non-OEM outcomes have `HOLD_FOR_ENGINEERING_REVIEW`. Confidence is model self-report, not a calibrated probability or approval threshold.

Positive model-reported availability may get a deterministic DigiKey/Mouser/Avnet **catalog search** URL with an encoded MPN. That is not a product-specific offer, quoted checkout, or API stock verification.

No circuit requirements are available in stock research, so it cannot prove safe substitution. Firmware changes, voltage constraints, missing documents, pinout uncertainty, and OTP differences remain human-review concerns; they cannot be bypassed by high confidence.

## 7. Actual PDF comparison

PDF comparison is a separate, explicit workflow. Stock research does not automatically retrieve PDFs, and neither ignored local sample PDF is implicitly submitted.

```mermaid
flowchart TD
  Upload[Upload original and candidate PDF] --> Limits[Validate PDF header, size, pages and extractable text]
  Limits --> Extract[Local pypdf extraction with page numbers and SHA-256]
  Extract --> Consent{Explicit consent?}
  Consent -->|No| Local[Metadata only; no provider call]
  Consent -->|Yes| Model[Send page-labelled text + board requirements to Gemini]
  Model --> Schema[Validate comparison schema]
  Schema --> Quotes{Each quotation exists on its cited page in both PDFs?}
  Quotes -->|No| Reject[Reject comparison explicitly]
  Quotes -->|Yes| Hold[Evidence report: HOLD_FOR_ENGINEERING_REVIEW]
```

Limits per document: 10 MiB, 1-120 pages, at most 160,000 extracted characters. Encrypted, malformed, wholly image/scanned, and empty-text files are rejected; OCR is not configured. Pages without extracted text are identified in the report. Extraction cannot reliably reconstruct every table, pin diagram, equation, or image.

Consent unchecked means local extraction only. Consent checked allows transmission of the extracted text and user requirements to Google Gemini for that request. Users must have permission to process the selected documents; the app cannot determine document confidentiality or redistribution rights. Uploaded PDFs and extracted pages are not saved by the app. Multipart handling may spool uploads temporarily; production retention and provider data-use policy need deployment-specific review.

Each AI comparison contains:

- Parameter, `match`/`difference`/`unknown`, and explanation.
- An original-document citation and candidate-document citation.
- Each citation uses a 1-based PDF page and an 8-400 character excerpt.

The backend verifies page existence and exact excerpt membership after whitespace normalization. It rejects an entire comparison response if any quotation is unsupported. Hashes identify exact input bytes, not a verified manufacturer revision. Document edition, source authenticity, table interpretation, completeness, and conclusions remain unverified.

Even all-match results return `is_drop_in_replacement=false` and `HOLD_FOR_ENGINEERING_REVIEW`. This is quotation-grounded research, **not deterministic electrical compatibility certification**. Board requirements can guide the model but are not a machine-verified circuit model.

## 8. HTTP contracts

FastAPI `/docs` exposes request schemas. Unknown request fields are rejected for JSON business actions. Identifiers are stripped and bounded; inventory/revision values are strict bounded integers.

| Method / route | Behavior |
|---|---|
| `GET /health` | Liveness and honest integration/configuration boundaries |
| `GET /ready` | 503 without provider configuration; does not spend quota checking reachability |
| `GET /api/inventory` | Global revision plus ten typed item states |
| `POST /api/inventory/{id}/stock` | `{stock, expected_revision}`; invalidates old analysis/request |
| `POST /api/inventory/reset` | `{expected_revision}` using the global revision |
| `POST /api/inventory/{id}/research` | `{search_mode, request_id: UUID, expected_revision}`; records research without changing stock |
| `POST /api/webhooks/sap-line-down` | Stateless research compatibility endpoint; accepts MPN/description/mode/demo context, no SAP writeback |
| `POST /api/datasheets/compare` | Multipart `original`, `candidate`, `consent=false`, optional `requirements` |
| `POST /api/evaluate-arbitrage` | 410 Gone; arbitrary path-based PDF evaluation is removed, not faked |

Typical errors: 404 unknown component, 409 stale revision/in-flight research conflict, 422 invalid inputs/documents/citations, 502 invalid provider output/research failure, 503 provider unavailable, 500 unexpected logged server failure.

Every response is correlated with a generated `X-Request-ID`; provider/internal failures expose a reference, not the exception text. CORS allows only configured frontend origins and is **not authentication**.

Research output includes original/candidate MPNs, normalized route, uncalibrated confidence, always-false authorization, status, optional catalog search URL, reasoning/flags/differences, unverified quote, provenance, and timestamp. Purchase-order ID is always null.

Idempotency: resubmitting the current request UUID does not make a second provider call or apply a second result. It is a current-request guard, not an indefinite globally unique transaction ledger.

## 9. 3D rendering and UI

The scene builds procedural meshes from `meshType`: dome/sphere shell, torus acoustic ring, cylinder touch disc/PCB/battery, box semiconductor/sensor/microphones, driver cylinder/coil, and transparent silicone tip. These are illustrative geometry, not manufacturer CAD.

Exploded/assembled x positions are fixed by part ID. `MotionGroup` integrates a damped spring each frame:

```text
force = stiffness * (target - position) - damping * velocity
acceleration = force / mass
velocity += acceleration * dt
position += velocity * dt
dt = min(frame delta, 0.05 seconds)
```

Defaults: stiffness 65, damping 16, mass 1. The delta clamp limits unstable jumps after stalled frames; this is an animation, not a physical simulation.

Critical meshes pulse red with `1.8 + 0.9 * sin(elapsedTime * 5)` emissive intensity and a local point light. OrbitControls support rotate/pan/zoom with bounded camera distance and polar angle; Reset Camera restores its initial state. Lighting/environment is procedural and does not require a remote HDRI.

The tooltip lives in the page's normal DOM tree, not a nested Drei `Html` React root. Each frame, a Three.js group anchor is projected into normalized device coordinates, mapped to canvas pixels, and distance-scaled. It is hidden outside the camera depth range or without selection. Pointer handling does not mutate store-owned records during render.

Both dashboards use the same ResearchCard and backend actions. ERP stock forms require explicit Save, programmatic labels, whole-number constraints, and display stock status separately from research status. CSV export serializes the current filtered inventory with quoted/escaped cells; Print invokes the browser print flow. The console fits its container up to 480 pixels; controls wrap on smaller viewports. Mobile and keyboard smoke checks are not a full WCAG certification.

## 10. Latency, concurrency, and reliability

There is no latency SLA. Sources of delay include provider queueing, model/search latency, PDF extraction, network overhead, and polling.

- Research provider work: at most two simultaneous calls, two model attempts, 20-second HTTP timeout per attempt, and a 45-second overall deadline including the slot queue.
- Client fetch timeout: 60 seconds locally/for reads, 420 seconds for cloud POSTs.
- Shared-state propagation: approximately one polling interval plus request/scheduling time, not real-time push.
- PDF comparison admits two concurrent workflows and has a 55-second deadline including capacity wait, extraction, comparison and evidence checks.
- Local parsing now uses a killable subprocess with a 15-second wall timeout and Linux resource limits. Provider calls use async transport rather than detached worker threads. Broader production upload/network isolation remains a deployment responsibility.
- Short database transactions protect revisions, but SQLite and polling are local-prototype choices, not a high-scale multi-tenant design.

The historical audit measured single exact and alternative requests at 8.828 s and 24.287 s, respectively, under the old routing. These do not benchmark the current implementation. A live synthetic-PDF comparison after the fixes reported 20.868 s provider-operation time with exact page quotes and an engineering hold. The subsequent live sourced-alternative check was blocked by HTTP 429 on both configured models and returned a safe 503; live search success is not currently verified. Provider availability and quotas are account-dependent; an explicit 503 is preferable to ungrounded procurement claims.

No measured p50/p95, throughput SLA, calibrated accuracy benchmark, cost-per-valid-candidate study, or hardware field validation is claimed.

## 11. Tests and operations

Backend tests generate their own small PDFs and stub the provider; no credentials or external quota are needed. They cover numeric/identifier validation, CORS, no-key liveness, provider provenance/cancellation/capacity/deadlines, normalized routes, no automatic authorization, stock-revision conflicts, duplicate requests, late completion after reset, restart recovery, real PDF extraction, consent, and citation rejection.

Frontend tests load the actual TypeScript store through the installed TypeScript compiler and use Node's test runner with mocked fetch responses. They check snapshot validation, out-of-order responses, explicit invalid-input errors, no stock changes from held results, revision conflicts, provider errors, absence of hidden research on selection, reset versus late research, and research versus unfinished stock edits. Type checking and lint remain separate gates.

See the latest section of [CHANGE_REPORT.md](./CHANGE_REPORT.md) for current regression counts, cloud-mode build evidence and external verification limitations.

See [README.md](./README.md) for exact commands and configuration. The Windows launcher resolves a configurable Python interpreter, checks imports, reuses responsive local services, and waits up to 90 seconds for HTTP readiness. It does not install dependencies or use a hard-coded user directory.

## 12. Remaining production boundaries

Remaining beyond the budget-limited hackathon deployment:

- SAP/ERP identity, authorization, tenant/plant ownership, real material master and goods movements.
- Authoritative distributor APIs, signed quotes, inventory reservations, order/receipt integrations.
- Auditable human engineering approval and procurement workflows.
- OCR/image/table-aware verification, manufacturer revision trust, machine-checked board constraints.
- Full production tenancy/ERP data modeling, distributed provider budgets, signed approvals and operating SLAs.
- Edge-level public-view abuse protection, configured monitoring/alert channels, retention/backups and broader isolation/hardening.
- Real-world accuracy, cost, impact, load and accessibility qualification.

Do not expose the unauthenticated local mode to the public internet or use model output as engineering approval. Use cloud mode with the deployment acceptance checklist for a public jury demo. No score/report substitutes for missing enterprise integration and engineering verification.
