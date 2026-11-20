# Changing a sign-up (like SignUpGenius' Edit / Swap next to your sign-up: "Swap – Switch your spot with another
# available slot", and the organizer's Move Selected, where "their original information carries over"): ✎ on your
# chip opens your sign-up to change the name, note, answers, how many, or the line, onto one with room; the organizer
# changes anyone's, and moves someone onto a full line by trading places with a person there.
#   python worker/swap_test.py [site] [shots-folder]   (local: cd worker && npx wrangler dev --port 8790)
import os
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else ""
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        pg.screenshot(path=os.path.join(SHOTS, name))


API = """async ([path, method, body, headers]) => {
  const r = await fetch(path, {method, headers: {'Content-Type': 'application/json', ...(headers || {})}, body: body ? JSON.stringify(body) : undefined});
  return [r.status, await r.json()]; }"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge")

    def page(locale="en-US"):
        pg = b.new_context(locale=locale, **PHONE).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    def card(pg, i):
        return pg.locator("#srows .srow").nth(i)

    o = page()
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Park cleanup")
    o.locator("#rows input.text").nth(0).fill("Kitchen")
    for i, (text, extra) in enumerate([("Garden", 1), ("Garage", 0)], start=1):
        o.click("#addRow")
        o.locator("#rows input.text").nth(i).fill(text)
        for _ in range(extra):
            o.locator("#rows .erow").nth(i).locator(".need button").nth(1).click()
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    sid = link.rstrip("/").split("/s/")[1][:10]
    o.click("#shareClose")
    rows = o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, None])[1]["sheet"]["rows"]
    kitchen, garden, garage = (r["id"] for r in rows)
    check([r["need"] for r in rows] == [1, 2, 1], f"lines need 1, 2, 1 ({[r['need'] for r in rows]})")

    # Ana signs up for the kitchen, then moves herself to the garden with a new note
    ana = page()
    ana.goto(link)
    card(ana, 0).locator(".join").click()
    ana.fill("#signName", "Ana")
    ana.fill("#signNote", "gloves")
    ana.click("#signForm .btn.primary")
    ana.wait_for_selector("#srows .person.me", timeout=15000)
    check(ana.locator("#srows .person.me .ed").count() == 1, "her chip has a change button")
    ana.click("#srows .person.me .ed")
    check(ana.is_visible("#signMove") and ana.input_value("#signLine") == kitchen, "the box shows the line she is on")
    check(ana.input_value("#signName") == "Ana" and ana.input_value("#signNote") == "gloves", "and what she wrote")
    ana.select_option("#signLine", garden)
    ana.fill("#signNote", "rake")
    shot(ana, "swap-1-change-box.png")
    ana.click("#signForm .btn.primary")
    ana.wait_for_function(f"document.querySelectorAll('#srows .srow')[1].querySelector('.person.me')", timeout=15000)
    check(card(ana, 0).locator(".person").count() == 0, "the kitchen is free again")
    check("rake" in card(ana, 1).locator(".person.me").inner_text(), "her new note went along")
    v = o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, None])[1]
    check([(e["name"], e["row"]) for e in v["entries"]] == [("Ana", garden)], "the server has one sign-up, on the garden")
    shot(ana, "swap-2-moved.png")

    # Beto takes the kitchen; Ana can't move onto it (full) and Beto can't change Ana's
    beto = page()
    beto.goto(link)
    card(beto, 0).locator(".join").click()
    beto.fill("#signName", "Beto")
    beto.click("#signForm .btn.primary")
    beto.wait_for_selector("#srows .person.me", timeout=15000)
    check(beto.locator("#srows .ed").count() == 1, "Beto can change only his own sign-up")
    ana.reload()
    ana.wait_for_selector("#srows .person.me")
    ana.click("#srows .person.me .ed")
    dis = ana.evaluate(f"document.querySelector('#signLine option[value=\"{kitchen}\"]').disabled")
    check(dis, "a full line can't be picked")  # pinned: a person moves only onto room
    ana.click("#signCancel")
    tok_a = ana.evaluate("localStorage['sumate.token']")
    tok_b = beto.evaluate("localStorage['sumate.token']")
    aid = next(e["id"] for e in v["entries"] if e["name"] == "Ana")
    bid = o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, None])[1]["entries"][1]["id"]
    st = beto.evaluate(API, [f"/api/sheets/{sid}/signups/{aid}", "POST", {"note": "x"}, {"X-Sign-Tokens": tok_b}])
    check(st[0] == 403 and st[1].get("error") == "not yours", f"the server refuses someone else's change ({st[0]} {st[1].get('error')})")  # pinned: error code the app maps
    st = ana.evaluate(API, [f"/api/sheets/{sid}/signups/{aid}", "POST", {"row": kitchen}, {"X-Sign-Tokens": tok_a}])
    check(st[0] == 409 and st[1].get("error") == "full", f"and a move onto a full line ({st[0]} {st[1].get('error')})")  # pinned
    st = ana.evaluate(API, [f"/api/sheets/{sid}/signups/{aid}", "POST", {"row": kitchen, "with": bid}, {"X-Sign-Tokens": tok_a}])
    check(st[0] == 403, f"trading places is the organizer's ({st[0]})")  # pinned

    # the organizer: a change button on everyone; moves Beto to the garage, then trades him with Ana onto the full garden
    o.reload()
    o.wait_for_selector("#srows .person")
    check(o.locator("#srows .ed").count() == 2, "the organizer can change anyone's")
    card(o, 0).locator(".ed").click()
    check("Beto" in o.inner_text("#signRow"), f"the box says whose ({o.inner_text('#signRow')!r})")
    o.select_option("#signLine", garage)
    o.click("#signForm .btn.primary")
    o.wait_for_function("document.querySelectorAll('#srows .srow')[2].querySelector('.person')", timeout=15000)
    check(card(o, 0).locator(".person").count() == 0, "Beto left the kitchen for the garage")
    st = o.evaluate(API, [f"/api/sheets/{sid}/signups", "POST", {"row": garden, "name": "Cara", "token": "c" * 20}, None])
    check(st[0] == 200, "Cara fills the garden (2 of 2)")
    o.reload()
    o.wait_for_selector("#srows .person")
    card(o, 2).locator(".ed").click()
    o.select_option("#signLine", garden)
    check(o.is_visible("#signWith"), "onto the full garden the organizer picks someone to trade places with")
    o.select_option("#signWith", aid)
    shot(o, "swap-3-trade.png")
    o.click("#signForm .btn.primary")
    o.wait_for_function("document.querySelectorAll('#srows .srow')[2].innerText.includes('Ana')", timeout=15000)
    got = {e["name"]: e["row"] for e in o.evaluate(API, [f"/api/sheets/{sid}", "GET", None, None])[1]["entries"]}
    check(got == {"Ana": garage, "Beto": garden, "Cara": garden}, f"Ana and Beto traded places ({got})")
    shot(o, "swap-4-traded.png")

    # what must stay true on the server
    r = o.evaluate("""async () => {
      const post = (u, b, h) => fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json', ...(h || {})}, body: JSON.stringify(b)}).then(r => r.json().then(j => [r.status, j]));
      const put = (u, b, h) => fetch(u, {method: 'PUT', headers: {'Content-Type': 'application/json', ...(h || {})}, body: JSON.stringify(b)}).then(r => r.json());
      const out = {};
      const [, m] = await post('/api/sheets', {title: 'Rules', wait: true, per: 1, final: true, selfIn: true,
        asks: [{text: 'Shirt size', req: true, opts: ['S', 'M']}], rows: [{text: 'A', need: 1}, {text: 'B', need: 1}, {text: 'C', need: 1}]});
      const own = {'X-Sheet-Key': m.key};
      const view = await (await fetch('/api/sheets/' + m.id)).json();
      const [a, bb, c] = view.sheet.rows.map((x) => x.id);
      const T = {'X-Sign-Tokens': 't'.repeat(20)};
      const e1 = (await post('/api/sheets/' + m.id + '/signups', {row: a, name: 'P', token: 't'.repeat(20), ans: {[view.sheet.asks[0].id]: 'S'}}, null))[1].view.entries[0].id;
      await post('/api/sheets/' + m.id + '/signups', {row: bb, name: 'Q', token: 'q'.repeat(20), ans: {[view.sheet.asks[0].id]: 'M'}}, null);
      out.limit = (await post('/api/sheets/' + m.id + '/signups/' + e1, {row: c}, T))[0]; // one per person: moving isn't a second one
      out.ansKept = (await (await fetch('/api/sheets/' + m.id, {headers: T})).json()).entries.find((x) => x.id === e1).ans;
      out.noAnswer = (await post('/api/sheets/' + m.id + '/signups/' + e1, {ans: {}}, T))[1].error;
      out.wait = (await post('/api/sheets/' + m.id + '/signups/' + e1, {row: bb}, T))[1].error; // no moving onto a waiting list
      await post('/api/sheets/' + m.id + '/signups/' + e1 + '/here', {on: true}, own);
      await post('/api/sheets/' + m.id + '/signups/' + e1, {row: a}, own);
      out.hereAfterMove = (await (await fetch('/api/sheets/' + m.id, {headers: own})).json()).entries.find((x) => x.id === e1).here || 0;
      await put('/api/sheets/' + m.id, {...view.sheet, open: false}, own);
      out.closed = (await post('/api/sheets/' + m.id + '/signups/' + e1, {row: c}, T))[1].error;
      out.ownerClosed = (await post('/api/sheets/' + m.id + '/signups/' + e1, {row: c}, own))[0];
      await fetch('/api/sheets/' + m.id, {method: 'DELETE', headers: own});
      return out; }""")
    check(r["limit"] == 200, f"one per person: moving your one sign-up isn't taking a second ({r['limit']})")  # pinned
    check(bool(r["ansKept"]), "answers stay with a moved sign-up")
    check(r["noAnswer"] == "answer", f"a required question stays required on a change ({r['noAnswer']})")  # pinned
    check(r["wait"] == "full", f"a change never puts someone on a waiting list ({r['wait']})")  # pinned
    check(r["hereAfterMove"] == 0, "a check-in is for the line: moving clears it")  # pinned
    check(r["closed"] == "final", f"a final, closed sheet: people can't change their spot ({r['closed']})")  # pinned
    check(r["ownerClosed"] == 200, "the organizer still can")

    # Spanish
    es = page("es-AR")
    es.goto(link)
    es.wait_for_selector("#srows .person")
    es.evaluate(f"localStorage['sumate.token'] = {tok_a!r}")
    es.reload()
    es.wait_for_selector("#srows .person.me .ed")
    check(es.get_attribute("#srows .person.me .ed", "title") not in ("", "Change my sign-up"), "in Spanish too")

    b.close()

print("FAILED: " + "; ".join(errors) if errors else "all ok")
sys.exit(1 if errors else 0)
