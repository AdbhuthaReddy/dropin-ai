# Change Report and Engineering Review

## Fresh-clone Windows setup

- Added root `setup.ps1` for Windows PowerShell 5.1/PowerShell 7: runtime discovery/version checks, optional winget installation of missing Node/Python, isolated backend virtual environment, runtime/test pip dependencies, lockfile-based npm installation including dev tools, local environment templates, pip consistency/import checks and frontend type checking.
- Existing configuration, keys, inventory and valid environments are preserved. Invalid environments and failed external commands stop with explicit errors; no automatic deletion, key collection, Gemini call or cloud provisioning occurs. `-SkipRuntimeInstall` prohibits winget; `-Python` selects the interpreter for a new environment.
- Updated `start.ps1` to prefer the project environment and find npm at standard installation paths, including immediately after a runtime install. Updated the README/technical reference and included nonsecret environment examples in Git.
- Validation: PowerShell parser checks and isolated setup regression tests passed (runtime probe exit codes, external command failure, fresh install orchestration, rerun/environment reuse, configuration preservation, pip/npm/typecheck failure propagation, PATH/location cleanup and invalid-environment protection). Installation commands are mocked in these local orchestration tests to avoid changing running services; no actual winget installation is claimed. Added a Windows CI job for these tests and a real fresh-clone install; that job has not run here.

## SAP-style dashboard visual restoration

- Restored the earlier Fiori-style blue shell, compact plant navigation, breadcrumbs, quick-test toolbar, exception banners, square panels, and dense materials grid. The grid again includes layer, vendor, storage location and lead time; inventory overview tiles and a matching research workspace complete the layout.
- Kept the current shared inventory store, explicit stock-save forms, strict below-safety threshold, filters/search, CSV export, printing, reset/zero controls and shared research component. No backend, authentication, budget or automatic-workflow behavior was changed.
- Deliberately did not restore obsolete fake progress, purchase-order/writeback confirmations, automatic stock receipts or substitution approval claims. The dashboard remains explicitly labeled as a simulation without a live SAP connection.
- Verification: all **11 frontend regression tests passed**, frontend type checking and page lint passed, and editor diagnostics were clear. Browser checks covered search, all four filters, empty results, research selection, stock save, threshold equality, shortage simulation, zero and reset. Mutation checks used an isolated browser fetch fixture: saved backend inventory was not changed and no Gemini request was made. Filtered CSV contents and print invocation were checked; at a 390px viewport the page stayed within the viewport and the dense grid scrolled horizontally.

## GCP automatic-research deployment package - 2026-10-17

This is the latest implementation. The user selected **GCP/Cloud Run/Firebase**, operator opt-in for automatic public-datasheet processing, an exact-MPN/manufacturer offer with sufficient reported stock as the exact-search success criterion, and **public viewing with budget-limited Google-signed-in reviewers**. The user chose to deploy the prepared package themselves.

### Implemented

