import asyncio
import ipaddress
import os
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

USER_AGENT = "DropInResearchBot/1.0"
DEFAULT_HOSTS = "ti.com,analog.com,nxp.com,st.com,microchip.com,infineon.com,onsemi.com,mouser.com,digikey.com"


class SourceError(ValueError):
    pass


def allowed_url(url: str) -> str:
    parts = urlsplit(url)
    hosts = [host.strip().lower() for host in os.getenv("PUBLIC_SOURCE_HOSTS", DEFAULT_HOSTS).split(",") if host.strip()]
    host = (parts.hostname or "").lower()
    if (parts.scheme != "https" or parts.username or parts.password or parts.port not in (None, 443)
            or not any(host == domain or host.endswith("." + domain) for domain in hosts)
            or len(url) > 2000):
        raise SourceError("URL is not an allowed HTTPS manufacturer/distributor source.")
    return url


async def public_address(url: str):
    host = urlsplit(allowed_url(url)).hostname
    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SourceError("Source hostname could not be resolved.") from exc
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise SourceError("Non-public source addresses are forbidden.")


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)


async def _robots(client: httpx.AsyncClient, target: str):
    origin = urlsplit(target)
    url = f"https://{origin.netloc}/robots.txt"
    for _ in range(4):
        await public_address(url)
        async with client.stream("GET", url, headers={"User-Agent": USER_AGENT}) as response:
            if response.is_redirect:
                url = allowed_url(urljoin(url, response.headers.get("location", "")))
                continue
            if response.status_code == 404:
                return
            if response.status_code != 200:
                raise SourceError(f"Source robots policy unavailable (HTTP {response.status_code}).")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 128_000:
                    raise SourceError("Source robots policy exceeds size limit.")
            rules = RobotFileParser()
            rules.parse(data.decode("utf-8", errors="replace").splitlines())
            if not rules.can_fetch(USER_AGENT, target):
                raise SourceError("Source robots.txt forbids retrieval; use a permitted document upload.")
            delay = rules.crawl_delay(USER_AGENT) or 0
            rate = rules.request_rate(USER_AGENT)
            if rate:
                delay = max(delay, rate.seconds / rate.requests)
            if delay > 10:
                raise SourceError("Source crawl delay exceeds this bounded workflow; use a permitted document upload.")
            if delay:
                await asyncio.sleep(delay)
            return
    raise SourceError("Source robots policy exceeded redirect limit.")


async def retrieve(url: str, *, pdf: bool):
    allowed_url(url)
    try:
        async with asyncio.timeout(35):
            async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
                current = url
                for _ in range(4):
                    await _robots(client, current)
                    await public_address(current)
                    async with client.stream("GET", current, headers={"User-Agent": USER_AGENT}) as response:
                        if response.is_redirect:
                            current = allowed_url(urljoin(current, response.headers.get("location", "")))
                            continue
                        if response.status_code != 200:
                            raise SourceError(f"Source refused retrieval (HTTP {response.status_code}); no bypass attempted.")
                        data = bytearray()
                        limit = 10 * 1024 * 1024 if pdf else 1_000_000
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > limit:
                                raise SourceError("Source exceeds the download size limit.")
                        if pdf:
                            if not data.startswith(b"%PDF-"):
                                raise SourceError("Source did not return a PDF; no CAPTCHA/login bypass attempted.")
                            return bytes(data), current
                        if "html" not in response.headers.get("content-type", ""):
                            raise SourceError("Product source is not an HTML page.")
                        parser = TextExtractor()
                        parser.feed(data.decode("utf-8", errors="replace"))
                        return re.sub(r"\s+", " ", " ".join(parser.text)).strip()[:80_000], current
                raise SourceError("Source exceeded the redirect limit.")
    except (httpx.HTTPError, TimeoutError) as exc:
        raise SourceError("Source retrieval timed out or failed; no evidence was inferred.") from exc
