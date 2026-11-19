# The organizer's own questions on signing up (like SignUpGenius' custom questions): a pick-one question that must be
# answered and a written one that may be left empty. A person can't sign up without the required answer; the answers go
# to the organizer (on the sheet and in the downloaded list) and to the person who gave them, never to the others.
#   python worker/questions_test.py [site]   (local: cd worker && npx wrangler dev --port 8790)
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

    def page(**kw):
        pg = b.new_context(locale="en-US", accept_downloads=True, **PHONE, **kw).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    # the organizer
    o = page()
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Beach clean-up")
    o.locator("#rows input.text").nth(0).fill("Morning shift")
    for _ in range(3):
        o.locator("#rows .erow").nth(0).locator(".need button").nth(1).click()  # room for everyone
    check(o.locator("#asks .eask").count() == 0, "a new sheet has no questions")  # pinned: none unless the organizer adds them
    o.click("#addAsk")
    q = o.locator("#asks .eask").nth(0)
    q.locator("input.text").fill("T-shirt size?")
    q.locator("textarea").fill("S\nM\nL")
    q.locator("input[type=checkbox]").check()
    o.click("#addAsk")
    q = o.locator("#asks .eask").nth(1)
    q.locator("input.text").fill("Any allergies?")
    for _ in range(3):
        o.click("#addAsk")
    check(o.is_hidden("#addAsk") and o.locator("#asks .eask").count() == 5, "at most 5 questions")  # pinned: 5
    for _ in range(3):
        o.locator("#asks .eask").nth(2).locator(".x").click()
    check(o.is_visible("#addAsk"), "removing one brings + Add a question back")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    sid = link.rstrip("/").split("/s/")[1][:10]
    o.click("#shareClose")

    # Ana signs up: the size must be picked
    ana = page()
    ana.goto(link)
    ana.click("#srows .srow .join")
    ana.fill("#signName", "Ana")
    check(ana.inner_text("#signAsks").count("(optional)") == 1 and "Any allergies? (optional)" in ana.inner_text("#signAsks"), "the box asks both, the written one optional")
    ana.click("#signForm .btn.primary")
    ana.wait_for_timeout(500)
    check(ana.is_visible("#signBox") and ana.locator("#srows .person").count() == 0, "no sign-up without the required answer")
    inview = ana.evaluate("""() => { const f = document.querySelector('#signForm .btn.primary'); f.scrollIntoView({block: 'nearest'});
      const r = f.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }""")
    check(inview, "on a small phone the Add me button can be reached")
    ana.select_option("#signAsks select", "M")
    ana.fill("#signAsks input", "nuts")
    ana.click("#signForm .btn.primary")
    ana.wait_for_selector("#srows .person.me", timeout=15000)
    check("M · nuts" in ana.inner_text("#srows .person.me"), "Ana sees her own answers")

    # the server says no too
    r = ana.evaluate("""async (id) => { const r = await fetch('/api/sheets/' + id + '/signups', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({row: (await (await fetch('/api/sheets/' + id)).json()).sheet.rows[0].id, name: 'Sly', ans: {}})}); return [r.status, (await r.json()).error]; }""", sid)
    check(r == [400, "answer"], f"the server refuses a sign-up without the required answer ({r})")

    # Beto signs up and doesn't see Ana's answers
    beto = page()
    beto.goto(link)
    beto.click("#srows .srow .join")
    beto.fill("#signName", "Beto")
    beto.select_option("#signAsks select", "L")
    beto.click("#signForm .btn.primary")
    beto.wait_for_selector("#srows .person.me", timeout=15000)
    other = beto.locator("#srows .person:not(.me)").inner_text()
    check("Ana" in other and "M" not in other.replace("Ana", "") and "nuts" not in other, f"Beto sees Ana but not her answers ({other!r})")
    check(beto.evaluate("async (id) => (await (await fetch('/api/sheets/' + id)).json()).entries.every(e => !e.ans || !Object.keys(e.ans).length || e.mine)", sid),
          "and the server never sends them to him")

    # the organizer sees them, on the sheet and in the file
    o.reload()
    o.wait_for_selector("#srows .person >> nth=1", timeout=15000)
    txt = o.inner_text("#srows")
    check("M · nuts" in txt and "L" in txt, "the organizer sees everyone's answers")
    with o.expect_download() as dl:
        o.click("#csvBtn")
    rows = list(csv.reader(io.StringIO(open(dl.value.path(), encoding="utf-8-sig").read())))
    head = rows[0]
    a = next(x for x in rows if x[1] == "Ana")
    bb = next(x for x in rows if x[1] == "Beto")
    check(head[-2:] == ["T-shirt size?", "Any allergies?"] and a[-2:] == ["M", "nuts"] and bb[-2:] == ["L", ""], f"the list has a column per question ({rows})")

    # editing keeps the questions
    o.click("#editBtn")
    o.wait_for_selector("#asks .eask")
    check(o.locator("#asks .eask").count() == 2 and o.input_value("#asks .eask textarea >> nth=0") == "S\nM\nL"
          and o.is_checked("#asks .eask input[type=checkbox] >> nth=0"), "the editor shows the questions again")
    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