1. **Durable cloud state and work:** Firestore transactions replace ephemeral SQLite in cloud mode. Threshold-crossing stock edits atomically reserve budget, update inventory and create a queued job. Cloud Tasks delivers authenticated work to a private Cloud Run worker; Scheduler repairs the outbox and expired leases. Named tasks, bounded claims, revision checks and stale-job cancellation protect against duplicate/late work. API cold starts do not reset active jobs.
2. **Actual automatic sourcing flow:** exact product-source discovery -> bounded permitted page retrieval -> checked MPN/manufacturer/quantity excerpts -> original PDF retrieval/extraction if no sufficient evidenced exact offer -> alternative discovery using that real text -> candidate PDF retrieval -> quotation-checked comparison. At most two candidate alternatives and seven provider operations per job. Search is not silently downgraded when quota fails.
3. **Similarity and substitution implications:** structured parameter comparison, an explicitly unweighted evidence-match percentage, and eight software/firmware/hardware change-assessment categories. Missing support is unknown; non-unknown assessments require valid comparison-evidence references. Repeated parameters/assessment areas are rejected. A 100% fraction with missing change evidence is still insufficient evidence, never approval.
4. **Controlled public retrieval:** HTTPS permitted-domain policy, public-address checks, redirect revalidation, robots refusal/delays, content/byte/time limits, and explicit blocked-source errors. No arbitrary internal requests, login/CAPTCHA/paywall bypass or forced crawling of restricted sites.
5. **Killable PDF parser:** extracted the pure parser into a shared module and a short-lived subprocess. The subprocess does not import provider configuration or inherit provider credentials. Parent timeout/cancellation kills it; Linux applies CPU/address-space/file-output limits. Full extracted text/PDF bytes are not persisted in research reports.
6. **Public-demo access and budgets:** Firebase Google sign-in, verified/revoked-token checks, optional email allowlist, service-identity/audience checks for internal routes, per-reviewer/global UTC daily work/action limits, and authentication/budget checks before parsing cloud uploads. Private user uploads retain per-request consent and are not stored as public jobs.
7. **Shared cloud UI:** sign-in banner, real persisted job stages, structured similarities/differences, source/page evidence, explicit change/unknown lists and downloadable reports. Failed anonymous research attempts preserve existing public evidence. Cloud clients poll at five seconds and snapshots cache for three seconds; local/manual mode remains available.
8. **Threshold consistency:** changed all dashboard stock predicates to strictly `stock < safetyStock` as requested. Equality is in spec and does not enqueue automatic research. Edits already below safety do not repeatedly spend budget; explicit retry is available.
9. **Deployment assets:** non-root backend/frontend Dockerfiles, standalone Next output, Cloud Build configs, GCP provisioning script, optional Firebase Hosting routing, deny-all browser Firestore rules and unindexed large job inputs/results. Build source excludes keys, environment files, local PDFs, runtime data and Git metadata. Runtime, task, build and web service accounts have separate roles.
10. **Dependencies and documentation:** Firebase SDK added; compatible patched gRPC transport override; shadcn moved to build/dev dependencies because its stylesheet is imported. A stale negative Turbopack resolution cache was cleared during local validation. Runtime dependency audit passes; upstream build-tool globbing/CLI advisories remain and are not hidden by forced framework downgrades. Added the complete [deployment guide](./DEPLOYMENT.md) and updated intern/technical docs and CI.

### Verification and boundaries

- Backend: **110 offline tests passed**, covering the previous behavior plus cloud transactions, budgets, threshold equality/crossing, worker leases/recovery, public/authenticated API boundaries, OIDC task shape, exact-to-alternative flow, source restrictions and change-evidence requirements.
- Frontend: **11 native tests passed**; lint/type checking and the **cloud-mode standalone production build passed** with nonsecret dummy Firebase configuration. Runtime `npm audit --omit=dev` reports zero advisories.
- Standalone production server responded with HTTP 200. Browser smoke with controlled inventory/job fixtures showed the Google sign-in banner, structured comparison/similarity, firmware-change caveat and page quotations; an anonymous workflow attempt was stopped before any backend POST.
- Python compilation, PowerShell deployment-script syntax and diff-whitespace validation passed. Test Firestore transactions and provider calls use controlled implementations: **no real Firestore emulator/account, IAM grant, Google sign-in or Cloud Tasks delivery was exercised**.
- Google Cloud/Firebase CLIs were unavailable here, and the Docker daemon was not running. No cloud resources were provisioned and no container execution is claimed. The guide includes the required project-specific acceptance checklist.
- No new live sourcing success is claimed. The previously observed Gemini HTTP 429 remains an account/quota prerequisite; the new workflow must be exercised with available quota and permitted live source pages in the deployment project.
- This is a bounded hackathon deployment, not production ERP/procurement certification. Public-view abuse controls, alert channels, data retention/backups, authoritative distributor APIs, SAP ingestion, tenant isolation and signed engineering approvals still require operating/project-specific work.

**Start here:** [DEPLOYMENT.md](./DEPLOYMENT.md), [deploy/gcp.ps1](./deploy/gcp.ps1). No Git commit was created.

---

## Fix implementation and verification - 2026-10-17

This section describes the current implementation. **All sections below "Historical verification audit" preserve pre-refactor observations, scores, and intermediate fixes; their open-status labels are not the current issue list.** In particular, the old `RECOMMENDATION_READY`, automatic stock updates, fake PDF evaluation, and Tenacity retry path have been removed.

### Agreed scope

The user selected a reliable local prototype with actual PDF evidence comparison and explicit consent for each Gemini document request. SAP, distributor, order/receipt, production identity, and enterprise deployment integrations remain unconfigured. This work does not claim autonomous engineering certification or an exhaustive test of every possible case.

### Findings addressed, in implementation order

