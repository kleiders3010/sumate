# Two sheet servers (Kleider, 2026-11-18: "all parts of the app should work even if one the pieces break down"):
# a sheet keeps taking sign-ups and edits when its server dies, both servers end up with the same sheet when it is
# back, a sheet made while one is down reaches the other, the same sign-up sent to both is one, a deleted sheet stays
# deleted, and with no server at all the device shows its last copy to read (and goes live again by itself).
# Both sheet servers here are kinetic/server.mjs copying to each other (one standing in for Cloudflare), so the test
# can kill and restart them; the page comes from the Worker (wrangler dev).
#   cd worker && npx wrangler dev --port 8790   then   python worker/failover_test.py
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
KIN = os.path.join(HERE, "..", "kinetic")
SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PORTS = [8783, 8784]
DATA = tempfile.mkdtemp(prefix="sumate_fo_")
KEY = "failover-test-key-0123456789"
QS = f"?server=http://127.0.0.1:{PORTS[0]}&server2=http://127.0.0.1:{PORTS[1]}"
errors = []
procs = [None, None]


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def up(i):
    env = dict(os.environ, PORT=str(PORTS[i]), BIND="127.0.0.1", DATA_DIR=os.path.join(DATA, str(i)),
               PEER=f"http://127.0.0.1:{PORTS[1 - i]}", SYNC_KEY=KEY)
    procs[i] = subprocess.Popen(["node", "server.mjs"], cwd=KIN, env=env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, creationflags=0x08000000)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORTS[i]}/api/health", timeout=1)
            return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("server did not start")


def down(i):
    procs[i].kill()  # a crash, not a polite stop
    procs[i].wait()


