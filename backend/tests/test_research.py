import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

with patch("dotenv.load_dotenv"):
    from app.services import gemini_engine as engine


def verdict_payload(**overrides):
    return {
        "workflow_route": "ALTERNATIVE_ENGINEERED", "candidate_mpn": "PART-B",
        "search_reasoning": "Fixture research", "confidence_score": 0.99,
        "aml_authorization": True, "message": "Do not trust model approval",
        "distributor_quote": {"distributor": "DigiKey", "stock_available": 100, "unit_price_usd": 2, "lead_time_days": 3},
        **overrides,
    }


class NormalizationTests(unittest.TestCase):
    def normalize(self, mode="alternative", **overrides):
        return engine.normalize_verdict(verdict_payload(**overrides), "PART-A", mode, engine.Provenance())

    def test_alternative_is_never_authorized(self):
        self.assertFalse(self.normalize().aml_authorization)

    def test_model_cannot_forge_provenance(self):
        verdict = self.normalize(provenance={"stock_verified": True, "datasheets_verified": True})
        self.assertFalse(verdict.provenance.stock_verified)
        self.assertFalse(verdict.provenance.datasheets_verified)

    def test_firmware_differences_are_not_approved(self):
        self.assertFalse(self.normalize(engineering_flags=["FIRMWARE REWORK REQUIRED"]).aml_authorization)

    def test_invalid_alternatives_fail_closed(self):
        for candidate in ["", "part-a", "PART-A-ALT", "PART-A-REPLACEMENT", "CANDIDATE_NOT_VALIDATED"]:
            with self.subTest(candidate=candidate):
                verdict = self.normalize(candidate_mpn=candidate)
                self.assertEqual(verdict.workflow_route, "ENGINEERING_REVIEW_REQUIRED")
                self.assertEqual(verdict.action_buy_url, "")

    def test_model_review_route_remains_review(self):
        self.assertEqual(self.normalize(workflow_route="ENGINEERING_REVIEW_REQUIRED").workflow_route, "ENGINEERING_REVIEW_REQUIRED")

    def test_exact_keeps_original_and_never_authorizes(self):
        verdict = self.normalize("exact", candidate_mpn="PART-A", workflow_route="EXACT_ORIGINAL_PROCURED")
        self.assertEqual(verdict.candidate_mpn, "PART-A")
        self.assertFalse(verdict.aml_authorization)

    def test_exact_unavailable_has_no_link(self):
        for quote in [{}, {"stock_available": 0}]:
            verdict = self.normalize("exact", candidate_mpn="PART-A", workflow_route="EXACT_ORIGINAL_UNAVAILABLE", distributor_quote=quote)
            self.assertEqual(verdict.workflow_route, "EXACT_ORIGINAL_UNAVAILABLE")
            self.assertEqual(verdict.action_buy_url, "")

    def test_exact_rejection_not_overridden_by_positive_stock(self):
        verdict = self.normalize("exact", candidate_mpn="PART-A", workflow_route="EXACT_ORIGINAL_UNAVAILABLE")
        self.assertEqual(verdict.action_buy_url, "")
        self.assertFalse(verdict.aml_authorization)

    def test_wrong_exact_mpn_quote_is_discarded(self):
        verdict = self.normalize("exact", workflow_route="EXACT_ORIGINAL_PROCURED")
        self.assertEqual(verdict.workflow_route, "ENGINEERING_REVIEW_REQUIRED")
        self.assertEqual(verdict.distributor_quote.stock_available, 0)
        self.assertEqual(verdict.action_buy_url, "")

    def test_zero_stock_alternative_not_authorized_or_linked(self):
        verdict = self.normalize(distributor_quote={})
        self.assertFalse(verdict.aml_authorization)
        self.assertFalse(verdict.action_buy_url)

    def test_negative_quote_rejected(self):
        for field in ["stock_available", "unit_price_usd", "lead_time_days"]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.normalize(distributor_quote={field: -1})

    def test_nonfinite_quote_rejected(self):
        for value in [float("nan"), float("inf")]:
            with self.assertRaises(ValueError):
                self.normalize(distributor_quote={"unit_price_usd": value})

    def test_fractional_stock_rejected(self):
        with self.assertRaises(ValueError):
            self.normalize(distributor_quote={"stock_available": 2.5})

    def test_confidence_range(self):
        for value in [-0.01, 1.01, float("nan")]:
            with self.assertRaises(ValueError):
                self.normalize(confidence_score=value)

    def test_oem_never_gets_fabricated_escalation_or_quote(self):
        verdict = self.normalize(workflow_route="OEM_CUSTOM_ESCALATION")
        self.assertFalse(verdict.aml_authorization)
        self.assertEqual(verdict.distributor_quote.stock_available, 0)
        self.assertEqual(verdict.action_buy_url, "")
        self.assertIn("No order", verdict.message)

    def test_catalog_url_is_generated_not_model_owned(self):
        verdict = self.normalize(action_buy_url="javascript:alert(1)")
        self.assertEqual(verdict.action_buy_url, "https://www.digikey.com/en/products/result?keywords=PART-B")
        self.assertIn("A%2BB", engine.ensure_valid_url("A+B", "Mouser"))

    def test_json_parser(self):
        for text in ['{"a":1}', '```json\n{"a":1}\n```', 'prefix {"a":1} suffix']:
            self.assertEqual(engine.extract_json_from_llm(text), {"a": 1})
        for text in ["[]", "null", "{invalid"]:
            with self.assertRaises(ValueError):
                engine.extract_json_from_llm(text)


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_deadline_covers_waiting_for_provider_capacity(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test"}), \
             patch.object(engine, "_slots", asyncio.Semaphore(0)), \
             patch.object(engine, "REQUEST_TIMEOUT_SECONDS", 0.001):
            with self.assertRaises(engine.ProviderUnavailable):
                await engine.generate_json("system", "prompt", search=True)

    async def test_no_more_than_two_provider_calls_at_once(self):
        active, peak = 0, 0
        release = asyncio.Event()
        two_started = asyncio.Event()

        async def blocked(**kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 2:
                two_started.set()
            await release.wait()
            active -= 1
            return SimpleNamespace(output_text='{"x":1}', steps=[])

        fake = MagicMock()
        fake.interactions.create = AsyncMock(side_effect=blocked)
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=fake)
        manager.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODELS": "test-model"}), \
             patch.object(engine, "_slots", asyncio.Semaphore(2)), \
             patch.object(engine.genai, "Client") as client:
            client.return_value.aio = manager
            tasks = [asyncio.create_task(engine.generate_json("system", "prompt", search=True)) for _ in range(6)]
            await asyncio.wait_for(two_started.wait(), timeout=2)
            self.assertEqual(peak, 2)
            release.set()
            await asyncio.gather(*tasks)
        self.assertEqual(peak, 2)

    async def test_unconfigured_key_fails_only_when_provider_called(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            with self.assertRaises(engine.ProviderUnavailable):
                await engine.generate_json("system", "prompt", search=True)

    async def test_provider_evidence_and_model_are_retained(self):
        response = SimpleNamespace(
            output_text=json.dumps(verdict_payload()),
            steps=[SimpleNamespace(type="model_output", content=[SimpleNamespace(
                type="text", annotations=[
                    SimpleNamespace(url="https://manufacturer.example/datasheet", title="Manufacturer"),
                    SimpleNamespace(url="javascript:alert(1)", title="Unsafe"),
                ],
            )])],
        )
        fake = MagicMock()
        fake.interactions.create = AsyncMock(return_value=response)
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=fake)
        manager.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODELS": "test-model"}), \
             patch.object(engine.genai, "Client") as client:
            client.return_value.aio = manager
            parsed, provenance = await engine.generate_json("system", "prompt", search=True)
        self.assertEqual(parsed["candidate_mpn"], "PART-B")
        self.assertEqual(provenance.model, "test-model")
        self.assertEqual(provenance.grounding_status, "search_evidence_returned")
        self.assertEqual(len(provenance.sources), 1)
        self.assertFalse(provenance.stock_verified)
        self.assertEqual(fake.interactions.create.call_args.kwargs["tools"], [{"type": "google_search"}])
        self.assertEqual(fake.interactions.create.call_args.kwargs["model"], "test-model")
        self.assertEqual(client.call_args.kwargs["http_options"].timeout, 20000)

    async def test_no_evidence_does_not_masquerade_as_grounded(self):
        fake = MagicMock()
        fake.interactions.create = AsyncMock(return_value=SimpleNamespace(output_text='{"x":1}', steps=[]))
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=fake)
        manager.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODELS": "test-model"}), \
             patch.object(engine.genai, "Client") as client:
            client.return_value.aio = manager
            _, provenance = await engine.generate_json("system", "prompt", search=True)
        self.assertEqual(provenance.grounding_status, "no_search_evidence")

    async def test_model_fallback_keeps_search_enabled(self):
        fake = MagicMock()
        fake.interactions.create = AsyncMock(side_effect=[
            ValueError("Malformed response"), SimpleNamespace(output_text='{"x":1}', steps=[]),
        ])
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=fake)
        manager.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODELS": "first,second"}), \
             patch.object(engine.genai, "Client") as client:
            client.return_value.aio = manager
            _, provenance = await engine.generate_json("system", "prompt", search=True)
        self.assertEqual(provenance.model, "second")
        self.assertTrue(all(
            call.kwargs["tools"] == [{"type": "google_search"}]
            for call in fake.interactions.create.call_args_list
        ))

    async def test_rate_limit_is_not_reported_as_exhausted_quota(self):
        fake = MagicMock()
        fake.interactions.create = AsyncMock(side_effect=[
            engine.genai.errors.APIError(429, {
                "error": {
                    "code": 429,
                    "status": "RESOURCE_EXHAUSTED",
                    "message": "Request rate limit exceeded",
                },
            }),
            engine.genai.errors.APIError(404, {
                "error": {
                    "code": 404,
                    "status": "NOT_FOUND",
                    "message": "Model not found",
                },
            }),
        ])
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=fake)
        manager.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODELS": "first,second"}), \
             patch.object(engine.genai, "Client") as client:
            client.return_value.aio = manager
            with self.assertRaises(engine.ProviderUnavailable) as caught:
                await engine.generate_json("system", "prompt", search=True)
        self.assertEqual(caught.exception.reason, "rate_limited")

    async def test_interactions_402_prepaid_credits_is_reported(self):
        class PaymentRequiredError(Exception):
            status_code = 402

        fake = MagicMock()
        fake.interactions.create = AsyncMock(side_effect=PaymentRequiredError(
            "prepayment credits depleted",
        ))
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=fake)
        manager.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODELS": "first,second"}), \
             patch.object(engine.genai, "Client") as client:
            client.return_value.aio = manager
            with self.assertRaises(engine.ProviderUnavailable) as caught:
                await engine.generate_json("system", "prompt", search=True)
        self.assertEqual(caught.exception.reason, "payment_required")
        fake.interactions.create.assert_awaited_once()

    async def test_cancellation_propagates_to_async_provider(self):
        async def blocked(**kwargs):
            await asyncio.sleep(100)
        fake = MagicMock()
        fake.interactions.create = AsyncMock(side_effect=blocked)
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=fake)
        manager.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODELS": "test-model"}), \
             patch.object(engine.genai, "Client") as client:
            client.return_value.aio = manager
            task = asyncio.create_task(engine.generate_json("system", "prompt", search=True))
            await asyncio.sleep(0)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task


class OfflineFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_offline_mode_returns_pmic_exact_verdict(self):
        with patch.dict(os.environ, {"DEMO_OFFLINE_MODE": "true"}):
            verdict = await engine.evaluate_component_shortage("MAX77650EWV+T", "PMIC", "exact")
        self.assertEqual(verdict.workflow_route, "EXACT_ORIGINAL_PROCURED")
        self.assertEqual(verdict.candidate_mpn, "MAX77650EWV+T")
        self.assertGreater(verdict.distributor_quote.stock_available, 0)
        self.assertTrue(verdict.action_buy_url.startswith("https://"))
        self.assertFalse(verdict.aml_authorization)
        self.assertEqual(verdict.provenance.model, "gemini-2.5-flash")

    async def test_offline_mode_returns_pmic_alternative_verdict(self):
        with patch.dict(os.environ, {"DEMO_OFFLINE_MODE": "true"}):
            verdict = await engine.evaluate_component_shortage("MAX77650EWV+T", "PMIC", "alternative")
        self.assertEqual(verdict.workflow_route, "ALTERNATIVE_ENGINEERED")
        self.assertEqual(verdict.candidate_mpn, "MAX77651AEWV+T")
        self.assertTrue(any("FIRMWARE" in flag for flag in verdict.engineering_flags))
        self.assertFalse(verdict.aml_authorization)

    async def test_offline_mode_tensor_a1_unobtainium_escalation(self):
        with patch.dict(os.environ, {"DEMO_OFFLINE_MODE": "true"}):
            verdict_exact = await engine.evaluate_component_shortage("GGL-TENS-A1-REV2", "Tensor A1", "exact")
            verdict_alt = await engine.evaluate_component_shortage("GGL-TENS-A1-REV2", "Tensor A1", "alternative")
        self.assertEqual(verdict_exact.workflow_route, "EXACT_ORIGINAL_UNAVAILABLE")
        self.assertEqual(verdict_alt.workflow_route, "OEM_CUSTOM_ESCALATION")
        self.assertEqual(verdict_alt.candidate_mpn, "REQUIRES_OEM_INTERVENTION")

    async def test_all_ten_bom_items_have_valid_fallback(self):
        mpns = [
            "FXN-GRVCC-SHL-PNY", "GAW325", "NMF-FPC-CAP-02", "GGL-TENS-A1-REV2",
            "MAX77650EWV+T", "SPH0641LU4H-1", "BMI323", "CP1154-A3",
            "GTR-11MM-D", "CP1025-M",
        ]
        with patch.dict(os.environ, {"DEMO_OFFLINE_MODE": "true"}):
            for mpn in mpns:
                for mode in ("exact", "alternative"):
                    with self.subTest(mpn=mpn, mode=mode):
                        verdict = await engine.evaluate_component_shortage(mpn, "Demo part", mode)
                        self.assertIsInstance(verdict, engine.AgentHardwareVerdict)
                        self.assertFalse(verdict.aml_authorization)
                        self.assertTrue(len(verdict.search_reasoning) > 10)

