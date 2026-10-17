import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from app.services.identity import require_user


def request(token=""):
    return Request({"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())] if token else []})


class IdentityTests(unittest.TestCase):
    def test_cloud_requires_correct_strong_passcode(self):
        secret = "presenter-fixture-" + "x" * 24
        with patch.dict(os.environ, {"STATE_BACKEND": "firestore", "DEMO_ACCESS_CODE": secret}):
            for token in ("", "wrong", "\u2603" * 24):
                with self.assertRaises(HTTPException) as error:
                    require_user(request(token))
                self.assertEqual(error.exception.status_code, 401)
            self.assertEqual(require_user(request(secret)), "presenter")

    def test_cloud_rejects_weak_secret(self):
        with patch.dict(os.environ, {"STATE_BACKEND": "firestore", "DEMO_ACCESS_CODE": "short"}):
            with self.assertRaises(HTTPException) as error:
                require_user(request("short"))
            self.assertEqual(error.exception.status_code, 503)

    def test_local_needs_no_passcode_but_cannot_be_exposed_on_cloud_run(self):
        with patch.dict(os.environ, {"STATE_BACKEND": "sqlite", "K_SERVICE": ""}):
            self.assertEqual(require_user(request()), "local")
            with patch.dict(os.environ, {"K_SERVICE": "dropin-demo"}):
                with self.assertRaises(HTTPException) as error:
                    require_user(request())
                self.assertEqual(error.exception.status_code, 503)