| Finding | Implemented correction | Verification |
|---|---|---|
| Stale tabs overwrite inventory; dashboards disagree | Replaced localStorage persistence with a shared SQLite repository, global/per-item revisions, transactional edits, conflict responses, and non-overlapping polling. Both dashboards use one typed client cache. | Cross-tab PMIC/battery edits; stale revision and out-of-order snapshot regressions |
| AI results resolve shortages or add distributor stock to physical stock | Removed resolution/stock-mutation actions from research. Stock status is computed only from on-hand quantity. All ordinary results remain on engineering hold and authorization is always false. | Held-result and API no-stock-mutation tests; live quota failure left stock unchanged |
| Duplicate/late responses undo resets or inflate inventory | Added UUID request guards, revision checks, reset/edit invalidation, current-token completion, and stale-snapshot rejection. | Duplicate request, pending-reset endpoint integration, and delayed client response tests |
| Old verdicts survive a new shortage; processing survives restart indefinitely | Stock edits clear research; backend startup marks orphaned requests interrupted with an explicit retry message. | Repository lifecycle/restart tests |
| Reload/selection causes hidden paid research | Both dashboards now require explicit exact/alternative buttons through the same ResearchCard. Removed auto-trigger effects and artificial stage timers. | Store no-hidden-call test and browser shortage/reload check |
| Research can immediately race an unfinished stock edit | Added shared writing state and disabled conflicting controls until mutation completion. | Frontend pending-edit regression |
| Model confidence/AML field bypasses engineering constraints | Provider authorization/provenance are not trusted. No confidence threshold can approve a replacement. Wrong exact-MPN quotes are discarded; missing/same/suffixed-original alternatives fail closed. | Normalization and HTTP hold regressions, including exact-MPN mismatch |
| Search failure silently becomes ungrounded procurement | All sourcing attempts keep Search enabled; no tool-free sourcing fallback. Retained actual successful model, grounding sources/status, elapsed time, and explicit unverified-stock/compatibility indicators. | Mocked SDK provenance/fallback tests; live failure returned explicit 503 |
| Retries outlive requests; mutable global quota state | Replaced threaded/Tenacity provider path with async SDK calls, two-operation capacity, up to two models, 20-second transport timeout, and a 45-second total research deadline. Removed global exhausted-model flags. | Cancellation, capacity, deadline, and fallback tests |
| Missing key prevents server startup | Lazy provider configuration; separate liveness and configuration readiness. Inventory and local extraction do not require Gemini. | No-key API tests |
| Unhelpful/unsafe errors and missing request correlation | Generated request IDs, timing instrumentation, safe error details, actionable quota errors, and explicit frontend sync/action errors. Failed requests clear processing state. | Validation, quota, unexpected-provider-error, and lifecycle tests |
| Legacy endpoint ignores PDFs | Legacy path-based endpoint now returns 410. Added real multipart upload and local pypdf extraction with SHA-256, page/character counts, and document limits. | Generated PDF extraction and HTTP upload regressions |
| No permission boundary or evidence check for document comparison | Per-request consent defaults false. With consent, send actual page-labelled PDF text and requirements; reject nonexistent pages/quotations; always return human-review hold. | Consent, exact-quote, page-boundary, invalid-PDF, schema, and workflow-deadline tests; live synthetic-document check |
| Unlabeled stock inputs, mobile overflow, inert utilities | Added labeled explicit stock forms, separate research/inventory columns, functional filters/search, CSV export and Print control, wrapping controls, and a responsive console. Removed an incorrect NXP label from the Analog Devices PMIC shortcut. | All ten stock inputs labeled; 390px viewport smoke; filtered CSV content checked; Print wired, not printer-qualified |
| React nested-root cleanup warning | Retained the page-owned projected DOM tooltip instead of Drei Html; corrected nearby types, unused code, and the removed shadow-map option. | Selection/navigation smoke without the reported root-unmount error; clean types/lint |
| Hard-coded launcher, missing tests and current documentation | Portable configurable launcher with port/readiness checks, avoiding duplicate starts during slow compilation; repository-native backend/frontend tests and GitHub Actions; rewritten architecture and intern guide. | Launcher syntax and repeated reuse checked; offline checks/build below; CI configuration added but not run remotely |

### Verification results

