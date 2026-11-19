# A waiting list for full lines (like SignUpGenius' waitlists): with the organizer's switch on, a full line offers
# "Join the waiting list"; people wait in the order they signed up; when someone leaves, the first one waiting is in by
# itself and is told so on their page; everyone else moves up; a bigger number moves people in too; the download says
# who is waiting. Without the switch a full line still refuses.
#   python worker/waitlist_test.py [site]   (local: cd worker && npx wrangler dev --port 8790)
import csv
import io
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def page():
        pg = b.new_context(locale="en-US", accept_downloads=True, **PHONE).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    o = page()
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Pottery class")
    o.locator("#rows input.text").nth(0).fill("Saturday class")  # room for 1 (the default)
    check(not o.is_checked("#waitSw"), "a new sheet has no waiting list")  # pinned: off unless the organizer turns it on
    o.check("#waitSw")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    sid = link.rstrip("/").split("/s/")[1][:10]
    o.click("#shareClose")

    def join(pg, name):
        pg.goto(link)
        pg.click("#srows .srow .join")
        pg.fill("#signName", name)
        pg.click("#signForm .btn.primary")
        pg.wait_for_selector("#srows .person.me", timeout=15000)

    ana = page()
    join(ana, "Ana")
    check(ana.locator("#srows .srow.full .join.wait").count() == 1,
          "a full line offers the waiting list")
    beto = page()
    beto.goto(link)
    beto.click("#srows .srow .join")
    check(beto.is_visible("#signWait"), "the box says it is the waiting list")
    beto.fill("#signName", "Beto")
    beto.click("#signForm .btn.primary")
    beto.wait_for_selector(".waiting .person.me", timeout=15000)
    check("number 1" in beto.inner_text("#toast"), f"Beto is told his place ({beto.inner_text('#toast')!r})")
    cara = page()
    cara.goto(link)
    cara.click("#srows .srow .join")
    cara.fill("#signName", "Cara")
    cara.click("#signForm .btn.primary")
    cara.wait_for_selector(".waiting .person.me", timeout=15000)
    w = [x.strip() for x in cara.locator(".waiting .person").all_inner_texts()]
    check(w[0].startswith("1. Beto") and w[1].startswith("2. Cara"), f"they wait in order ({w})")
    check("2" in cara.inner_text("#srows .srow .left"), "the line says how many wait")
    check(cara.evaluate("document.querySelector('#fill').style.width") == "100%" and "3" not in cara.inner_text("#count"), "people waiting don't count as filled spots")

    # Ana leaves: Beto is in by himself, and his open page tells him
    ana.locator("#srows .person.me .x").click()
    ana.wait_for_function("!document.querySelector('#srows .person.me')", timeout=15000)
    beto.wait_for_function("document.querySelector('#toast')?.textContent.includes('A spot opened')", timeout=20000)
    check(beto.locator("#srows .people:not(.waiting) .person.me").count() == 1, "Beto is in by himself, and told so")
    cara.reload()
    cara.wait_for_selector(".waiting .person.me", timeout=15000)
    check(cara.inner_text(".waiting .person.me").strip().startswith("1. Cara"), "Cara moves up to 1")

    # a bigger number lets Cara in too; the download says who waits (before that)
    o.reload()
    o.wait_for_selector(".waiting .person", timeout=15000)
    with o.expect_download() as dl:
        o.click("#csvBtn")
    rows = list(csv.reader(io.StringIO(open(dl.value.path(), encoding="utf-8-sig").read())))
    col = rows[0].index("Waiting list")
    check([r[col] for r in rows[1:]] == ["", "1"], f"the download has a waiting-list column ({rows})")
    o.click("#editBtn")
    o.wait_for_selector("#rows .erow")
    check(o.is_checked("#waitSw"), "the editor keeps the switch")
    o.locator("#rows .erow").nth(0).locator(".need button").nth(1).click()
    o.click("#saveBtn")
    o.wait_for_selector("#srows .srow", timeout=15000)
    cara.reload()
    cara.wait_for_selector("#srows .person.me", timeout=15000)
    check(cara.locator(".waiting").count() == 0 and cara.locator("#srows .srow.full .join.wait").count() == 1, "room for 2: Cara is in, nobody waits")

    # without the switch, the server still refuses a full line
    r = o.evaluate("""async () => {
      const post = (u, b) => fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)}).then(r => r.json().then(j => [r.status, j]));
      const [, made] = await post('/api/sheets', {title: 'No list', rows: [{text: 'One', need: 1}]});
      const row = (await (await fetch('/api/sheets/' + made.id)).json()).sheet.rows[0].id;
      await post('/api/sheets/' + made.id + '/signups', {row, name: 'A'});
      const [st, j] = await post('/api/sheets/' + made.id + '/signups', {row, name: 'B'});
      await fetch('/api/sheets/' + made.id, {method: 'DELETE', headers: {'X-Sheet-Key': made.key}});
      return [st, j.error]; }""")
    check(r == [409, "full"], f"without a waiting list a full line refuses ({r})")

    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
