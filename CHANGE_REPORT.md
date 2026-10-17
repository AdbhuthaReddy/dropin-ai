# Cleanup and go-live check

## Supported architecture

There is now one supported cloud deployment: **one Cloud Run container + Firestore**, built and deployed by [deploy/demo.ps1](./deploy/demo.ps1). Local development still uses SQLite and manual research. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the only cloud deployment guide and [technical.md](./technical.md) for implementation details.

## Cleanup performed

- Removed the separate API/web Dockerfiles, their build configurations, the old provisioning script, alternate deployment guide, Hosting configuration, browser database rules/index configuration and placeholder hosting directory.
- Removed Google-sign-in code, cloud identity SDKs, task dispatching, scheduler recovery, separate worker HTTP endpoints and the redundant simple/advanced mode flags. A Firestore backend always uses presenter authentication and request-bound research.
- Kept durable Firestore inventory, job reports, revisions, daily budgets, bounded claims, stale-result guards and explicit Resume after lease expiry. No fake stock receipt, engineering approval or purchase-order behavior was restored.
- Removed unused graph-wrapper/button/class-name scaffolding, generator metadata, starter SVG assets and empty unused Python package placeholders. Necessary Python package markers, tests, setup templates and the active favicon remain.
- Removed unused UI/graph/animation/authentication packages and the obsolete frontend gRPC override. Removed unused generator/animation stylesheet imports; existing views use Tailwind utilities directly. Updated the dependency lockfile.
- Added early rejection of an incompatible default database before building. Redeployment preserves an existing Native database. Container CI now also checks readiness, the datasheet page and an actual production stylesheet through the proxy.
- Retained the existing dashboard appearance, shared stock synchronization, explicit stock-save forms, filters, CSV/print, PDF consent/evidence checks, Windows setup/launcher and the working local mode.
- Replaced outdated deployment documentation with the current architecture; old instructions are no longer offered as an alternative. Existing Google resources, local secrets, uploaded files and saved inventory are not deleted by this source cleanup.

## Validation

| Check | Result |
|---|---|
| Backend offline suite | **109 passed**, including presenter authentication, Firestore state/budgets, inline research, Resume, stale/reset guards and container supervision |
| Frontend regression suite | **14 passed** |
| Clean lockfile install | **Passed** in isolated source copy |
| ESLint, TypeScript, production cloud-mode build | **Passed** in isolated source copy; all four application routes generated |
| Setup orchestration tests | **Passed**: fresh setup, preserved config, command failures and invalid-venv protection |
| Deployment orchestration tests | **Passed**: provisioning, redeployment/database compatibility, cost settings, metadata-only secret checks and explicit failures |
| PowerShell syntax / relative Markdown links / patch whitespace | **Passed** |
| Production browser smoke with fixture API | **Passed**: ERP renders ten components, wrong passcode rejected, correct passcode unlocks, lock restores, no localStorage credential, mobile ERP has no document overflow; 3D canvas/selection/view toggle render |
| Runtime npm audit | **0 vulnerabilities** |
| Full npm audit | **5 high development-toolchain advisories**, through Next ESLint -> fast-glob/micromatch/braces; not part of standalone runtime |

Windows blocked an in-place clean install because running services held native modules open. Dependencies were restored without stopping those services; the clean-install/build verification used an isolated copy containing no local secrets or inventory. The lower backend test count compared with earlier reports reflects removal of obsolete identity/task-delivery tests, not lost coverage of the supported deployment.

## Go-live gates that cannot be certified offline

1. **Combined container:** local Docker engine is unavailable. Run the repository's combined-container CI job (build + proxy/web/API smoke), or build/run the image with a working Docker engine before deploying.
2. **Google account:** provisioning, IAM, actual Firestore, Secret Manager mounts, Cloud Run readiness and persistence across redeploy require your project and the live acceptance checklist.
3. **Gemini:** the previously observed HTTP 429 is unresolved account/provider quota. Deployment does not increase quota; live research needs an available search-capable model and permitted source evidence.
4. **Cost:** billing is required; free allowances are not hard spending caps. Monitor Cloud Run, build/image storage, Firestore, secrets, egress and Gemini/Search separately.
5. **Dependency advisories:** runtime audit passed, but five development-only globbing advisories remain in the Next ESLint toolchain. The audit's proposed automatic fix downgrades the framework tooling; it was not forced. Recheck upstream fixes before a production release.

No Google resources were provisioned, no credentials were collected, and no production engineering/ERP certification is claimed.
