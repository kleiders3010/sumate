# Opened with no connection, the app shows its own page with Try again (the service worker keeps it), never the
# browser's error page (Juntos UX review U-J14, ported). Run: python offline_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=["--disable-gpu"])
    ctx = b.new_context(locale="en-US")
    a = ctx.new_page()
    a.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    a.goto(f"{BASE}/")
    try:
        # polled from here: an async predicate in wait_for_function passed before anything was kept
        for _ in range(40):
            if a.evaluate("async () => (await caches.keys()).includes('sumate-offline-1') && !!(await caches.match(new URL('offline', location.origin).href))"):
                break
            a.wait_for_timeout(500)
        else:
            raise Exception("the offline page was never kept")
        ctx.set_offline(True)
        o = ctx.new_page()
        o.goto(f"{BASE}/", timeout=15000)
        o.wait_for_selector("#retry", timeout=10000)
        if "No connection" not in o.inner_text("body"):
            errors.append("the offline page doesn't say there is no connection")
    except Exception as ex:
        errors.append("no offline page: " + str(ex)[:120])
        print("   cached:", a.evaluate("async () => { const r = await caches.match(new URL('offline', location.origin).href); return r && { status: r.status, redirected: r.redirected, type: r.type, url: r.url } }"), flush=True)
        print("   sw:", a.evaluate("async () => { const g = await navigator.serviceWorker.getRegistration(); return g && { active: !!g.active, state: g.active && g.active.state, scope: g.scope } }"), flush=True)
    b.close()
print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
