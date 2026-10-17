import os
from functools import lru_cache

from fastapi import HTTPException, Request


def cloud_mode() -> bool:
    return os.getenv("STATE_BACKEND", "sqlite") == "firestore"


@lru_cache
def firebase_app():
    import firebase_admin
    return firebase_admin.initialize_app(options={"projectId": os.environ["GOOGLE_CLOUD_PROJECT"]})


def require_user(request: Request) -> str:
    if getattr(request.state, "actor", None):
        return request.state.actor
    if not cloud_mode():
        if os.getenv("K_SERVICE"):
            raise HTTPException(503, "Cloud deployment requires Firestore and Firebase authentication.")
        return "local"
    from firebase_admin import auth
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not token:
        raise HTTPException(401, "Sign in with Google to edit inventory or run research.")
    try:
        claims = auth.verify_id_token(token, app=firebase_app(), check_revoked=True)
    except (auth.InvalidIdTokenError, auth.RevokedIdTokenError, auth.UserDisabledError, ValueError) as exc:
        raise HTTPException(401, "Your sign-in expired or is invalid. Sign in again.") from exc
    if not claims.get("email_verified") or claims.get("firebase", {}).get("sign_in_provider") != "google.com":
        raise HTTPException(403, "A verified Google sign-in is required.")
    allowed = {value.strip().casefold() for value in os.getenv("ALLOWED_EMAILS", "").split(",") if value.strip()}
    if allowed and claims.get("email", "").casefold() not in allowed:
        raise HTTPException(403, "This account is not allowed to edit the demo.")
    return claims["uid"]


def require_worker(request: Request):
    if not cloud_mode():
        raise HTTPException(404, "Cloud worker is not enabled.")
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2 import id_token
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    try:
        claims = id_token.verify_oauth2_token(
            token, GoogleRequest(), audience=os.environ["WORKER_AUDIENCE"],
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(401, "Worker identity required.") from exc
    if claims.get("email") != os.environ["TASK_SERVICE_ACCOUNT"] or not claims.get("email_verified"):
        raise HTTPException(403, "Worker identity is not permitted.")
