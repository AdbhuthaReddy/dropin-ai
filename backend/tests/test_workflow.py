import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.services import public_sources, workflow
from app.services.gemini_engine import Provenance, ProviderUnavailable


ITEM = {"mpn": "TEST-A", "vendor": "Example Semiconductor", "stock": 10, "safetyStock": 100}


class OfferTests(unittest.TestCase):
    def offer(self, **kwargs):
        return workflow.Offer(**{
            "mpn_quote": "TEST-A", "manufacturer_quote": "Example Semiconductor",
            "stock_quote": "In stock: 1,000", "quantity": 1000, **kwargs,
        })

    def test_matching_reported_offer(self):
        self.assertTrue(workflow.offer_matches(self.offer(), "TEST-A Example Semiconductor In stock: 1,000", ITEM))

    def test_insufficient_stock_is_not_exact_success(self):
        self.assertFalse(workflow.offer_matches(self.offer(quantity=10, stock_quote="In stock: 10"),
                                               "TEST-A Example Semiconductor In stock: 10", ITEM))

    def test_wrong_mpn_manufacturer_and_nonexistent_quote_rejected(self):
        for changes in ({"mpn_quote": "TEST-B"}, {"manufacturer_quote": "Wrong"}, {"stock_quote": "In stock: 100000"}):
            self.assertFalse(workflow.offer_matches(self.offer(**changes), "TEST-A Example Semiconductor In stock: 1,000", ITEM))

    def test_backorder_and_unknown_stock_do_not_count(self):
        for quote in ("Backorder 1,000 available", "1,000 minimum order", "Not available: 1,000",
                      "0 in stock; minimum order 1,000", "Not currently available: 1,000"):
            self.assertFalse(workflow.offer_matches(self.offer(stock_quote=quote), f"TEST-A Example Semiconductor {quote}", ITEM))

    def test_similarity_is_explicitly_not_probability(self):
        result = workflow.similarity({"comparisons": [{"finding": key} for key in ("match", "difference", "unknown", "match")]})
        self.assertEqual(result["evidence_match_percent"], 50)
        self.assertEqual(result["unknown"], 1)
        self.assertEqual(result["substitution_potential"], "changes_or_constraints_identified")

    def test_all_matching_parameters_with_missing_change_assessment_is_insufficient(self):
        result = workflow.similarity({"comparisons": [{"finding": "match"}]})
        self.assertEqual(result["evidence_match_percent"], 100)
        self.assertEqual(result["substitution_potential"], "insufficient_evidence")


class SourceTests(unittest.IsolatedAsyncioTestCase):
    def test_url_policy_rejects_untrusted_targets(self):
        for url in ("http://ti.com/a.pdf", "https://ti.com.evil.test/a", "https://127.0.0.1/a",
                    "https://ti.com@evil.test/a", "https://ti.com:8080/a", "https://metadata.google.internal/a"):
            with self.subTest(url=url), self.assertRaises(public_sources.SourceError):
                public_sources.allowed_url(url)
        self.assertEqual(public_sources.allowed_url("https://www.ti.com/a.pdf"), "https://www.ti.com/a.pdf")

    async def test_private_dns_address_rejected(self):
        with patch("asyncio.base_events.BaseEventLoop.getaddrinfo", new_callable=AsyncMock,
                   return_value=[(None, None, None, None, ("127.0.0.1", 443))]):
            with self.assertRaises(public_sources.SourceError):
                await public_sources.public_address("https://ti.com/a")

    async def test_robots_denial_is_respected(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(200, text="User-agent: *\nDisallow: /"))) as client:
            with patch.object(public_sources, "public_address", new_callable=AsyncMock):
                with self.assertRaises(public_sources.SourceError):
                    await public_sources._robots(client, "https://ti.com/a.pdf")

    async def test_robots_unavailable_does_not_assume_permission(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(403))) as client:
            with patch.object(public_sources, "public_address", new_callable=AsyncMock):
                with self.assertRaises(public_sources.SourceError):
                    await public_sources._robots(client, "https://ti.com/a.pdf")

    async def test_pdf_document_must_identify_requested_mpn(self):
        with patch.object(workflow, "retrieve", new_callable=AsyncMock, return_value=(b"%PDF-", "https://ti.com/a.pdf")), \
                patch.object(workflow, "extract_isolated", new_callable=AsyncMock, return_value={"pages": ["WRONG-PART"]}):
            with self.assertRaises(public_sources.SourceError):
                await workflow.fetch_datasheet(["https://ti.com/a.pdf"], "TEST-A")

    async def test_redirect_to_internal_or_unapproved_host_is_rejected(self):
        def handler(request):
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            return httpx.Response(302, headers={"Location": "https://metadata.google.internal/latest"})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch.object(public_sources.httpx, "AsyncClient", return_value=client), \
                patch.object(public_sources, "public_address", new_callable=AsyncMock):
            with self.assertRaises(public_sources.SourceError):
                await public_sources.retrieve("https://ti.com/product", pdf=False)

    async def test_download_limit_is_enforced_while_streaming(self):
        def handler(request):
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            return httpx.Response(200, content=b"x" * 1_000_001, headers={"content-type": "text/html"})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch.object(public_sources.httpx, "AsyncClient", return_value=client), \
                patch.object(public_sources, "public_address", new_callable=AsyncMock):
            with self.assertRaises(public_sources.SourceError):
                await public_sources.retrieve("https://ti.com/product", pdf=False)

    async def test_login_or_captcha_html_is_not_accepted_as_a_pdf(self):
        def handler(request):
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            return httpx.Response(200, text="<html>Sign in</html>")
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch.object(public_sources.httpx, "AsyncClient", return_value=client), \
                patch.object(public_sources, "public_address", new_callable=AsyncMock):
            with self.assertRaises(public_sources.SourceError):
                await public_sources.retrieve("https://ti.com/datasheet", pdf=True)


