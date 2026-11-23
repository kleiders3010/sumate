# Sumate end-to-end in headless Chromium: organizer makes a sheet, two people sign up, organizer sees and exports.
# Run: python e2e.py [base-url]  (default http://127.0.0.1:8790; needs: pip install playwright)
import sys, os, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
OUT = os.path.join(os.path.dirname(__file__), "sumate-shots")
os.makedirs(OUT, exist_ok=True)
PHONE = dict(viewport={"width": 412, "height": 860}, device_scale_factor=2, is_mobile=True, has_touch=True)
errors = []

def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(OUT, name + ".png"))

def watch(page, who):
    page.on("pageerror", lambda e: errors.append(f"{who}: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"{who} console: {m.text}"))

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--disable-gpu"])
    org = b.new_context(locale="en-US", **PHONE)
    o = org.new_page(); watch(o, "org")
    o.goto(BASE + "/")
    shot(o, "01-home")
    o.click("#makeBtn")
    o.fill("#title", "Saturday lunch at grandma's")
    o.fill("#details", "Saturday 21, 13:00 at grandma's.\nBring your own chair!")
    rows = o.locator("#rows input.text")
    rows.nth(0).fill("Main dish")
    rows.nth(1).fill("Salad")
    rows.nth(2).fill("Dessert")
    rows.nth(2).press("Enter")
    o.keyboard.type("Drinks")
    # Main dish needs 2, Drinks any number
    o.locator("#rows .erow").nth(0).locator(".need button").nth(1).click()
    o.locator("#rows .erow").nth(3).locator(".need button").nth(0).click()
    o.click("#addHead")
    o.keyboard.type("Help")
    o.click("#addRow")
    o.keyboard.type("Set the table")
    shot(o, "02-editor")
    # an element property named like a browser method once put "function when() { [native code] }" on screen
    if "native code" in o.inner_text("body"):
        errors.append("org: the editor shows code text ('native code')")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    shot(o, "03-share")
    sheet_url = o.input_value("#shareLink")
    owner_url = o.input_value("#ownerLink")
    assert "#k=" in owner_url
    o.click("#shareClose")
    shot(o, "04-sheet-empty")

    # a guest in Spanish signs up for the main dish
    g = b.new_context(locale="es-AR", **PHONE)
    gp = g.new_page(); watch(gp, "guest")
    gp.goto(sheet_url)
    gp.wait_for_selector("#srows .srow")
    shot(gp, "05-guest-es")
    gp.locator("#srows .srow").nth(0).locator(".join").click()
    gp.fill("#signName", "Marta")
    gp.fill("#signNote", "lasaña vegana")
    shot(gp, "06-signbox-es")
    gp.click("#signForm .btn.primary")
    gp.wait_for_selector(".person.me")
    shot(gp, "07-guest-in-es")

    # a second guest takes the second main-dish spot and the salad
    h = b.new_context(locale="en-US", **PHONE)
    hp = h.new_page(); watch(hp, "guest2")
    hp.goto(sheet_url)
    hp.wait_for_selector("#srows .srow")
    for i in (0, 1):
        hp.locator("#srows .srow").nth(i).locator(".join").click()
        hp.fill("#signName", "Leo")
        hp.click("#signForm .btn.primary")
        hp.wait_for_timeout(400)
    assert hp.locator("#srows .srow").nth(0).locator(".join").count() == 0, "full row still offers Sign up"
    shot(hp, "08-guest2")

    # the organizer's page refreshes by itself
    o.wait_for_timeout(9000)
    assert o.locator(".person").count() == 3, o.locator(".person").count()
    shot(o, "09-organizer")
    with o.expect_download() as dl:
        o.click("#csvBtn")
    path = dl.value.path()
    csv = open(path, encoding="utf-8-sig").read()
    print(csv)
    assert "Marta" in csv and "lasaña vegana" in csv

    # guest removes herself; the organizer hides names
    gp.locator(".person.me .x").click()
    gp.wait_for_timeout(400)
    assert gp.locator(".person.me").count() == 0
    o.click("#editBtn")
    o.wait_for_selector("#edit:not([hidden])")
    o.uncheck("#showNames")
    o.click("#saveBtn")
    o.wait_for_selector("#sheet:not([hidden])")
    gp.reload()
    gp.wait_for_selector("#srows .srow")
    assert gp.locator(".person.anon").count() == 2, gp.locator(".person.anon").count()
    shot(gp, "10-guest-hidden-es")

    # the organizer link opens editing on another device
    other = b.new_context(locale="en-US", viewport={"width": 1280, "height": 860})
    op = other.new_page(); watch(op, "org-pc")
    op.goto(owner_url)
    op.wait_for_selector("#editBtn:not([hidden])")
    assert "#k=" not in op.url
    shot(op, "11-organizer-pc")
    op.goto(BASE + "/")
    shot(op, "12-home-pc")
    # clean up: the organizer deletes the test sheet (two taps)
    op.goto(sheet_url + "/edit")
    op.wait_for_selector("#delSheet:not([hidden])")
    op.click("#delSheet"); op.click("#delSheet")
    op.wait_for_selector("#home:not([hidden])")
    gone = op.request.get(sheet_url.replace("/s/", "/api/sheets/"))
    assert gone.status == 404, gone.status
    b.close()

print("errors:", errors)
print("OK" if not errors else "ERRORS")
