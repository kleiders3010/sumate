# Copy a sheet (like SignUpGenius' "duplicate"): the organizer makes next week's sheet from this one. The copy has the
# same lines, times and questions, nobody signed up on it, its own link, and every day can move a week at once. The
# original keeps its people.
#   python worker/copy_test.py [site]   (local: cd worker && npx wrangler dev --port 8790)
import json
import sys
import urllib.request
from datetime import date, timedelta
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(SITE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "sumate-copy-test", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


day1 = (date.today() + timedelta(days=3)).isoformat()
day2 = (date.today() + timedelta(days=4)).isoformat()

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def page(**kw):
        pg = b.new_context(locale="en-US", **kw).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    o = page(**PHONE)
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Soup kitchen")
    o.fill("#place", "Hall")
    rows = o.locator("#rows .erow")
    for i, (text, d) in enumerate([("Cooking", day1), ("Serving", day2)]):
        r = rows.nth(i)
        r.locator("input.text").fill(text)
        if r.locator("input[name=date]").is_hidden():
            r.locator("button[aria-label='Day and time']").click()
        r.locator("input[name=date]").fill(d)
        r.locator("input[name=start]").fill("10:00")
    rows.nth(2).locator("input.text").fill("Cleaning")
    o.click("#addAsk")
    o.locator("#asks .eask input.text").first.fill("Any allergies?")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    sid = o.input_value("#shareLink").rstrip("/").split("/")[-1]
    key = o.evaluate("JSON.parse(localStorage.getItem('sumate.sheets'))[0].key")
    _, v = call("GET", f"/api/sheets/{sid}")
    call("POST", f"/api/sheets/{sid}/signups", {"row": v["sheet"]["rows"][0]["id"], "name": "Ana", "ans": {v["sheet"]["asks"][0]["id"]: "none"}})
    o.click("#shareClose")
    o.reload()
    o.wait_for_selector("#srows .person")

    # the organizer copies it, a week later
    check(o.locator("#copyBtn").is_visible(), "the organizer has Make a copy")
    o.click("#copyBtn")
    o.wait_for_selector("#edit:not([hidden])")
    check(o.input_value("#title").startswith("Soup kitchen") and o.input_value("#title") != "Soup kitchen", "the copy gets its own title")  # pinned: the title the test typed
    check(o.locator("#rows .erow").count() == 3 and o.input_value("#place") == "Hall", "same lines and place")  # pinned: what the test typed
    check(o.locator("#asks .eask").count() == 1, "same questions")
    check(o.locator("#shiftWrap").is_visible(), "the days can move at once")
    o.select_option("#shiftSel", "7")
    want = [(date.fromisoformat(day1) + timedelta(days=7)).isoformat(), (date.fromisoformat(day2) + timedelta(days=7)).isoformat()]
    got = [o.locator("#rows .erow").nth(i).locator("input[name=date]").input_value() for i in range(2)]
    check(got == want, f"a week later ({got})")
    o.select_option("#shiftSel", "0")
    o.select_option("#shiftSel", "7")
    got = [o.locator("#rows .erow").nth(i).locator("input[name=date]").input_value() for i in range(2)]
    check(got == want, "changing your mind doesn't move them twice")
    check(o.evaluate("document.documentElement.scrollWidth <= innerWidth"), "the editor still fits a small phone")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    cid = o.input_value("#shareLink").rstrip("/").split("/")[-1]
    ckey = o.evaluate(f"JSON.parse(localStorage.getItem('sumate.sheets')).find(s => s.id === '{cid}')?.key")
    check(cid != sid and bool(ckey), "the copy is a new sheet of its own, and hers to edit")

    _, c = call("GET", f"/api/sheets/{cid}")
    _, v = call("GET", f"/api/sheets/{sid}")
    check(c["entries"] == [], "nobody is signed up on the copy")  # pinned: copies start empty, like SignUpGenius
    check([r["text"] for r in c["sheet"]["rows"]] == ["Cooking", "Serving", "Cleaning"]
          and [r.get("date") for r in c["sheet"]["rows"][:2]] == want and c["sheet"]["rows"][0].get("start") == "10:00",
          "the server has the lines, a week later, same times")
    check(not set(r["id"] for r in c["sheet"]["rows"]) & set(r["id"] for r in v["sheet"]["rows"]), "lines of its own")
    check(len(v["entries"]) == 1 and [r.get("date") for r in v["sheet"]["rows"][:2]] == [day1, day2], "the original is untouched")

    # someone who isn't the organizer has no copy button
    ana = page(**PHONE)
    ana.goto(f"{SITE}/s/{sid}")
    ana.wait_for_selector("#srows .srow")
    check(ana.locator("#copyBtn").is_hidden(), "only the organizer can copy")

    call("DELETE", f"/api/sheets/{sid}", headers={"X-Sheet-Key": key})
    call("DELETE", f"/api/sheets/{cid}", headers={"X-Sheet-Key": ckey})
    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