| Check | Result |
|---|---|
| Backend `unittest` | 64 tests passed; controlled providers and original synthetic PDFs |
| Frontend native Node tests | 10 tests passed against the actual transpiled store |
| Frontend ESLint | Passed, zero errors or warnings |
| TypeScript | Passed |
| Next production build | Passed; dashboard, ERP and datasheet routes generated |
| Python compilation / editor diagnostics / diff whitespace | Passed / no errors / passed |
| Browser state behavior | Same-tab and cross-tab convergence, no stale overwrite, shortage retained on reload, no hidden research, and clean baseline reset |
| Browser ERP utilities | One below-safety row after PMIC shortage; BMI323 search yielded one row; filtered CSV had its header and only the selected material |
| Browser document workflow | Local-only extraction worked; explicitly consented live comparison returned checked page quotations and an engineering hold |
| Local launcher | Syntax passed; two consecutive runs reused responsive services without starting duplicate processes |

These are targeted regression and smoke results, not a full accessibility, load, security, hardware, or cross-browser certification. Test logs intentionally include simulated provider exceptions. Dependency-level Three.js Clock and Starlette test-client deprecation warnings remain; they are not the original React root error.

### Live AI evidence and external blocker

- Two original, one-page synthetic PDFs were uploaded through the new workflow. Local-only extraction returned metadata without Gemini. The consented comparison succeeded with **`gemini-flash-lite-latest`, `document_text`, 20,868 ms provider-operation time**. It identified the supplied **1.8 V versus 2.4 V** minimum-supply difference, and both page-1 excerpts matched the actual document text.
- The result remained `HOLD_FOR_ENGINEERING_REVIEW`, with `is_drop_in_replacement=false`. This verifies document transmission and citation plumbing on a controlled example, not real semiconductor compatibility or manufacturer-source authenticity.
- A live sourced alternative lookup was attempted after the refactor. **Both configured search-capable models returned provider HTTP 429.** The application returned an explicit 503 and did not alter inventory. Search-enabled live success cannot currently be claimed; available quota/account/model configuration is required. Do not hide the outage behind ungrounded procurement output.
- The earlier 8.828 s / 24.287 s observations and 56/100 jury score below belong to the pre-fix system. No new p50/p95, real-world accuracy/cost benchmark, or independently validated hackathon rescore is asserted.

### Remaining boundaries and migration notes

- SQLite is shared local demo truth, not SAP synchronization. Run one backend worker. There is no authentication, tenant isolation, real distributor verification, order placement, goods receipt, or signed engineering approval.
- Legacy browser-local inventory is deliberately ignored, not imported or deleted: it can contain the previously fabricated stock increases. The canonical demo BOM seeds a new SQLite database; subsequent shared edits persist there.
- Search sources are provenance, not proof of current stock. Catalog links remain searches, not verified offers. Even fully cited PDF results require human review of source/revision, circuits, package drawings, firmware, thermal limits, and physical fit.
- PDF limits are 10 MiB, 120 pages and 160,000 extracted characters per document. No OCR or deterministic diagram/table interpretation is implemented. The document workflow has two concurrent slots and a 55-second queue/extraction/comparison deadline. Timeout cannot forcibly terminate a local parser thread; production needs process isolation and ingress/resource limits.
- Uploaded bytes/text are not application-persisted; multipart parsing may spool temporary files. Explicitly consented text is processed by Google under the deployment's provider terms. Public deployment, retention policy, and document confidentiality need separate review.
- No dependency secrets, runtime database, commercial PDF fixtures, or generated model reports were committed. No Git commit was created.

Current architecture: [technical.md](./technical.md). Intern overview/setup: [README.md](./README.md).

---

## Historical verification audit - 2026-10-17

This follow-up audit tested the then-current working tree, not just the committed version. No application behavior was changed during this audit phase. These are preserved pre-refactor results; use the implementation section above for current status.

### Scope and limits

- Executed 40 offline backend checks and 12 isolated inventory-store checks: **37 passed, 15 failed** against the stated validation and engineering-safety expectations. These are audit cases, not an exhaustive coverage percentage or an existing repository test suite.
- Backend checks replaced provider calls with controlled responses and disabled dotenv credential loading. Store checks transpiled the actual TypeScript module and used isolated in-memory browser storage.
- Exercised the running UI using intercepted responses for unavailable results, engineering holds, upstream failures, and delayed results. Also checked real same-tab navigation, cross-tab edits, filtering/search, reload behavior, and a 390-pixel viewport.
- Made **two real backend sourcing requests**, one exact and one alternative, using the public sample PMIC identifier. These tested live response generation, not authoritative distributor stock or engineering compatibility.
- Production build passed; Python compilation passed; `git diff --check` passed. Full frontend lint failed with **11 errors and 29 warnings**. The editor test runner found no repository tests.
- This does not certify all browsers, accessibility conformance, sustained load, security, provider/model availability under every quota condition, or actual hardware compatibility. No production SAP system, distributor account, order, goods receipt, or real factory was involved.
- Audit scripts are retained in the session workspace, not added to the repository's automated test infrastructure.

