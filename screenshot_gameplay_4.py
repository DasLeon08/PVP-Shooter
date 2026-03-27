import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True, args=['--use-gl=egl'])
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    # Listen for console logs
    page.on("console", lambda msg: print(f"Browser console: {msg.text}"))

    print("Navigating to game...")
    page.goto('http://localhost:3000')
    time.sleep(2)

    print("Clicking play button...")
    page.click('#playBtn')
    time.sleep(3) # Wait to drop in

    print("Moving around...")
    page.keyboard.press('w', delay=500)
    page.mouse.move(960, 540)
    page.mouse.down()
    page.mouse.move(1060, 540)
    page.mouse.up()
    time.sleep(1)

    print("Building a ramp...")
    page.keyboard.press('6') # Ramp
    time.sleep(0.5)
    page.mouse.click(960, 540)
    time.sleep(1)

    print("Building a wall...")
    page.keyboard.press('4') # Wall
    page.mouse.move(960, 500)
    time.sleep(0.5)
    page.mouse.click(960, 500)
    time.sleep(1)

    print("Switching to Shotgun and aiming...")
    page.keyboard.press('3') # Shotgun
    time.sleep(0.5)
    page.mouse.move(1200, 540) # Look to the right slightly
    time.sleep(0.5)

    print("Taking screenshot...")
    page.screenshot(path='gameplay_screenshot_4.png')
    print("Screenshot saved to gameplay_screenshot_4.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
