# Check-in (like SignUpGenius' Participant Check-In: the organizer, or helpers at the door with a check-in link, see
# each spot's "checked in vs. total spots filled", find people by name or spot, check them in, and add walk-ups on
# site; with "Participant Self Check-in" people mark themselves). Here: the organizer's Check-in page, a check-in link
# that can be replaced or turned off, someone who just came (added and checked in at once, extra on a full line), the
# sheet's switch for people to check themselves in from the line's day, who came is not shown to everyone, and the
# download has a Checked in column.
#   python worker/checkin_test.py [site]   (local: cd worker && npx wrangler dev --port 8790)
import csv
import io
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
SHOTS = sys.argv[2] if len(sys.argv) > 2 else ""
errors = []
nums = lambda s: [int(x) for x in __import__("re").findall(r"\d+", s)]


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


API = """async ([path, method, body, headers]) => {
  const r = await fetch(path, {method, headers: {'Content-Type': 'application/json', ...(headers || {})}, body: body ? JSON.stringify(body) : undefined});
  return [r.status, await r.json()]; }"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def page(lang="en-US"):
        pg = b.new_context(locale=lang, accept_downloads=True, **PHONE).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    o = page()
    o.goto(SITE + "/")
    st, made = o.evaluate(API, ["/api/sheets", "POST", {"title": "Food bank Saturday", "wait": True, "showNames": True, "rows": [
        {"text": "Door", "need": 2}, {"text": "Kitchen"}, {"text": "Next year", "date": "2099-06-01"}]}, None])
    sid, key = made["id"], made["key"]
    rows = o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, None])[1]["sheet"]["rows"]
    tok = {n: n[0].lower() * 20 for n in ["Ana", "Beto", "Caro", "Dani", "Eva"]}
    for n, r in [("Ana", 0), ("Beto", 0), ("Caro", 0), ("Dani", 1), ("Eva", 2)]:
        o.evaluate(API, [f"/api/sheets/{sid}/signups", "POST", {"row": rows[r]["id"], "name": n, "token": tok[n]}, None])
    eid = {e["name"]: e["id"] for e in o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, {"X-Sheet-Key": key}])[1]["entries"]}

    # the organizer's Check-in page
    o.goto(f"{SITE}/s/{sid}#k={key}")
    o.wait_for_selector("#srows .srow")
    o.click("#doorBtn")
    o.wait_for_selector("#door:not([hidden]) .dperson")
    check(o.locator(".dperson").count() == 4, f"everyone who is in, not the waiting list ({o.locator('.dperson').count()})")
    check(nums(o.inner_text("#dCount")) == [0, 4], f"the page counts who came ({o.inner_text('#dCount')!r})")
    o.fill("#dSearch", "ána")
    check(o.locator(".dperson").count() == 1 and "Ana" in o.inner_text(".dperson"), "find a name (accents don't matter)")
    o.fill("#dSearch", "kitch")
    check(o.locator(".dperson").count() == 1 and "Dani" in o.inner_text(".dperson"), "find a line: everyone on it")
    o.fill("#dSearch", "zzz")
    check(o.is_visible("#dNone"), "nobody found says so")
    o.fill("#dSearch", "")
    door = o.locator("#drows .srow").nth(0)
    ana = door.locator(".dperson", has_text="Ana")
    ana.locator(".hereBtn").click()
    o.wait_for_selector("#drows .srow >> nth=0 >> .dperson.on")
    check(ana.locator(".hereBtn").get_attribute("aria-pressed") == "true", "Ana is checked in")
    check(nums(door.locator(".left").inner_text()) == [1, 2], f"the line counts who came of who signed up ({door.locator('.left').inner_text()!r})")  # pinned: who came of the spots filled (SignUpGenius)
    check("Here since" in ana.inner_text(), "and since when")
    ana.locator(".hereBtn").click()
    o.wait_for_function("() => !document.querySelector('#drows .dperson.on')")
    check(nums(o.inner_text("#dCount")) == [0, 4], "tapping again undoes it")
    ana.locator(".hereBtn").click()
    o.wait_for_selector("#drows .dperson.on")

    # someone who just came, on the full Door line (waiting list on): added, checked in, extra, nobody pushed out
    door.locator("button", has_text="Someone who just came").click()
    check(o.is_visible("#signDoor") and o.is_hidden("#signWait"), "the box says it adds and checks in (not the waiting list)")
    o.fill("#signName", "Fede")
    o.click("#signForm .btn.primary")
    o.wait_for_selector(".dperson.on >> text=Fede")
    check(nums(door.locator(".left").inner_text()) == [2, 3], f"Fede is in and here ({door.locator('.left').inner_text()!r})")
    v = o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, {"X-Sheet-Key": key}])[1]
    waits = {e["name"]: e.get("wait", 0) for e in v["entries"]}
    check(waits == {"Ana": 0, "Beto": 0, "Caro": 1, "Dani": 0, "Eva": 0, "Fede": 0}, f"nobody pushed onto the waiting list ({waits})")  # pinned: a walk-up on a full line is extra
    check(o.evaluate("localStorage['sumate.name'] || ''") != "Fede", "a walk-up's name isn't kept as this device's")
    if SHOTS:
        o.screenshot(path=f"{SHOTS}/checkin-page.png", full_page=True)

    # who came is not everyone's business
    pub = o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, None])[1]
    check(not any(e.get("here") for e in pub["entries"]), "visitors don't see who came")  # pinned: organizer, helpers and the person only
    st = o.evaluate(API, [f"/api/sheets/{sid}/signups/{eid['Beto']}/here", "POST", {"on": True}, None])
    check(st[0] == 403, f"a visitor can't check anyone in ({st[0]})")
    st = o.evaluate(API, [f"/api/sheets/{sid}/signups/{eid['Beto']}/here", "POST", {"on": True}, {"X-Sign-Tokens": tok["Beto"]}])
    check(st[0] == 403, f"nor themselves while the sheet doesn't let them ({st[0]})")
    st = o.evaluate(API, [f"/api/sheets/{sid}/signups/{eid['Caro']}/here", "POST", {"on": True}, {"X-Sheet-Key": key}])
    check(st[0] == 409 and st[1].get("error") == "waiting", f"the waiting list can't be checked in ({st[0]} {st[1].get('error')})")

    # the check-in link for helpers
    o.click("#doorShare")
    o.wait_for_selector("#shareBox:not([hidden])")
    check(o.is_hidden("#doorLinkOn"), "no check-in link until the organizer makes one")
    o.click("#doorMake")
    o.wait_for_function("() => document.querySelector('#doorLink').value.includes('/door#d=')")
    link1 = o.input_value("#doorLink")
    o.click("#shareClose")
    h = page()
    h.goto(link1)
    h.wait_for_selector("#door:not([hidden]) .dperson")
    check(h.locator(".dperson").count() == 5 and h.is_hidden("#doorShare"), "a helper sees the check-in page (not the link box)")
    check("#d=" not in h.url, "the key leaves the address bar")
    h.locator(".dperson", has_text="Beto").locator(".hereBtn").click()
    h.wait_for_selector(".dperson.on >> text=Beto")
    hv = h.evaluate(API, [f"/api/sheets/{sid}", "GET", None, {"X-Door-Key": link1.split("#d=")[1]}])[1]
    check(hv.get("door") and not hv.get("owner") and all(e.get("ans") is None for e in hv["entries"]), "a helper is not the organizer")
    st = h.evaluate(API, [f"/api/sheets/{sid}/signups/{eid['Dani']}", "DELETE", None, {"X-Door-Key": link1.split("#d=")[1]}])
    check(st[0] == 403, f"a helper can't remove anyone ({st[0]})")
    h.goto(SITE + "/")
    check("Check-in" in h.inner_text("#mine"), "the helper's start page lists it as Check-in")
    o.reload()
    o.wait_for_selector("#door:not([hidden])")
    o.wait_for_selector(".dperson.on >> text=Beto")
    check(nums(o.inner_text("#dCount")) == [3, 5], f"the organizer sees the helper's marks ({o.inner_text('#dCount')!r})")
    # a new link: the old one stops working
    o.click("#doorShare")
    o.click("#doorMake")
    o.wait_for_function(f"() => document.querySelector('#doorLink').value !== {link1!r} && document.querySelector('#doorLink').value.includes('#d=')")
    o.click("#shareClose")
    h.goto(f"{SITE}/s/{sid}/door")
    h.wait_for_selector("#sheet:not([hidden])")
    check(h.locator(".dperson").count() == 0 and h.locator(".hereBtn").count() == 0, "the old link opens the plain sheet")
    st = h.evaluate(API, [f"/api/sheets/{sid}/signups/{eid['Dani']}/here", "POST", {"on": True}, {"X-Door-Key": link1.split("#d=")[1]}])
    check(st[0] == 403, f"and can't check anyone in ({st[0]})")
    o.click("#doorShare")
    o.click("#doorOff")
    o.wait_for_selector("#doorLinkOn[hidden]", state="attached")
    check(o.is_hidden("#doorOff") and not o.input_value("#doorLink"), "turned off")
    o.click("#shareClose")

    # people check themselves in (the sheet's switch), from the line's day
    o.click("#doorBack")
    o.click("#editBtn")
    o.wait_for_selector("#rows .erow")
    check(not o.is_checked("#selfInSw"), "off unless the organizer turns it on")  # pinned: off by default
    o.check("#selfInSw")
    o.click("#saveBtn")
    o.wait_for_selector("#srows .srow")
    d = page("es-AR")
    d.goto(SITE + "/")
    d.evaluate(f"localStorage['sumate.token'] = '{tok['Dani']}'")
    d.goto(f"{SITE}/s/{sid}")
    d.wait_for_selector("#srows .selfIn")
    check(d.get_attribute("#srows .selfIn", "aria-pressed") == "false" and d.evaluate("document.documentElement.lang") == "es", f"Dani gets a button (Spanish page: {d.inner_text('#srows .selfIn')!r})")
    d.click("#srows .selfIn")
    d.wait_for_selector("#srows .selfIn.on")
    check("✓" in d.inner_text("#srows .person.me"), "and her chip has the tick")
    if SHOTS:
        d.screenshot(path=f"{SHOTS}/checkin-self-es.png", full_page=True)
    e = page()
    e.goto(SITE + "/")
    e.evaluate(f"localStorage['sumate.token'] = '{tok['Eva']}'")
    e.goto(f"{SITE}/s/{sid}")
    e.wait_for_selector("#srows .person.me")
    check(e.locator("#srows .selfIn").count() == 0, "Eva's line is next year: no button yet")
    st = e.evaluate(API, [f"/api/sheets/{sid}/signups/{eid['Eva']}/here", "POST", {"on": True}, {"X-Sign-Tokens": tok["Eva"]}])
    check(st[0] == 403 and st[1].get("error") == "notday", f"the server says not before the day ({st[0]} {st[1].get('error')})")
    st = e.evaluate(API, [f"/api/sheets/{sid}/signups/{eid['Ana']}/here", "POST", {"on": False}, {"X-Sign-Tokens": tok["Eva"]}])
    check(st[0] == 403, f"nobody marks someone else ({st[0]})")

    # the download
    o.reload()
    o.wait_for_selector("#srows .srow")
    with o.expect_download() as dl:
        o.click("#csvBtn")
    got = list(csv.reader(io.StringIO(open(dl.value.path(), encoding="utf-8-sig").read())))
    col = got[0].index("Checked in")
    name = got[0].index("Name")
    marked = sorted(r[name] for r in got[1:] if r[col])
    check(marked == ["Ana", "Beto", "Dani", "Fede"], f"the download says who came and when ({marked})")

    o.evaluate(API, [f"/api/sheets/{sid}", "DELETE", None, {"X-Sheet-Key": key}])
    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