### Dashboard synchronization findings

| Priority | Reproduction / evidence | Root cause and impact |
|---|---|---|
| P1 | In two ERP tabs, set PMIC stock to zero in the first. The second still displayed 8,000 even though its localStorage read showed zero. Editing the battery in the second tab then restored persisted PMIC stock to 8,000 while the first still displayed zero. | Each tab has a separate Zustand instance. Persistence does not subscribe to storage events or reconcile concurrent edits. A stale tab can overwrite newer inventory, not merely display stale data. See [inventory persistence](./frontend/src/store/useInventoryStore.ts). |
| P1 | An unavailable response left stock at 1,000, safety stock at 2,500, but set `isResolved=true`. The ERP no longer offered the component's trigger button; the 3D scene still reported a critical shortage. | Both request handlers call `markResolved` for any HTTP-success result. ERP workflow status and 3D stock status use different predicates. Analysis completion is conflated with shortage resolution. |
| P1 | With an intercepted response containing `confidence_score=0.2`, `aml_authorization=true`, and `procurement_status=HOLD_FOR_ENGINEERING_REVIEW`, both UI flows increased stock from 1,000 to 11,000. The 3D screen then said all parts were in spec. | Both handlers check model authorization, but ignore the backend hold/confidence decision when applying `setDropInResolution`. Reported distributor stock is added as though physically received. Neither a recommendation nor distributor availability is a stock receipt. |
| P1 | Reset during a pending exact request restored stock to 8,000. Releasing the stale response afterward increased it to 18,000 and marked it resolved. | There is no request-generation/reset guard or cancellation before applying late results. Exact-original availability is also incorrectly tagged as a drop-in replacement of itself. |
| P2 | Reapplying the same store resolution added another 10,000 units. | The update is additive and not idempotent; duplicate responses or repeated research can inflate stock and append duplicate description suffixes. |
| P2 | Updating a resolved item's stock to zero kept its old verdict and resolved flag. | `updateStock` does not invalidate stale recommendation state when a new shortage occurs. |
| P2 | Reloading the 3D page with an already analyzed, still-critical item issued another exact sourcing request. | Auto-trigger suppression is only an in-memory component ref; it is not a durable request/result lifecycle. The panel can also initiate requests while closed. |
| P2 | Store serialization retained `isProcessing=true`. | Transient request state survives persistence although the task itself is not restored. Navigation/reload can leave misleading progress state; there is no server-side job to reconnect to. |

Same-tab navigation did preserve PMIC stock of 1,000 between the 3D and ERP pages. Therefore the dashboards are not completely disconnected: the main defects are cross-tab synchronization and inconsistent workflow/inventory semantics. The default research flow also differs: the 3D panel automatically requests **exact** research, while the ERP trigger requests **alternative** research.

### Is Gemini actually reading datasheets and finding alternatives?

**Live generation works; verified datasheet comparison is not implemented.**

| Live request | HTTP result | Observed client elapsed time | What it establishes |
|---|---|---|---|
| Exact `MAX77650EWV+T` | 200, `EXACT_ORIGINAL_UNAVAILABLE` | 8.828 seconds | The configured backend returned a live model-assisted result. It asserted no immediate availability and 99% confidence, without returning citations. This audit did not validate that stock assertion. |
| Alternative `MAX77650EWV+T` | 200, `ALTERNATIVE_ENGINEERED`, `RECOMMENDATION_READY` | 24.287 seconds | The response proposed `MAX77651AEWV+T` at 92% model confidence. It reported 1,482 units at Mouser and a one-day lead time. These are unverified model claims, not confirmed offers. |

The alternative response itself said **FIRMWARE REWORK REQUIRED** and stated that it was only valid if the system did not require SIMO rails below 2.4 V. These voltage/package statements were not independently verified in this audit. The important, verified software defect is that the backend still marked this conditional, firmware-changing result `RECOMMENDATION_READY` without knowing the board's rail requirements.

The implemented path is:

