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

        # Take control by clicking the center of the screen
        await page.mouse.click(960, 540)
        await asyncio.sleep(0.5)

        # Look down slightly
        await page.mouse.move(960, 600)

        # Let the main loop run to calculate the ghost block position
        await asyncio.sleep(0.2)

        # Switch to floor (slot 5)
        await page.keyboard.press('5')
        await asyncio.sleep(0.2)

        # Click to build floor
        await page.mouse.click(960, 540)
        await asyncio.sleep(0.2)

        # Move up/jump
        await page.keyboard.press('Space')
        await asyncio.sleep(0.5)

        # Switch to ramp (slot 6)
        await page.keyboard.press('6')
        await asyncio.sleep(0.2)

        # Click to build ramp
        await page.mouse.click(960, 540)
        await asyncio.sleep(0.2)

        # Switch back to shotgun (slot 3) to show the weapon
        await page.keyboard.press('3')
        await asyncio.sleep(0.5)

        # Move mouse to aim center
        await page.mouse.move(960, 500)
        await asyncio.sleep(0.5)

        print("Taking gameplay screenshot...")
        await page.screenshot(path='gameplay_screenshot_3.png')

        print("Done!")
        await browser.close()

asyncio.run(capture_gameplay())
