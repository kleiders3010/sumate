# Sheets that open and close at set times, and lines that stop taking sign-ups before they start (like SignUpGenius'
# start/stop dates and "lock before the event"). The organizer sets them in the editor; Ana, on a small phone, can't
# sign up before it opens, sees when it closes, and once it is closed on a final sheet can't remove herself (the
# organizer still can). Both servers refuse the same way (they run the same code: test.mjs and failover_test.py).
#   python worker/timing_test.py [site]   (local: cd worker && npx wrangler dev -c wrangler.test.toml --port 8790)
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
sys.stdout.reconfigure(encoding='utf-8')
from sheettok import sheet_token  # the per-sheet code a device sends (round 3, S5)
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
TZ = "America/Argentina/Buenos_Aires"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(SITE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "sumate-timing-test", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def page(**kw):
        pg = b.new_context(locale="en-US", timezone_id=TZ, **kw).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    # the organizer sets it to open tomorrow at 9 and close the day after at 18, lines a day before they start, final
    o = page(**PHONE)
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Bake sale")
    o.locator("#rows .erow").nth(0).locator("input.text").fill("Cakes")
    o.locator("#rows .erow").nth(1).locator("input.text").fill("Cookies")
    check(o.locator("#timing").is_hidden(), "the times are out of the way until asked for")
    o.click("#timingBtn")
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    after = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
    o.fill("#opensAt", after + "T09:00")
    o.fill("#closesAt", tomorrow + "T18:00")
    o.click("#saveBtn")
    check(o.is_visible("#editMsg") and o.is_visible("#editor, #edit"), "closing before opening is refused in the editor")
    o.fill("#opensAt", tomorrow + "T09:00")
    o.fill("#closesAt", after + "T18:00")
    o.select_option("#lockSel", "1440")
    o.check("#finalSw")
    check(o.evaluate("document.documentElement.scrollWidth <= innerWidth"), "the editor still fits a small phone")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    sid = link.rstrip("/").split("/")[-1]
    key = o.evaluate("JSON.parse(localStorage.getItem('sumate.sheets'))[0].key")
    o.click("#shareClose")
    st, v = call("GET", f"/api/sheets/{sid}")
    opens = v["sheet"].get("opens")
    want = int(datetime.strptime(tomorrow + " 09:00 -0300", "%Y-%m-%d %H:%M %z").timestamp() * 1000)
    # pinned: moments are ms in the organizer's own time; lock in minutes; the shipped save format
    check(opens == want and v["sheet"].get("lock") == 1440 and v["sheet"].get("final") is True,
          f"the server keeps the moments as the organizer's 9:00 ({opens} vs {want})")
    check(o.locator("#srows .join").count() == 2, "the organizer can still add people before it opens")

    ana = page(**PHONE)
    ana.goto(link)
    ana.wait_for_selector("#srows .srow")
    note = ana.inner_text("#closedNote")
    check(ana.is_visible("#closedNote") and "9:00 AM" in note, f"before it opens: when it opens ({note!r})")
    check(ana.locator("#srows .join").count() == 0, "and no Sign up buttons")
    rows = v["sheet"]["rows"]
    st, r = call("POST", f"/api/sheets/{sid}/signups", {"row": rows[0]["id"], "name": "Sneaky"})
    check(st == 409 and r.get("error") == "notyet",  # pinned: the API's error codes (the app reads them)
          f"the server refuses a sign-up before it opens ({st} {r})")

    # now: open, closing in a few seconds; Cakes starts in two hours, so it stopped taking sign-ups (a day before)
    sheet = dict(v["sheet"])
    sheet.pop("opens")
    sheet["closes"] = int(time.time() * 1000) + 20000
    soon = datetime.now(ZoneInfo(TZ)) + timedelta(hours=2)
    sheet["rows"] = [dict(rows[0], date=soon.strftime("%Y-%m-%d"), start=soon.strftime("%H:%M")), rows[1]]
    st, _ = call("PUT", f"/api/sheets/{sid}", sheet, {"X-Sheet-Key": key})
    check(st == 200, "the organizer changes the times")  # pinned: HTTP OK
    ana.reload()
    ana.wait_for_selector("#srows .srow")
    note = ana.inner_text("#closedNote")
    check(ana.is_visible("#closedNote") and note != "" and ana.locator("#srows .join").count() == 1, f"while open: when it closes ({note!r})")
    cakes, cookies = ana.locator("#srows .srow").nth(0), ana.locator("#srows .srow").nth(1)
    check(cakes.locator(".join").count() == 0 and cakes.locator(".shut").count() == 1, "a line a day away no longer takes sign-ups")
    st, r = call("POST", f"/api/sheets/{sid}/signups", {"row": rows[0]["id"], "name": "Sneaky"})
    check(st == 409 and r.get("error") == "locked",  # pinned: the API's error codes
          f"and the server refuses it ({st} {r})")
    cookies.locator(".join").click()
    ana.fill("#signName", "Ana")
    ana.click("#signForm .btn.primary")
    ana.wait_for_selector("#srows .person.me", timeout=15000)
    check(ana.locator("#srows .person.me .x").count() == 1, "while open she can remove herself")

    # closed: the page notices by itself, her × goes, the server refuses, the organizer still can
    left = sheet["closes"] - int(time.time() * 1000)
    ana.wait_for_timeout(max(0, left) + 9000)  # the page looks again every 8 s
    check(ana.inner_text("#closedNote") != note and ana.locator("#srows .join").count() == 0,
          "once closed the page says so by itself")
    check(ana.locator("#srows .person.me .x").count() == 0, "a final list: no removing herself")
    tok = sheet_token(ana.evaluate("localStorage.getItem('sumate.token')") or "", sid)
    st, v = call("GET", f"/api/sheets/{sid}", headers={"X-Sign-Tokens": tok})
    mine = [e for e in v["entries"] if e.get("mine")]
    st, r = call("DELETE", f"/api/sheets/{sid}/signups/{mine[0]['id'] if mine else 'zzzzzzzz'}", headers={"X-Sign-Tokens": tok})
    check(bool(mine) and st == 409 and r.get("error") == "final",  # pinned: the API's error codes
          f"and the server refuses it ({st} {r})")
    o.reload()
    o.wait_for_selector("#srows .person")
    check(o.locator("#srows .person .x").count() == 1, "the organizer can still remove her")
    o.click("#editBtn")
    o.wait_for_selector("#rows .erow")
    check(o.is_visible("#timing") and o.input_value("#lockSel") == "1440" and o.is_checked("#finalSw") and o.input_value("#closesAt"),
          "the editor shows them again")
    call("DELETE", f"/api/sheets/{sid}", headers={"X-Sheet-Key": key})
    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