```text
MPN + description + research mode
    -> prompt with optional Google Search tool
    -> generated JSON text
    -> route/URL normalization + Pydantic schema validation
    -> recommendation threshold based on model authorization/confidence
```

It is not a document-grounded engineering verification pipeline:

- No active code opens, uploads, parses, or extracts specifications from either local PDF.
- Submitting two nonexistent PDF paths to `/api/evaluate-arbitrage` returned HTTP 200 under a controlled model fixture. The helper ignored both paths and invoked shortage research for hard-coded `MAX77650EWV+T` in default exact mode.
- Enabling Google's search tool may allow the provider to consult indexed material, including datasheet-related pages. It does **not** prove that the required source documents were retrieved or compared.
- `run_gemini_search` returns only parsed `response.text`; source/grounding metadata is not preserved or required. A response with no grounding evidence was accepted in an offline test.
- A simulated search-quota error produced a tool-enabled attempt followed by a tool-free generation call. The same business response can therefore originate from ungrounded generation.
- The live API responses do not identify the successfully used model, whether grounding actually ran, or source URLs/document revisions/page references.
- The active pipeline calls only `_stage_2_engineering_agent`. The stage-1 procurement function is not part of its execution. Animated UI stages are not backend progress events.
- Distributor links are constructed catalog searches; they are not verification of a product listing, quoted price, purchasable quantity, or checkout.

The two timings above are individual end-to-end request measurements, not p50/p95 latency, model benchmarks, or an SLA. The existing per-attempt timeout/retry concern still applies.

### Other checked boundaries and gaps

**Passed:** missing required MPN rejected; invalid mode rejected; negative, fractional and null API inventory rejected; confidence range enforcement; recommendation threshold at 0.85 and below; explicit OEM/unavailable/review routes; sanitized provider errors; local/disallowed CORS preflights; rejection of missing/same-MPN alternatives; basic JSON/code-fence parsing; URL escaping; ten unique BOM entries; stock clamping/flooring; shortage threshold equality; reset; case-insensitive verdict matching; ERP search and below-safety filtering. Intercepted HTTP 502 responses surfaced errors and left both dashboards unresolved with processing cleared.

**Failed or missing:**

- Empty/whitespace MPNs and negative lead times were accepted by the API.
- Negative model quote stock/price/lead time passed schema validation.
- An exact response's `aml_authorization=false` was overwritten with true when positive stock was present.
- An alternative with zero stock could remain authorized. Firmware-rework flags did not block a ready recommendation.
- An unavailable exact result regained a nonempty catalog URL during final normalization, despite earlier clearing.
- The store accepted `NaN` stock; serialization converts that value to null. This was an isolated store boundary test, not a claim that ordinary browser number input necessarily produces `NaN`.
- All ten ERP stock inputs lacked programmatic labels. At a 390-pixel viewport, the analysis panel remained 480 pixels wide and could not fit the viewport.
- No measured accuracy dataset, authoritative compatibility test oracle, calibrated confidence, or regression/CI gate exists.

Some failed checks express minimum safety expectations for a sourcing/engineering product rather than a previously documented formal specification. Regardless of terminology, their consequences prevent treating the current recommendation as engineering approval or inventory truth.

### Hackathon jury assessment

Provisional score for the implementation demonstrated in this audit, not the envisioned production system:

| Criterion | Weight | Score / 10 | Weighted points | Reason |
|---|---:|---:|---:|---|
| Technical Merit & Gen AI Implementation | 40% | 4 | 16 / 40 | Live Gen AI addresses a relevant workflow, and the frontend/API build and communicate. However, document verification, authoritative sourcing, safe decision gates, concurrency/state integrity, scalable persistence, and automated quality gates are missing. |
| Problem Alignment & Impact | 25% | 8 | 20 / 25 | Component shortage triage is valuable and the BOM-to-research journey fits the problem well. Actual impact remains unproven without validated substitutions, real ERP integration, and procurement outcome measurements. |
| Innovation & Creativity | 25% | 6 | 15 / 25 | A 3D BOM twin linked to sourcing is a compelling presentation and workflow combination. The AI implementation is chiefly prompted search/generation, not a demonstrated novel engineering-verification method or real multi-agent system. |
| User Experience & Solution Design | 10% | 5 | 5 / 10 | The visual demo is engaging; search, stock editing, and error feedback work. Cross-tab data loss, contradictory resolution states, misleading stock updates, mobile clipping, and accessibility gaps undermine cohesion. |
| **Total** | **100%** | | **56 / 100** | **Promising hackathon prototype, not a validated autonomous sourcing or engineering platform.** |

