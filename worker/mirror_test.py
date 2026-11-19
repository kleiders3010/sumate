# The second copy of the site (GitHub Pages, https://kleiders3010.github.io/sumate/), for when signup.jurisgames.com
# is down: it works on its own under /sumate/, and its sheets are the same sheets as on the main site.
#   local: python worker/mirror_test.py   (builds the copy with tools/mirror.mjs and serves it the way GitHub Pages
#          does: files, "privacy" -> privacy.html, anything else -> 404.html; sheets on two kinetic/server.mjs;
#          the main site from wrangler dev on 8790)
#   live:  python worker/mirror_test.py https://kleiders3010.github.io/sumate/ https://signup.jurisgames.com
import functools
import http.server
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

from playwright.sync_api import sync_playwright

LIVE = len(sys.argv) > 1 and sys.argv[1].startswith("https://")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIRROR = sys.argv[1] if LIVE else "http://127.0.0.1:8822/sumate/"
MAIN = (sys.argv[2] if len(sys.argv) > 2 else "https://signup.jurisgames.com") if LIVE else "http://127.0.0.1:8790"
PORTS = [8775, 8776]
QS = "" if LIVE else f"?server=http://127.0.0.1:{PORTS[0]}&server2=http://127.0.0.1:{PORTS[1]}"
errors = []
procs = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256


class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) and os.path.exists(path + ".html"):
            self.path = self.path.split("?")[0] + ".html"
        elif not os.path.exists(path):
            f = open(os.path.join(self.directory, "sumate", "404.html"), "rb")
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            return f
        return super().send_head()


if not LIVE:
    site = os.path.join(tempfile.gettempdir(), "sumate_mirror_test")
    subprocess.run(["node", os.path.join(ROOT, "tools", "mirror.mjs"), os.path.join(site, "sumate"), "/sumate/"], check=True)
    srv = Server(("127.0.0.1", 8822), functools.partial(Pages, directory=site))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    kin = os.path.join(ROOT, "kinetic")
    subprocess.run(["node", "pack.mjs"], cwd=kin, check=True, stdout=subprocess.DEVNULL)
    data = tempfile.mkdtemp(prefix="sumate_mt_")
    for i in range(2):
        env = dict(os.environ, PORT=str(PORTS[i]), BIND="127.0.0.1", DATA_DIR=os.path.join(data, str(i)),
                   PEER=f"http://127.0.0.1:{PORTS[1 - i]}", SYNC_KEY="mirror-test-key-0123456789")
        procs.append(subprocess.Popen(["node", "server.mjs"], cwd=kin, env=env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, creationflags=0x08000000))
    for port in PORTS:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel="msedge")

        def page():
            pg = b.new_context(locale="en-US").new_page()
            pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            missing = []
            pg.on("response", lambda r: missing.append(r.url) if r.status == 404 and r.request.resource_type not in ("document", "fetch") else None)
            pg.missing = missing
            return pg

        o = page()
        o.goto(MIRROR + QS)
        o.wait_for_selector("#makeBtn")
        check(o.is_visible("#makeBtn"), "the copy's start page opens")
        o.click("#makeBtn")
        o.wait_for_url(lambda u: "/sumate/new" in u)
        rows = o.locator("#rows input.text")
        rows.nth(0).fill("Cake")
        rows.nth(1).fill("Drinks")
        o.fill("#title", "Mirror check")
        o.click("#saveBtn")
        o.wait_for_selector("#shareBox:not([hidden])", timeout=30000)
        link = o.input_value("#shareLink")
        sid = link.rstrip("/").split("/")[-1]
        check("/sumate/s/" in link and "/sumate/s/" in o.url, f"a sheet is made on the copy; its link stays under /sumate/ ({link})")
        o.click("#shareClose")

        # one person signs up on the copy (the sheet's address is served by 404.html), one on the main site
        a = page()
        a.goto(link + QS)
        a.wait_for_selector("#srows .srow", timeout=30000)
        a.locator("#srows .srow").nth(0).locator(".join").click()
        a.fill("#signName", "Ana")
        a.click("#signForm .btn.primary")
        a.wait_for_selector(".person.me", timeout=30000)
        m = page()
        m.goto(f"{MAIN}/s/{sid}{QS}")
        m.wait_for_selector("#srows .srow", timeout=30000)
        check("Ana" in m.text_content("#srows"), "the same sheet opens on the main site, Ana's name and all")
        m.locator("#srows .srow").nth(1).locator(".join").click()
        m.fill("#signName", "Beto")
        m.click("#signForm .btn.primary")
        m.wait_for_selector(".person.me", timeout=30000)
        o.wait_for_function("document.getElementById('srows').textContent.includes('Beto')", timeout=30000)
        check(True, "Beto signs up on the main site; the organizer's page on the copy shows him")
        pv = o.evaluate("fetch(new URL('privacy', location.origin + '/sumate/').href).then(r => r.status)")
        check(pv == 200, f"the copy's privacy page opens ({pv})")  # pinned: HTTP OK
        check(not o.missing and not a.missing, f"nothing the pages need is missing ({o.missing + a.missing})")
        # clean up (live, the sheet is real): the organizer deletes it from the copy
        o.goto(link + "/edit" + QS)
        o.wait_for_selector("#delSheet:not([hidden])", timeout=30000)
        o.click("#delSheet")
        o.click("#delSheet")
        o.wait_for_selector("#home:not([hidden])", timeout=30000)
        check(True, "the organizer deletes it from the copy")
        check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
        b.close()
finally:
    for pr in procs:
        pr.kill()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
