# Frontend

This is the Next.js 16 / React 19 application for the DropIn.ai prototype. Run `npm ci` and `npm run dev` from this directory; the UI expects the FastAPI backend at `http://localhost:8080`.

The root [README](../README.md) covers setup and the intern-oriented overview. See [technical.md](../technical.md) for frontend components, shared state, request flows, and current limitations.

For the public Google-sign-in hackathon build, follow [DEPLOYMENT.md](../DEPLOYMENT.md). Firebase/API public variables are embedded at build time; the Dockerfile and Cloud Build config supply them. Cloud reports expose persisted workflow stages, parameter evidence, similarity limits and explicit change assessments. Local mode remains manual and does not require Firebase.
