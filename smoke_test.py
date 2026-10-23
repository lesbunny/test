#!/usr/bin/env python3
"""Browser smoke test for the embedded Arch Migrate UI.

Starts the app against a temporary HOME and checks that the UI renders,
the overview initializes, and navigation to each page works.
"""
import asyncio
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

APP = Path(__file__).with_name("arch.py")


async def main():
    errors = []
    with tempfile.TemporaryDirectory(prefix="arch-ui-smoke-") as tmp:
        env = dict(os.environ)
        env["HOME"] = tmp
        proc = subprocess.Popen(
            [sys.executable, "-u", str(APP), "--no-browser", "--port", "0"],
            cwd=str(APP.parent), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        try:
            line = proc.stdout.readline().strip()
            match = re.search(r"running at (http://127\.0\.0\.1:\d+/)", line)
            if not match:
                raise RuntimeError(f"App didn't report a local URL: {line!r}")
            url = match.group(1)

            # Wait for the server to be ready.
            for _ in range(60):
                try:
                    with urllib.request.urlopen(url, timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(0.15)
            else:
                raise RuntimeError("The application server never became ready")

            async with async_playwright() as p:
                browser = await p.chromium.launch()
                page = await browser.new_page(viewport={"width": 1280, "height": 900})
                page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
                page.on("console", lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" else None)
                response = await page.goto(url, wait_until="domcontentloaded")
                assert response and response.status == 200, "UI HTML did not return HTTP 200"
                assert await page.title() == "Arch Migrate", "Unexpected page title"
                assert await page.locator(".page.on").count() == 1, "No active page is marked"
                assert await page.locator(".page.on").is_visible(), "The active page is not visible"
                assert await page.locator("body").inner_text(), "Page body is empty"

                # Let API-backed overview initialize; a backend failure must not blank the whole UI.
                await page.wait_for_timeout(1500)
                assert await page.locator("#ov-tiles").count() == 1, "Overview page wasn't inserted"
                assert await page.locator("#ov-tiles").is_visible(), "Overview tiles are hidden"

                for name in ["backup", "restore", "store", "github", "manage", "themes", "overview"]:
                    await page.locator(f'.nav[data-p="{name}"]').click()
                    assert await page.locator(f"#p-{name}").is_visible(), f"Navigation failed for {name}"

                if errors:
                    raise AssertionError("Browser console errors:\n" + "\n".join(errors))
                print("UI browser smoke test passed: initial render, overview, and all navigation pages OK")
                await browser.close()
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)


if __name__ == "__main__":
    asyncio.run(main())
