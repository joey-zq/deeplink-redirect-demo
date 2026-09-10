"""
Screenshots of the interstitial, both states, for design review.

Run with any Python that has Playwright + Chrome:
    python tools/screenshot-mockups.py
Writes interstitial-*.png into the current directory.

goto() never settles on this page, because the page navigates to a custom
scheme the moment it loads, so wait_until="commit" with a short timeout is
deliberate: wait for the full load and the countdown has expired before the
screenshot is taken.
"""
import asyncio
from playwright.async_api import async_playwright
BASE = "https://deeplink-demo.joeyzhq.workers.dev"
CASES = [("opening-light", "/1?wait=60000", "light"), ("opening-dark", "/2?wait=60000", "dark"),
         ("waiting-light", "/1?wait=0", "light"), ("waiting-play-dark", "/2?wait=0&android=page", "dark")]
UA_SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        for name, path, scheme in CASES:
            dev = dict(p.devices["iPhone 14"])
            if "play" in name:
                dev = dict(p.devices["Pixel 7"]); dev["user_agent"] = UA_SAMSUNG
            ctx = await b.new_context(**dev, color_scheme=scheme)
            page = await ctx.new_page()
            try:
                await page.goto(BASE + path, wait_until="commit", timeout=4000)
            except Exception as e:
                print("nav:", name, type(e).__name__)
            await page.wait_for_timeout(1200)
            await page.screenshot(path=f"interstitial-{name}.png")
            print("saved", name)
            await ctx.close()
        await b.close()
asyncio.run(main())
