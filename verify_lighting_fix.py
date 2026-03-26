from playwright.sync_api import sync_playwright
import time
import subprocess
import os
import signal

def run_test():
    # Start the server
    server_process = subprocess.Popen(["node", "server.js"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(2) # wait for server to start

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 720})

            # Navigate to local game
            page.goto("http://localhost:3000")

            # Wait for main menu and click play
            page.wait_for_selector("#playBtn", state="visible", timeout=5000)
            page.click("#playBtn")

            # Wait a few seconds for scene to load, sky to generate, and game to start
            time.sleep(3)

            # Look up slightly towards the sun
            page.mouse.move(640, 360)
            page.mouse.down()
            page.mouse.move(640, 200) # drag mouse up to look up
            page.mouse.up()
            time.sleep(1)

            # Take screenshot
            os.makedirs("/home/jules/verification", exist_ok=True)
            screenshot_path = "/home/jules/verification/scifi_graphics_lighting_fix.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

            browser.close()
    finally:
        # cleanup server
        server_process.send_signal(signal.SIGINT)
        server_process.wait()

if __name__ == "__main__":
    run_test()