### Recommended implementation order

1. Separate physical inventory, analysis completion, engineering review, and procurement lifecycle. Never add distributor stock to on-hand inventory on recommendation receipt.
2. Use one shared typed request/result transition function for both dashboards; enforce backend decisions, handle late responses/reset, and make results idempotent.
3. Add versioned server-side persistence for multi-user truth. A storage-event listener can improve a single-browser demo, but does not solve concurrent writes or real SAP synchronization.
4. Implement real document ingestion and traceable specification extraction. Require original/candidate datasheet revisions, page citations, circuit requirements, deterministic hard constraints, and human approval of conditional candidates.
5. Preserve model/grounding provenance; require authoritative evidence for availability and pricing. Keep ungrounded generation in an explicit research-only state.
6. Add reproducible repository tests/CI, then authorization, rate limits, request tracing, provider timeouts/quotas, load measurements, responsive design, and accessibility verification before deployment.

## Executive assessment

**Overall: useful demonstration prototype; not production-ready for engineering approval or procurement.** The frontend state-sharing and 3D presentation provide a clear demo flow, but the backend relies on model-generated assertions, has no authoritative component/distributor source, and is not connected to SAP. Address the P1 findings before using this for real sourcing decisions.

## Changes implemented

1. **Stopped presenting a generated ID as a real purchase order.** The backend previously generated a random `PO-SAP-*` value and claimed that an autonomous EDI order had been dispatched even though no SAP or distributor connector exists. Approved results now return `purchase_order_id: null`, status `RECOMMENDATION_READY`, and an explicit message that the result is only a recommendation. The health response now says the ERP connector is not configured.
2. **Aligned the UI with the actual prototype behavior.** ERP simulator and AI panel status, timeline, and section text now describe local recommendation display instead of claiming a real SAP writeback or EDI transmission.
3. **Removed render-time mutation of store data.** `ThreeDBudsPro` no longer assigns a fallback material number onto a Zustand-owned inventory record while rendering.
4. **Prevented invented replacement fallback values.** If alternative mode returns no candidate or repeats the original MPN, the API now routes to `ENGINEERING_REVIEW_REQUIRED`; it no longer substitutes a hard-coded PMIC MPN. Missing AML authorization and quote numbers default closed/zero, and the frontend labels quote data as model-reported.
5. **Declared Tenacity directly.** The backend imports Tenacity directly, so `tenacity>=8.2.3` is now listed explicitly rather than relying on its current transitive installation via another dependency.
6. **Narrowed CORS and request validation.** CORS is limited to the two local development frontend origins with credentials disabled; `search_mode` is now restricted to the two supported values, and negative inventory levels are rejected.
7. **Sanitized backend errors.** Provider exceptions are logged on the server and no longer returned verbatim in the API response; frontend callers now display API error messages rather than marking failed requests as resolved.
8. **Replaced starter documentation.** Added root `README.md`, this engineering report, and detailed [technical.md](./technical.md); replaced the frontend's default create-next-app README with a project-specific pointer.
9. **Updated page metadata.** Replaced the default “Create Next App” browser title/description with DropIn.ai prototype metadata.
10. **Fixed the 3D tooltip's React root cleanup warning.** Replaced Drei `Html` with a page-owned DOM overlay, positioned and scaled from a scene anchor each frame. This avoids synchronously unmounting a nested React root during scene cleanup, without disabling Strict Mode. Browser checks covered selection/dismissal, assembled/exploded positioning, shortage details, opening the analysis panel, and route navigation/remount with no captured console or page errors. TypeScript checking passed; component lint still reports two pre-existing `any` errors and unused-code warnings.

## Prioritized findings

