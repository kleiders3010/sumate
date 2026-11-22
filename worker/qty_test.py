# More than one spot in a sign-up, and the most one person may take (like SignUpGenius: a participant "can simply
# choose a quantity of 2", and "Quantity Limits for Users", on the whole sign-up or per item): with the organizer's
# switch on, the box asks How many (up to what's left and what that person may still take); the line counts spots;
# the chip says ×2; a person at their limit can't add more (the server refuses it too), the organizer still can; a
# waiting list keeps people in order by their spots; the download has a How many column. Off by default.
#   python worker/qty_test.py [site]   (local: cd worker && npx wrangler dev -c wrangler.test.toml --port 8790)
import csv
import io
import sys
sys.stdout.reconfigure(encoding='utf-8')
from sheettok import sheet_token  # the per-sheet code a device sends (round 3, S5)
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


API = """async ([path, method, body, headers]) => {
  const r = await fetch(path, {method, headers: {'Content-Type': 'application/json', ...(headers || {})}, body: body ? JSON.stringify(body) : undefined});
  return [r.status, await r.json()]; }"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def page():
        pg = b.new_context(locale="en-US", accept_downloads=True, **PHONE).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    o = page()
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Bake sale")
    check(not o.is_checked("#qtySw"), "a new sheet takes one spot per sign-up")  # pinned: off unless the organizer turns it on
    check(o.is_hidden("#limits"), "the per-person limits start folded away")
    o.locator("#rows input.text").nth(0).fill("Cookies (dozen)")
    plus = o.locator("#rows .erow").nth(0).locator(".need button").nth(1)
    for _ in range(5):
        plus.click()  # room for 6
    o.click("#addRow")
    o.locator("#rows input.text").nth(1).fill("Brownies (tray)")
    plus2 = o.locator("#rows .erow").nth(1).locator(".need button").nth(1)
    for _ in range(3):
        plus2.click()  # room for 4
    o.check("#qtySw")
    o.click("#limitsBtn")
    o.select_option("#perSel", "3")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    sid = link.rstrip("/").split("/s/")[1][:10]
    o.click("#shareClose")

    # Ana takes 2 dozen cookies
    ana = page()
    ana.goto(link)
    ana.locator("#srows .srow").nth(0).locator(".join").click()
    check(ana.is_visible("#signQty"), "the box asks how many")
    check(ana.get_attribute("#signQty", "max") == "3", f"up to what one person may take ({ana.get_attribute('#signQty', 'max')})")
    check("3 per person" in ana.inner_text("#signLimit"), f"the box says the limit ({ana.inner_text('#signLimit')!r})")
    ana.fill("#signName", "Ana")
    ana.fill("#signQty", "2")
    ana.click("#signForm .btn.primary")
    ana.wait_for_selector("#srows .person.me", timeout=15000)
    check(ana.inner_text("#srows .person.me .qty") == "×2", "her chip says ×2")
    check(ana.inner_text("#srows .srow >> nth=0 >> .left").startswith("2 of 6"), f"the line counts spots ({ana.inner_text('#srows .srow >> nth=0 >> .left')!r})")
    check("2 of 10" in ana.inner_text("#count"), f"so does the sheet ({ana.inner_text('#count')!r})")

    # one left for her: the box has no How many for one; then she is at her limit
    ana.locator("#srows .srow").nth(1).locator(".join").click()
    check(ana.is_hidden("#signQtyWrap"), "with one left to take, no How many")
    ana.click("#signForm .btn.primary")
    ana.wait_for_function("() => document.querySelectorAll('#srows .person.me').length === 2", timeout=15000)
    cards = ana.locator("#srows .srow")
    check(all(cards.nth(i).locator(".join").count() == 0 and cards.nth(i).locator(".shut").count() == 1 for i in range(2)),
          "at her limit no line offers Sign up, and each says why")
    tok = sheet_token(ana.evaluate("localStorage['sumate.secret']"), sid)
    rows = o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, None])[1]["sheet"]["rows"]
    st = ana.evaluate(API, [f"/api/sheets/{sid}/signups", "POST", {"row": rows[0]["id"], "name": "Ana", "token": tok, "qty": 1}, None])
    check(st[0] == 409 and st[1].get("error") == "limit", f"the server refuses past the limit too ({st[0]} {st[1].get('error')})")  # pinned: the error code the app maps
    st = ana.evaluate(API, [f"/api/sheets/{sid}/signups", "POST", {"row": rows[1]["id"], "name": "Ana", "token": "z" * 20, "qty": 2}, None])
    check(st[0] == 200, "another person (device) has their own limit")  # pinned: a person is one device

    # Beto asks for more than is left
    beto = page()
    beto.goto(link)
    beto.locator("#srows .srow").nth(1).locator(".join").click()
    check(beto.get_attribute("#signQty", "max") == "1" and beto.is_hidden("#signQtyWrap"), "How many goes up to what's left (1)")
    st = beto.evaluate(API, [f"/api/sheets/{sid}/signups", "POST", {"row": rows[1]["id"], "name": "Beto", "qty": 3}, None])
    check(st[0] == 409 and st[1].get("error") == "few", f"more than what's left is refused ({st[0]} {st[1].get('error')})")  # pinned: the error code the app maps
    beto.click("#signCancel")

    # the organizer is not held to the limit
    o.reload()
    o.wait_for_selector("#srows .srow")
    o.locator("#srows .srow").nth(0).locator(".join").click()
    check(o.get_attribute("#signQty", "max") == "4", f"the organizer can add up to what's left ({o.get_attribute('#signQty', 'max')})")
    o.fill("#signName", "Grandma")
    o.fill("#signQty", "4")
    o.click("#signForm .btn.primary")
    o.wait_for_function("() => document.querySelector('#srows .srow')?.classList.contains('full')", timeout=15000)
    check(True, "4 more dozen fill the cookies (2 + 4 = 6)")
    with o.expect_download() as dl:
        o.click("#csvBtn")
    got = list(csv.reader(io.StringIO(open(dl.value.path(), encoding="utf-8-sig").read())))
    col = got[0].index("How many")
    check(sorted(r[col] for r in got[1:]) == ["1", "2", "2", "4"], f"the download says how many ({[r[col] for r in got[1:]]})")
    o.click("#editBtn")
    o.wait_for_selector("#rows .erow")
    check(o.is_checked("#qtySw") and o.input_value("#perSel") == "3" and o.is_visible("#limits"), "the editor keeps the switch and the limit")

    # a waiting list counts spots in order: nobody skips ahead
    r = o.evaluate("""async () => {
      const post = (u, b, h) => fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json', ...(h || {})}, body: JSON.stringify(b)}).then(r => r.json().then(j => [r.status, j]));
      const [, made] = await post('/api/sheets', {title: 'Seats', wait: true, qty: true, rows: [{text: 'Bus', need: 3}]});
      const row = (await (await fetch('/api/sheets/' + made.id)).json()).sheet.rows[0].id;
      const a = (await post('/api/sheets/' + made.id + '/signups', {row, name: 'A', qty: 2, token: 'a'.repeat(20)}))[1];
      await post('/api/sheets/' + made.id + '/signups', {row, name: 'B', qty: 2, token: 'b'.repeat(20)});
      const c = (await post('/api/sheets/' + made.id + '/signups', {row, name: 'C', qty: 1, token: 'c'.repeat(20)}))[1];
      const before = c.view.entries.map(e => [e.name, e.wait || 0]);
      const aid = c.view.entries.find(e => e.name === 'A').id;
      await fetch('/api/sheets/' + made.id + '/signups/' + aid, {method: 'DELETE', headers: {'X-Sign-Tokens': 'a'.repeat(20)}});
      const after = (await (await fetch('/api/sheets/' + made.id)).json()).entries.map(e => [e.name, e.wait || 0]);
      const [, plain] = await post('/api/sheets', {title: 'Plain', rows: [{text: 'One', need: 5}]});
      const prow = (await (await fetch('/api/sheets/' + plain.id)).json()).sheet.rows[0].id;
      const one = (await post('/api/sheets/' + plain.id + '/signups', {row: prow, name: 'P', qty: 4}))[1];
      for (const m of [made, plain]) await fetch('/api/sheets/' + m.id, {method: 'DELETE', headers: {'X-Sheet-Key': m.key}});
      return [before, after, one.view.entries[0].qty || 1]; }""")
    check(r[0] == [["A", 0], ["B", 1], ["C", 2]], f"B (2) waits and C (1) waits behind B, though 1 would fit ({r[0]})")  # pinned: nobody skips the line
    check(r[1] == [["B", 0], ["C", 0]], f"A leaves: both are in (2 + 1 = 3) ({r[1]})")
    check(r[2] == 1, "without the switch a sign-up is one spot, whatever is sent")

    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
