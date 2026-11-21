# Safety round 2 (the Juntos audit, research/safety-audit-2026-11-21/juntos.md in SelfSustainment; its fixes are swept
# into every app), headless Edge. Grows with each fix.
# J15: the test switches in the link (?server=, ?server2=) reach this computer only when the page itself is served from
#      this computer; the shipped pages' CSP has no localhost (the test server adds it).
# Run against the TEST server: npx wrangler dev -c wrangler.test.toml --port 8790, then python safety2_test.py [base-url]
import os
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
LOCAL = re.compile(r"//(localhost|127\.0\.0\.1|\[::1\])[:/]")
SERVER = BASE.replace("http", "http", 1)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# J15, the shipped files: no page lets itself talk to this computer
for f in sorted(os.listdir(WEB)):
    if f.endswith(".html"):
        csp = re.search(r'Content-Security-Policy" content="([^"]*)"', open(os.path.join(WEB, f), encoding="utf-8").read())
        if csp:
            check(not re.search(r"localhost|127\.0\.0\.1|\[::1\]", csp.group(1)), f"J15 {f}: shipped CSP has no localhost")  # pinned: safety round 2 J15

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def tried_from(origin):
        """open a sheet on `origin` with both server switches pointed at this computer and return every address the
        page then tried besides its own files (answered by stand-ins: nothing leaves this PC)"""
        ctx = b.new_context(locale="en-US")
        tried = []

        def http(r):
            u = r.request.url
            if u.startswith(origin + "/") and not u.startswith(origin + "/api/"):
                return r.fulfill(response=r.fetch(url=BASE + u[len(origin):]))  # the page and its files
            tried.append(u)
            r.abort()

        def ws(w):
            tried.append(w.url)
            w.close()
        ctx.route("**/*", http)
        ctx.route_web_socket(re.compile(".*"), ws)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({origin}): {e}"))
        pg.goto(f"{origin}/s/k3j9x2m4q7?server={SERVER}&server2=http://localhost:8790")
        pg.wait_for_timeout(4000)
        ctx.close()
        return tried

    away = tried_from("http://app.test")
    check(away and not any(LOCAL.search(u) for u in away),
          f"J15 a page not on this computer ignores switches pointing at it (tried: {sorted(set(away))[:4]})")  # pinned: safety round 2 J15
    home = tried_from(BASE)
    check(any(LOCAL.search(u) for u in home), f"J15 a page on this computer still takes them (tests rely on it; tried: {sorted(set(home))[:4]})")  # pinned: safety round 2 J15
    b.close()

print("\n" + ("ALL OK" if not errors else f"{len(errors)} FAILED:\n" + "\n".join(errors)))
sys.exit(1 if errors else 0)