| Priority | Finding | Evidence / impact | Status |
|---|---|---|---|
| P1 | The legacy `/api/evaluate-arbitrage` route does not evaluate the supplied PDFs. | `evaluate_datasheets` ignores both paths and calls the shortage pipeline for a hard-coded `MAX77650EWV+T`; a caller can receive an unrelated verdict labeled as a datasheet comparison. | Open; implement real PDF comparison or remove/rename the endpoint. |
| P1 | A fallback can return a model-only result after Google Search grounding is unavailable. | `run_gemini_search` makes ungrounded calls after quota/tool failures. The UI now labels results as model-reported, but the backend still permits an ungrounded response to pass the same recommendation thresholds. Stock and part facts may be fabricated or stale. | Open; make grounding status explicit in the response and reject ungrounded procurement claims unless verified by authoritative APIs. |
| P1 | The current recommendation is not safe for autonomous engineering or procurement approval. | `aml_authorization`, confidence, critical differences, stock and lead time are model-generated; Pydantic validates schema and ranges, but does not prove electrical, thermal, mechanical, pinout, firmware, or inventory compatibility. | Open; require verified data, deterministic rule checks, human sign-off, and auditability. |
| P1 | The service has no authentication or authorization. | The shortage endpoint can be called by any client able to reach the backend; CORS is not an authentication mechanism. | Open; add identity, authorization, rate limiting, and network controls before deployment. |
| P1 | The backend still treats model-reported availability and confidence as procurement evidence. | Quote fields are now neutral when omitted and invalid same-MPN alternatives fail closed, but supplied values are still not verified against a distributor or datasheet. | Open; require authoritative source evidence and deterministic engineering checks. |
| P2 | Timeout/retry behavior can outlive the HTTP attempt and duplicate model work. | A 60-second `asyncio.wait_for` wraps `asyncio.to_thread`; timing out the await does not stop its worker thread. Tenacity retries once after a wait, so a caller may wait roughly 122 seconds while prior work continues. | Open; set provider-level timeouts, use cancellable/job-based execution, bound retries, and measure latency. |
| P2 | The shown “stages” are not a real multi-agent sequence. | `_stage_1_procurement_agent` is not called by `_sync_multi_agent_pipeline`; that path calls `_stage_2_engineering_agent` only. The frontend stage progress is timer-driven. | Open; either wire real stages and report progress or rename the UX to match a single model call. |
| P2 | Gemini quota state is mutable process-global state. | `SEARCH_TOOL_EXHAUSTED` and `EXHAUSTED_MODELS` affect future requests in the same process and are not synchronized. Behavior can depend on earlier requests and concurrent quota errors. | Open; make provider/model health explicit and use concurrency-safe shared state or per-request routing. |
| P2 | The backend requires a Gemini key at module import. | `gemini_engine.py` raises during import without `GEMINI_API_KEY`, preventing even `/health` from starting. | Open; separate liveness/readiness and initialize provider clients with explicit configuration errors. |
| P2 | Error responses lack request correlation IDs. | Provider failures are now logged server-side and sanitized in the response, but there is no correlation ID to connect a client error to its server log. | Open; add request IDs and structured logs. |
| P2 | The frontend and service endpoint are hard-coded to localhost. | Both UI request sites target `http://localhost:8080`; this prevents normal remote deployment without code changes and needs deployment-specific CORS. | Open; use validated environment configuration and a same-origin proxy where suitable. |
| P2 | Sample PDFs are not tracked. | `.gitignore` ignores `backend/datasheets/*.pdf`; fresh clones may lack the local sample files. | Open; use documented, redistributable fixtures or secure runtime upload/storage. |
| P3 | Lint currently fails. | `npm run lint` reports 11 errors and 30 warnings in frontend source, including React effect/state warnings, explicit `any`, and unused imports. | Open; remaining lint errors/warnings are not broadly refactored in this documentation task. |
| P3 | No automated tests are present. | The repository has no unit/integration test suite for API routing, fallback handling, response schemas, store operations, or UI flows. | Open; add focused backend and frontend tests. |
| P3 | `start.ps1` is machine-specific and uses a fixed startup delay. | It hard-codes a local Miniconda path, assumes a working directory, and opens the UI after six seconds without checking service readiness. | Open; make interpreter configurable and wait on health/readiness endpoints. |

## Validation

- `npm run build` — passed.
- `npm run lint` — fails with 11 errors and 30 warnings after the changes.
- `python -m compileall -q backend\app` — passed using the Python path configured in `start.ps1`.
- Stubbed-response checks for same-MPN alternative rejection and missing-quote exact-mode routing — passed without calling Gemini.
- FastAPI smoke checks for health, request validation, local-origin CORS, and sanitized provider errors — passed.
- Automated tests — none exist.

## Scope notes

Existing uncommitted changes were present in `frontend/src/app/erp-simulator/page.tsx`, `frontend/src/components/AIPanel.tsx`, `frontend/src/components/ThreeDBudsPro.tsx`, and `frontend/src/store/useInventoryStore.ts` before this task. Those changes were preserved; the updates above were applied on top of the current working tree.