class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_available_stops_before_datasheets(self):
        offer = {"mpn_quote": "TEST-A", "manufacturer_quote": "Example Semiconductor",
                 "stock_quote": "In stock: 1,000", "quantity": 1000}
        with patch.object(workflow, "discover", new_callable=AsyncMock, return_value=(["https://ti.com/a"], {})), \
                patch.object(workflow, "retrieve", new_callable=AsyncMock,
                             return_value=("TEST-A Example Semiconductor In stock: 1,000", "https://ti.com/a")), \
                patch.object(workflow, "generate_json", new_callable=AsyncMock, return_value=(offer, Provenance())), \
                patch.object(workflow, "fetch_datasheet", new_callable=AsyncMock) as documents:
            report = await workflow.run_workflow(ITEM, AsyncMock())
        self.assertEqual(report["status"], "EXACT_AVAILABILITY_REPORTED")
        self.assertFalse(report["inventory_changed"])
        documents.assert_not_awaited()

    async def test_original_text_drives_discovery_and_both_pdfs_are_compared(self):
        original = {"pages": ["TEST-A supply 1.8V"], "sha256": "a"}
        candidate = {"pages": ["TEST-B supply 2.4V"], "sha256": "b"}
        choices = {"candidates": [{"mpn": "TEST-B", "manufacturer": "Example", "datasheet_url": "https://ti.com/b.pdf", "rationale": "Similar"}]}
        comparison = {"comparisons": [{"finding": "difference"}], "change_assessment": [{"area": "firmware", "status": "unknown"}]}
        with patch.object(workflow, "discover", new_callable=AsyncMock, side_effect=[([], {}), (["https://ti.com/a.pdf"], {})]), \
                patch.object(workflow, "fetch_datasheet", new_callable=AsyncMock, side_effect=[original, candidate]), \
                patch.object(workflow, "generate_json", new_callable=AsyncMock, return_value=(choices, Provenance())) as discovery, \
                patch.object(workflow, "compare_documents", new_callable=AsyncMock, return_value=comparison) as compare:
            report = await workflow.run_workflow(ITEM, AsyncMock())
        self.assertIn("1.8V", discovery.call_args.args[1])
        compare.assert_awaited_once_with(original, candidate, "", True)
        self.assertEqual(report["status"], "COMPARISON_READY_FOR_REVIEW")
        self.assertEqual(report["alternatives"][0]["similarity"]["difference"], 1)
        self.assertEqual(report["alternatives"][0]["required_changes"][0]["status"], "unknown")

    async def test_quota_error_is_not_treated_as_original_unavailable(self):
        with patch.object(workflow, "discover", new_callable=AsyncMock, side_effect=ProviderUnavailable("quota")), \
                patch.object(workflow, "fetch_datasheet", new_callable=AsyncMock) as documents:
            with self.assertRaises(ProviderUnavailable):
                await workflow.run_workflow(ITEM, AsyncMock())
            documents.assert_not_awaited()
