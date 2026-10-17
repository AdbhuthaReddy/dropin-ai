# Frontend

This is the Next.js 16 / React 19 application for the DropIn.ai prototype. Run `npm ci` and `npm run dev` from this directory; the UI expects the FastAPI backend at `http://localhost:8080`.

The root [README](../README.md) covers setup and the intern-oriented overview. See [technical.md](../technical.md) for frontend components, shared state, request flows, and current limitations.

For deployment, follow [DEPLOYMENT.md](../DEPLOYMENT.md). One Cloud Run container serves this application and the API at one URL; Firestore keeps data durable. The [Dockerfile](../deploy/Dockerfile) embeds `NEXT_PUBLIC_API_BASE_URL=/` and `NEXT_PUBLIC_CLOUD_MODE=true`. Presenter access uses an in-memory passcode. Reports expose persisted workflow stages, parameter evidence, similarity limits and explicit change assessments. Local mode remains manual and requires no presenter passcode.
