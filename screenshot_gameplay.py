import asyncio
from playwright.async_api import async_playwright
import time

async def capture_gameplay():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Use high resolution for a good screenshot
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})

        print("Loading game...")
        await page.goto('http://localhost:3000')

        print("Waiting for Play button...")
        await page.wait_for_selector('#playBtn')

        # Click Play
        await page.evaluate("document.getElementById('playBtn').click()")

        # Wait a bit to spawn in
        await asyncio.sleep(1)

        print("Simulating gameplay...")
        # Press W to move forward a bit
        await page.keyboard.down('w')
        await asyncio.sleep(0.5)
        await page.keyboard.up('w')

        # Switch to wall (slot 4)
        await page.keyboard.press('4')
        await asyncio.sleep(0.5)

        # Click to build wall
        await page.mouse.click(960, 540)
        await asyncio.sleep(0.2)

        # Switch to ramp (slot 6)
        await page.keyboard.press('6')

        # Move mouse to look around slightly to make it look dynamic
        await page.mouse.move(1060, 540) # Turn right
        await asyncio.sleep(0.5)

        # Click to build ramp
        await page.mouse.click(960, 540)

        # Switch back to shotgun (slot 3) to show the weapon
        await page.keyboard.press('3')
        await asyncio.sleep(0.5)

        # Move mouse again
        await page.mouse.move(960, 500) # Look up slightly
        await asyncio.sleep(0.5)

        print("Taking gameplay screenshot...")
        await page.screenshot(path='gameplay_screenshot.png')

        print("Done!")
        await browser.close()

asyncio.run(capture_gameplay())
