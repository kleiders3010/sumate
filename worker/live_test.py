# The live site with its two sheet servers: a change on either one shows on the other, and the app opens a sheet
# and takes a sign-up from the game host's server when Cloudflare can't be reached (here: an address that doesn't
# exist in its place). The test sheet is deleted at the end. Killing servers is worker/failover_test.py (local).
#   python worker/live_test.py [site] [second server]
import json
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "https://signup.jurisgames.com"
SECOND = sys.argv[2] if len(sys.argv) > 2 else "https://games.jurisgames.com/sumate"
S = [SITE, SECOND]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def api(i, path, method="GET", body=None, headers=None):
    req = urllib.request.Request(S[i] + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "sumate-live-test", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def until(f, secs):
    t0 = time.time()
    while time.time() - t0 < secs:
        if f():
            return time.time() - t0
        time.sleep(1)
    return None


def names(i, sid):
    st, v = api(i, f"/api/sheets/{sid}")
    return sorted(e["name"] for e in v["entries"]) if st == 200 else st


st, made = api(0, "/api/sheets", "POST", {"title": "Live check (deleted at the end)", "rows": [{"text": "Cake"}, {"text": "Drinks"}]})
sid, key = made["id"], made["key"]
row = api(0, f"/api/sheets/{sid}")[1]["sheet"]["rows"][0]["id"]
try:
    t = until(lambda: api(1, f"/api/sheets/{sid}")[0] == 200, 20)
    check(t is not None, f"a sheet made on Cloudflare is on the game host too ({sid})")
    api(0, f"/api/sheets/{sid}/signups", "POST", {"row": row, "name": "Ana", "token": "a" * 20})
    t = until(lambda: names(1, sid) == ["Ana"], 30)
    check(t is not None, f"a sign-up on Cloudflare reaches the game host ({t and round(t)} s)")
    api(1, f"/api/sheets/{sid}/signups", "POST", {"row": row, "name": "Beto", "token": "b" * 20})
    t = until(lambda: names(0, sid) == ["Ana", "Beto"], 30)
    check(t is not None, f"a sign-up on the game host reaches Cloudflare ({t and round(t)} s)")

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel="msedge")
        pg = b.new_context(locale="en-US").new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.goto(f"{SITE}/s/{sid}?server=https://down.invalid&server2={SECOND}")
        pg.wait_for_selector("#srows .srow", timeout=30000)
        check("Beto" in pg.text_content("#srows"), "Cloudflare unreachable: the app opens the sheet from the game host")
        pg.locator("#srows .srow").nth(1).locator(".join").click()
        pg.fill("#signName", "Caro")
        pg.click("#signForm .btn.primary")
        pg.wait_for_selector(".person.me", timeout=30000)
        t = until(lambda: names(0, sid) == ["Ana", "Beto", "Caro"], 30)
        check(t is not None, "and takes a sign-up there, which reaches Cloudflare")
        b.close()
finally:
    api(0, f"/api/sheets/{sid}", "DELETE", headers={"X-Sheet-Key": key})
    t = until(lambda: api(1, f"/api/sheets/{sid}")[0] == 404, 30)
    check(t is not None, "deleted on Cloudflare: gone from the game host too")  # pinned: 404 = gone
check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
