# APP-RULES 243/244 swept from Ronda's UX review (2026-11-28): the boxes (sign up, share, calendar) are named
# dialogs, a tap outside keeps one with something typed in it, Tab stays inside, Back closes the box (the sheet
# stays), and placeholder-only fields have a name. Run: python worker/sheet28_test.py [site]
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


UNNAMED = """() => [...document.querySelectorAll('input[placeholder], textarea[placeholder]')]
    .filter((f) => !f.labels?.length && !f.getAttribute('aria-label')).map((f) => f.id || f.name)"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=["--disable-gpu"])
    o = b.new_context(locale="en-US", **PHONE).new_page()
    o.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    o.goto(SITE + "/")
    o.click("#makeBtn")
    check(not o.evaluate(UNNAMED), f"244 the editor's placeholder-only fields have names ({o.evaluate(UNNAMED)})")
    o.fill("#title", "Box check")
    o.locator("#rows input.text").nth(0).fill("Salad")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    o.click("#shareClose")

    v = b.new_context(locale="en-US", **PHONE).new_page()
    v.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    v.goto(link)
    v.locator("#srows .srow .join").nth(0).click()
    v.wait_for_selector("#signBox:not([hidden])")
    named = v.evaluate("() => { const s = document.getElementById('signBox'); return [s.getAttribute('role'), document.getElementById(s.getAttribute('aria-labelledby') || '-')?.textContent || '']; }")
    check(named[0] == "dialog" and "Salad" in named[1], f"243 the sign-up box is a dialog named by its title ({named})")  # pinned: the line this test made
    check(not v.evaluate(UNNAMED), f"244 the sign-up box's fields have names ({v.evaluate(UNNAMED)})")
    v.fill("#signName", "Ana")
    v.mouse.click(5, 5)
    v.wait_for_timeout(300)
    check(v.is_visible("#signBox"), "243 a tap outside keeps a box with something typed in it")
    inside = True
    for _ in range(20):
        v.keyboard.press("Tab")
        if not v.evaluate("() => document.getElementById('signBox').contains(document.activeElement)"):
            inside = False
            break
    check(inside, "243 Tab stays inside the box")
    v.go_back()
    v.wait_for_timeout(500)
    check(not v.is_visible("#signBox") and v.is_visible("#sheet") and v.url == link, f"243 Back closes the box, the sheet stays ({v.url})")
    # an untouched box: a tap outside closes it, and its history entry goes with it
    v.locator("#srows .srow .join").nth(0).click()
    v.wait_for_selector("#signBox:not([hidden])")
    v.mouse.click(5, 5)
    v.wait_for_timeout(400)
    check(not v.is_visible("#signBox"), "243 a tap outside an untouched box closes it")
    st = v.evaluate("() => history.state && history.state.box")
    check(not st, f"243 its history entry went with it ({st})")

    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
