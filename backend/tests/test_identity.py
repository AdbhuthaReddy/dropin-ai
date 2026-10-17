import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from app.services.identity import require_user, require_worker


def request(token=""):
    return Request({"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())] if token else []})


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"STATE_BACKEND": "firestore", "GOOGLE_CLOUD_PROJECT": "demo",
                                                  "WORKER_AUDIENCE": "https://worker.test",
                                                  "TASK_SERVICE_ACCOUNT": "worker@demo.iam.gserviceaccount.com",
                                                  "ALLOWED_EMAILS": ""})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()

    def test_anonymous_mutation_rejected(self):
        with self.assertRaises(HTTPException) as error:
            require_user(request())
        self.assertEqual(error.exception.status_code, 401)

    def test_any_verified_google_reviewer_is_admitted(self):
        claims = {"uid": "jury", "email": "jury@example.test", "email_verified": True,
                  "firebase": {"sign_in_provider": "google.com"}}
        with patch("app.services.identity.firebase_app"), patch("firebase_admin.auth.verify_id_token", return_value=claims) as verify:
            self.assertEqual(require_user(request("test-token")), "jury")
            self.assertTrue(verify.call_args.kwargs["check_revoked"])

    def test_unverified_or_non_google_user_is_rejected(self):
        for claims in ({"uid": "u", "email_verified": False},
                       {"uid": "u", "email_verified": True, "firebase": {"sign_in_provider": "anonymous"}}):
            with patch("app.services.identity.firebase_app"), patch("firebase_admin.auth.verify_id_token", return_value=claims):
                with self.assertRaises(HTTPException):
                    require_user(request("test-token"))

    def test_optional_email_allowlist_is_enforced(self):
        claims = {"uid": "jury", "email": "jury@example.test", "email_verified": True,
                  "firebase": {"sign_in_provider": "google.com"}}
        with patch.dict(os.environ, {"ALLOWED_EMAILS": "owner@example.test"}), \
                patch("app.services.identity.firebase_app"), patch("firebase_admin.auth.verify_id_token", return_value=claims):
            with self.assertRaises(HTTPException):
                require_user(request("test-token"))

    def test_worker_rejects_user_identity_and_wrong_service_account(self):
        with patch("google.oauth2.id_token.verify_oauth2_token", return_value={"email": "intruder@example.test", "email_verified": True}):
            with self.assertRaises(HTTPException):
                require_worker(request("test-token"))

    def test_worker_requires_correct_audience_and_identity(self):
        with patch("google.oauth2.id_token.verify_oauth2_token", return_value={
                "email": "worker@demo.iam.gserviceaccount.com", "email_verified": True}) as verify:
            require_worker(request("test-token"))
            self.assertEqual(verify.call_args.kwargs["audience"], "https://worker.test")
