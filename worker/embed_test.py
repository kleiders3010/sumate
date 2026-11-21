# A sheet on someone else's website: the share box gives website code (the sheet itself in an iframe that grows with
# it, or a button), like SignUpGenius' "share on website". The code is pasted into a page on another origin; on a
# small phone the iframe takes the sheet's height, has no app bar, the sign-up box opens next to the tapped line,
# and signing up works from inside it.
#   python worker/embed_test.py [site]   (local: cd worker && npx wrangler dev --port 8790)
import json
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# someone's own website, on another origin: a heading, the pasted code, text after it
HOST = {"html": ""}


class Site(BaseHTTPRequestHandler):
    def do_GET(self):
        body = HOST["html"].encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 0), Site)
threading.Thread(target=srv.serve_forever, daemon=True).start()
OTHER = f"http://localhost:{srv.server_address[1]}/"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def page(**kw):
        pg = b.new_context(locale="en-US", **kw).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    o = page(**PHONE)
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "School fair")
    for i, text in enumerate(["Cakes", "Drinks"]):
        o.locator("#rows .erow").nth(i).locator("input.text").fill(text)
    for i in range(6):  # a long sheet, taller than the iframe's starting height
        o.click("#addRow")
        o.locator("#rows .erow").last.locator("input.text").fill(f"Stand {i + 1}")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    sid = link.rstrip("/").split("/")[-1]
    key = o.evaluate("JSON.parse(localStorage.getItem('sumate.sheets'))[0].key")
    check(o.locator("#embedWrap").is_hidden(), "the website code is out of the way until asked for")
    o.click("#embedBtn")
    code = o.input_value("#embedCode")
    check("<iframe" in code and link in code, "the code is an iframe of this sheet")  # pinned: the shipped embed form
    o.select_option("#embedKind", "button")
    button = o.input_value("#embedCode")
    check(button.startswith("<a ") and f'href="{link}"' in button and "<script" not in button, "or a plain button link")
    check(o.evaluate("document.documentElement.scrollWidth <= innerWidth"), "the share box still fits a small phone")

    HOST["html"] = ("<!doctype html><meta name=viewport content='width=device-width'><body style='margin:0;font-family:sans-serif'>"
                    "<h1 style='padding:20px'>Our school</h1><p style='padding:0 20px'>Help us out:</p>"
                    + code + "<p id=after style='padding:20px'>Thanks!</p></body>")
    ana = page(**PHONE)
    ana.goto(OTHER)
    ana.wait_for_selector("iframe")
    fr = ana.frame_locator("iframe")
    fr.locator("#srows .srow").first.wait_for()
    ana.wait_for_function("() => document.querySelector('iframe').offsetHeight != 640", timeout=10000)
    ih = ana.evaluate("document.querySelector('iframe').offsetHeight")
    inner = ana.frames[1].evaluate("document.querySelector('#sheet').offsetHeight")
    check(abs(ih - inner) <= 2, f"the iframe takes the sheet's height ({ih} vs {inner})")
    check(fr.locator(".bar").first.is_hidden(), "no app bar inside someone else's page")
    check(fr.locator("#openFull").is_visible(), "a small link opens it in full")
    check(ana.evaluate("document.documentElement.scrollWidth <= innerWidth"), "the website still fits a small phone")

    # sign up on a line far down: the box opens there, in view, not at the bottom of the iframe
    row = fr.locator("#srows .srow").nth(6)
    row.scroll_into_view_if_needed()
    row.locator(".join").click()
    fr.locator("#signName").wait_for()
    box = fr.locator("#signForm").bounding_box()  # in the outer page's viewport
    check(box and box["y"] >= -4 and box["y"] + 40 <= 640, f"the sign-up box opens in view ({box and round(box['y'])})")
    fr.locator("#signName").fill("Ana")
    fr.locator("#signForm .btn.primary").click()
    fr.locator("#srows .person.me").wait_for(timeout=15000)
    st = urllib.request.urlopen(urllib.request.Request(f"{SITE}/api/sheets/{sid}", headers={"User-Agent": "sumate-embed-test"}), timeout=20)
    v = json.loads(st.read())
    check(any(e.get("name") == "Ana" for e in v["entries"]), "she signed up from inside the website")
    ana.wait_for_timeout(600)
    ih2 = ana.evaluate("document.querySelector('iframe').offsetHeight")
    inner = ana.frames[1].evaluate("document.querySelector('#sheet').offsetHeight")
    check(abs(ih2 - inner) <= 2, f"and still takes its height with her name in it ({ih2} vs {inner})")
    check(fr.locator("#srows .person.me .x").count() == 1, "she can remove herself there too")

    urllib.request.urlopen(urllib.request.Request(f"{SITE}/api/sheets/{sid}", method="DELETE",
                                                  headers={"X-Sheet-Key": key, "User-Agent": "sumate-embed-test"}), timeout=20)
    b.close()
srv.shutdown()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
