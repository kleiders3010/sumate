# Second-pass audit S2-8: per-sheet codes are made from a new secret of the device's own (sumate.secret), not from the
# old shared code the servers hold. A device from before keeps its sign-ups: on the sheets it already knew, it also
# sends the code made the old way, so it can still remove what it put down; a new sign-up carries only the new code.
#   python worker/secret_test.py [site]   (local: cd worker && npx wrangler dev -c wrangler.test.toml --port 8790)
import json
import sys
import urllib.request
sys.stdout.reconfigure(encoding='utf-8')
from sheettok import sheet_token
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(SITE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "sumate-secret-test", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=["--disable-gpu"])
    st, made = call("POST", "/api/sheets", {"title": "Potluck", "rows": [{"text": "Salad"}, {"text": "Bread"}]})
    sid = made["id"]
    rows = call("GET", f"/api/sheets/{sid}")[1]["sheet"]["rows"]
    old = "o" * 20  # the device's old code (sumate.token)
    # a sign-up made on 21-22 Nov: its code was made from the old code
    call("POST", f"/api/sheets/{sid}/signups", {"row": rows[0]["id"], "name": "Ana", "token": sheet_token(old, sid)})
    pg = b.new_context().new_page()
    pg.goto(SITE + "/")
    # the device as it was before this change: the old code, the sheet known (t2: made after 21 Nov), no new secret yet
    pg.evaluate("([old, sid]) => { localStorage.clear(); localStorage['sumate.token'] = old; localStorage['sumate.sheets'] = JSON.stringify([{ id: sid, t2: 1, title: 'Potluck' }]); }", [old, sid])
    pg.goto(f"{SITE}/s/{sid}")
    pg.wait_for_selector("#srows .person")
    secret = pg.evaluate("localStorage['sumate.secret']")
    check(isinstance(secret, str) and len(secret) == 24 and secret != old, "the device made a new secret of its own")  # pinned: S2-8
    check(pg.evaluate("JSON.parse(localStorage['sumate.sheets'])[0].lg") == 1, "the sheet it knew is marked to send the old-way code too")
    check(pg.locator("#srows .person.me").count() == 1, "Ana's sign-up from before is still hers")  # pinned: S2-8, sign-ups stay theirs
    # a new sign-up from this device carries only the new code: that code alone owns it and nothing from before
    call("POST", f"/api/sheets/{sid}/signups", {"row": rows[1]["id"], "name": "Ana 2", "token": sheet_token(secret, sid)})
    v = call("GET", f"/api/sheets/{sid}", headers={"X-Sign-Tokens": sheet_token(secret, sid)})[1]
    mine = sorted(e["name"] for e in v["entries"] if e.get("mine"))
    check(mine == ["Ana 2"], f"the new code alone owns only the new sign-up ({mine})")
    # what the old code lets whoever reads the servers work out owns only the sign-up from before
    v = call("GET", f"/api/sheets/{sid}", headers={"X-Sign-Tokens": sheet_token(old, sid)})[1]
    mine = sorted(e["name"] for e in v["entries"] if e.get("mine"))
    check(mine == ["Ana"], f"the old-way code owns only the old sign-up ({mine})")
    b.close()

print("FAILED:\n" + "\n".join(errors) if errors else "ALL OK")
sys.exit(1 if errors else 0)
