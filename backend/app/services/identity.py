import os
import hmac

from fastapi import HTTPException, Request


def cloud_mode() -> bool:
    return os.getenv("STATE_BACKEND", "sqlite") == "firestore"


def require_user(request: Request) -> str:
    if getattr(request.state, "actor", None):
        return request.state.actor
    if cloud_mode():
        secret = os.getenv("DEMO_ACCESS_CODE", "")
        if len(secret) < 24:
            raise HTTPException(503, "Presenter access is not configured.")
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not token or not hmac.compare_digest(token.encode(), secret.encode()):
            raise HTTPException(401, "Unlock presenter access with the demo passcode.")
        return "presenter"
    if os.getenv("K_SERVICE"):
        raise HTTPException(503, "Cloud deployment requires Firestore and presenter authentication.")
    return "local"