def api(i, path, method="GET", body=None, headers=None):
    req = urllib.request.Request(f"http://127.0.0.1:{PORTS[i]}{path}", method=method, headers={"Content-Type": "application/json", **(headers or {})},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def names(i, sid):
    st, v = api(i, f"/api/sheets/{sid}")
    return sorted(e["name"] for e in v["entries"]) if st == 200 else st


def until(f, secs, what):
    t0 = time.time()
    while time.time() - t0 < secs:
        if f():
            return time.time() - t0
        time.sleep(0.5)
    return None


subprocess.run(["node", "pack.mjs"], cwd=KIN, check=True, stdout=subprocess.DEVNULL)
up(0)
up(1)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel="msedge")

        def page():
            pg = b.new_context(locale="en-US").new_page()
            pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            return pg

        def sign(pg, row, name):
            pg.locator("#srows .srow").nth(row).locator(".join").click()
            pg.fill("#signName", name)
            pg.click("#signForm .btn.primary")
            pg.wait_for_selector("#signBox", state="hidden", timeout=30000)

        # the organizer makes a sheet: it is kept on the first server, and copied to the second
        o = page()
        o.goto(SITE + "/new" + QS)
        rows = o.locator("#rows input.text")
        rows.nth(0).fill("Cake")
        rows.nth(1).fill("Drinks")
        rows.nth(2).fill("Chairs")
        o.fill("#title", "Picnic")
        o.click("#saveBtn")
        o.wait_for_selector("#shareBox:not([hidden])")
        sid = o.input_value("#shareLink").rstrip("/").split("/")[-1]
        o.click("#shareClose")
        check(api(0, f"/api/sheets/{sid}")[0] == 200, f"a sheet is made on the first server ({sid})")  # pinned: HTTP OK / the title this test typed
        t = until(lambda: api(1, f"/api/sheets/{sid}")[0] == 200, 10, "copied")
        check(t is not None, f"and copied to the second ({t and round(t, 1)} s)")
        ana = page()
        ana.goto(f"{SITE}/s/{sid}{QS}")
        ana.wait_for_selector("#srows .srow")
        sign(ana, 0, "Ana")

        # the first server dies: people go on signing up on the second, the organizer edits there
        down(0)
        beto = page()
        beto.goto(f"{SITE}/s/{sid}{QS}")
        beto.wait_for_selector("#srows .srow", timeout=30000)
        check("Ana" in beto.text_content("#srows"), "the first server dies: someone opening the sheet gets it from the second, Ana's name and all")
        sign(beto, 1, "Beto")
        check("Beto" in beto.text_content("#srows"), "and signs up there")
        o.click("#editBtn")
        o.wait_for_selector("#edit:not([hidden])", timeout=30000)
        o.fill("#title", "Picnic on Sunday")
        o.click("#saveBtn")
        o.wait_for_selector("#sheet:not([hidden])", timeout=30000)
        check(o.text_content("#sTitle") == "Picnic on Sunday", "the organizer edits the sheet there too")  # pinned: HTTP OK / the title this test typed
        t = until(lambda: "Beto" in ana.text_content("#srows") and "Sunday" in ana.text_content("#sTitle"), 30, "ana sees")
        check(t is not None, "Ana's open page shows Beto and the new title (it moved to the second server by itself)")

        # the first comes back: it gets what changed while it was down
        up(0)
        t = until(lambda: names(0, sid) == ["Ana", "Beto"] and api(0, f"/api/sheets/{sid}")[1]["sheet"]["title"] == "Picnic on Sunday", 40, "back")
        check(t is not None, f"the first server comes back and gets Beto and the new title ({t and round(t)} s)")

        # now the second dies: the page goes back to the first
        down(1)
        caro = page()
        caro.goto(f"{SITE}/s/{sid}{QS}")
        caro.wait_for_selector("#srows .srow", timeout=30000)
        sign(caro, 2, "Caro")
        t = until(lambda: "Caro" in ana.text_content("#srows"), 30, "caro")
        check(t is not None, "the second dies later: Caro signs up on the first and Ana sees her")

        # no server at all: the last copy, to read
        down(0)
        ana.reload()
        ana.wait_for_selector("#sheetMsg:not([hidden])", timeout=30000)
        txt = ana.text_content("#srows")
        check(all(n in txt for n in ("Ana", "Beto", "Caro")) and ana.locator(".join").count() == 0 and ana.locator(".person .x").count() == 0,
              "both down: the page shows the copy saved on the device, read only (" + (ana.text_content("#sheetMsg") or "")[:40] + "...)")
        up(0)
        t = until(lambda: ana.locator(".person.me .x").count() > 0 and ana.is_hidden("#sheetMsg"), 30, "live")  # every line is full now: her own "remove me" shows it is live
        check(t is not None, f"a server is back: the page is live again by itself ({t and round(t)} s)")

        # a sheet made while the second is down reaches it when it is back; a server missing a sheet asks the other
        st, made = api(0, "/api/sheets", "POST", {"title": "Made alone", "rows": [{"text": "x"}]})
        up(1)
        st1, _ = api(1, f"/api/sheets/{made['id']}")
        check(st1 == 200, "a sheet made while the second server was down opens there as soon as it is back (it asks the first)")  # pinned: HTTP OK / the title this test typed

        # the same sign-up sent to both servers (no answer from the first, so the app sends it again) is one
        mid = made["id"]
        row = api(0, f"/api/sheets/{mid}")[1]["sheet"]["rows"][0]["id"]
        su = {"id": "dupdupd2", "row": row, "name": "Dani", "token": "d" * 20}
        api(0, f"/api/sheets/{mid}/signups", "POST", su)
        api(1, f"/api/sheets/{mid}/signups", "POST", su)
        time.sleep(3)
        check(names(0, mid) == ["Dani"] and names(1, mid) == ["Dani"], f"the same sign-up sent to both is one ({names(0, mid)}, {names(1, mid)})")

        # a deleted sheet stays deleted on both
        key = made["key"]
        api(1, f"/api/sheets/{made['id']}", "DELETE", headers={"X-Sheet-Key": key})
        t = until(lambda: api(0, f"/api/sheets/{made['id']}")[0] == 404, 10, "deleted")
        check(t is not None, "a sheet deleted on one server is gone from the other too")  # pinned: 404 = gone
        check(api(1, f"/api/sync/{sid}", headers={"X-Sync-Key": "wrong"})[0] == 403, "a copy is only given to the other server (its key)")  # pinned: 403 = not yours
        check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
        b.close()
finally:
    for pr in procs:
        if pr and pr.poll() is None:
            pr.kill()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
