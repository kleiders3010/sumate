# UX review 2026-11-28 (research/ux-review-2026-11-28/sumate.md in SelfSustainment), the high ones + rule 234:
#   U-S1 removing a name has Undo (back in its old place, the one who moved up waits again); ✎ / × are 44 px, 8 px apart;
#   U-S2 Save that removes a line with people on it names them and asks (Keep puts the line back);
#   U-S3 the editor keeps a draft (back after a reload, "Discard them"); Back and browser Back with changes ask;
#   U-S4 after the first Save the organizer link is a step of its own (first in the box, "Send it to myself"), labelled
#        apart from the public link; the owner tools have "Organizer link";
#   U-S5 after signing up: "open this link on this phone"; names without ✎ / × say why;
#   U-S6 a poll with nothing new leaves the list as it is; a poll with news keeps the focus on the same control;
#   234  one-forms (1 slot / 1 anotado) and the sheet fits a 360 dp phone.
#   python worker/ux28_test.py [site]   (local: cd worker && npx wrangler dev -c wrangler.test.toml --port 8790)
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def soft(fn, *a, **k):
    try:
        fn(*a, **k)
        return True
    except Exception:
        return False


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=["--disable-gpu"])

    def page(locale="en-US"):
        pg = b.new_context(locale=locale, **PHONE).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("dialog", lambda d: d.accept())  # the "leave this page?" of a reload with unsaved changes
        return pg

    # the organizer makes a sheet: Salad (1 spot, with a waiting list) and Bread
    o = page()
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Lunch")
    o.locator("#rows input.text").nth(0).fill("Salad")
    o.locator("#rows input.text").nth(1).fill("Bread")
    o.check("#waitSw")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")

    # U-S4 the organizer link first, as its own step, with Send it to myself, labelled apart from the public link
    first = o.evaluate("""() => { const w = document.getElementById('ownerLinkWrap'), q = document.getElementById('qr');
        const f = document.getElementById('ownerFirst');
        return { above: !w.hidden && w.getBoundingClientRect().top < q.getBoundingClientRect().top, step: !!f && !f.hidden,
                 send: !!document.getElementById('sendOwner'), label: document.querySelector('.linkfor')?.textContent || '' }; }""")
    check(first["above"] and first["step"] and first["send"], f"U-S4 after the first Save the organizer link is the first step ({first})")
    check("sign up" in first["label"], f"U-S4 the public link is labelled ({first['label']!r})")
    fit = o.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    check(fit <= 0, f"234 the share box fits 360 dp (over {fit})")
    o.click("#shareClose")
    check(o.locator("#ownerLinkBtn").count() == 1 and o.is_visible("#ownerLinkBtn"), "U-S4 the owner tools have Organizer link")

    def join(pg, name, row=0):
        pg.goto(link)
        pg.locator("#srows .srow .join").nth(row).click()
        pg.fill("#signName", name)
        pg.click("#signForm .btn.primary")
        pg.wait_for_selector("#srows .person.me", timeout=15000)

    # U-S5 after signing up the phone is named
    ana = page()
    join(ana, "Ana")
    said = ana.inner_text("#toast")
    check("on this phone" in said, f"U-S5 after signing up: open this link on this phone ({said!r})")
    beto = page()
    beto.goto(link)
    beto.locator("#srows .srow .join").nth(0).click()
    beto.fill("#signName", "Beto")
    beto.click("#signForm .btn.primary")
    beto.wait_for_selector(".waiting .person.me", timeout=15000)
    check(beto.is_visible("#otherPhone"), "U-S5 names without ✎ / × say why (another phone)")
    fit = beto.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    check(fit <= 0, f"234 the sheet fits 360 dp (over {fit})")

    # U-S1 the buttons on a name
    box = ana.evaluate("""() => { const c = document.querySelector('#srows .person.me'), e = c.querySelector('.ed').getBoundingClientRect(),
        x = c.querySelector('.x').getBoundingClientRect(); return { ew: e.width, eh: e.height, xw: x.width, xh: x.height, gap: x.left - e.right }; }""")
    check(min(box["ew"], box["eh"], box["xw"], box["xh"]) >= 44 and box["gap"] >= 8, f"U-S1 ✎ and × are 44 px, 8 px apart ({box})")  # pinned: rule 44 px / 8 px

    # U-S6 a poll with nothing new leaves the list alone (the 8 s poll comes inside 10 s)
    ana.wait_for_function("() => document.getElementById('srows').textContent.includes('Beto')", timeout=20000)  # caught up first
    ana.evaluate("() => { document.querySelector('#srows .srow').__mark = 1; }")
    ana.wait_for_timeout(10000)
    kept = ana.evaluate("() => document.querySelector('#srows .srow')?.__mark === 1")
    check(kept, "U-S6 a poll with nothing new doesn't draw the list again")
    # a poll with news keeps the focus where it was
    ana.focus("#srows .person.me .ed")
    cara = page()
    join(cara, "Cara", 1)
    ana.wait_for_function("() => document.getElementById('srows').textContent.includes('Cara')", timeout=20000)
    k = ana.evaluate("() => document.activeElement?.dataset?.k || document.activeElement?.tagName")
    check(str(k).startswith("ed:"), f"U-S6 the focus stays on the same ✎ after news ({k!r})")

    # U-S1 × then Undo: Ana is back in her old place, Beto (moved up meanwhile) waits again
    ana.click("#srows .person.me .x")
    has_undo = soft(ana.wait_for_selector, "#toast .toastAct", timeout=5000)
    check(has_undo, "U-S1 removing a name offers Undo")
    if has_undo:
        ana.click("#toast .toastAct")
        back = soft(ana.wait_for_function, """() => document.querySelectorAll('#srows .people:not(.waiting) .person.me').length === 1
            && /^1\\. Beto/.test(document.querySelector('#srows .waiting .person')?.textContent || '')""", timeout=15000)
        check(back, "U-S1 Undo puts Ana back in her place and Beto back on the waiting list")

    # U-S2 removing a line with people on it, then Save: it names them and asks; Keep puts the line back
    o.goto(link + "/edit")
    o.wait_for_selector("#edit:not([hidden])")
    o.evaluate("() => [...document.querySelectorAll('#rows li')].find((li) => li.querySelector('input').value === 'Salad').querySelector('button.x').click()")
    o.click("#saveBtn")
    asked = soft(o.wait_for_selector, "#askBox:not([hidden])", timeout=5000)
    text = o.inner_text("#askText") if asked else ""
    check(asked and "Ana" in text and "Beto" in text, f"U-S2 Save asks, naming who signed up ({text!r})")
    if asked:
        o.click("#askKeep")
        vals = o.evaluate("() => [...document.querySelectorAll('#rows input.text')].map((i) => i.value)")
        check("Salad" in vals and o.is_visible("#edit"), f"U-S2 Keep puts the line back ({vals})")

    # U-S3 Back with changes asks; browser Back too; Leave goes
    o.fill("#title", "Lunch on Sunday")
    o.click("#editBack")
    asked = soft(o.wait_for_selector, "#askBox:not([hidden])", timeout=3000)
    check(asked and "without saving" in o.inner_text("#askText"), "U-S3 Back with changes asks")
    if asked:
        o.click("#askKeep")
        o.go_back()
        asked = soft(o.wait_for_selector, "#askBox:not([hidden])", timeout=3000)
        check(asked and o.is_visible("#edit"), "U-S3 browser Back with changes asks, and the editor stays")
        if asked:
            o.click("#askOther")
            o.wait_for_selector("#sheet:not([hidden])", timeout=10000)
            check(o.inner_text("#sTitle") == "Lunch", "U-S3 Leave goes without saving")  # pinned: the title this test saved
    # a new sheet's draft comes back after a reload; Discard them empties it
    o.goto(SITE + "/new")
    o.wait_for_selector("#edit:not([hidden])")
    o.fill("#title", "Draft test")
    o.locator("#rows input.text").nth(0).fill("Cups")
    o.reload()
    o.wait_for_selector("#edit:not([hidden])")
    t1 = o.input_value("#title")
    check(t1 == "Draft test" and o.is_visible("#draftNote"), f"U-S3 the draft is back after a reload ({t1!r})")  # pinned: the title this test typed
    if o.is_visible("#draftNote"):
        o.click("#draftDrop")
        check(o.input_value("#title") == "" and not o.is_visible("#draftNote"), "U-S3 Discard them empties it")

    # 234 one-forms, both languages
    one = o.evaluate("() => import('/i18n.js').then((m) => [m.t('{n} slots', { n: 1 }), m.t('{n} slots', { n: 2 }), m.t('{n} of {m} spots filled', { n: 0, m: 1 })])")
    check(one == ["1 slot", "2 slots", "0 of 1 spot filled"], f"234 English one-forms ({one})")  # pinned: ONE table
    es = page("es-AR")
    es.goto(SITE + "/")
    one = es.evaluate("() => import('/i18n.js').then((m) => [m.t('{n} signed up', { n: 1 }), m.t('{n} signed up', { n: 3 }), m.t('Removed {n} sign-ups', { n: 1 })])")
    check(one == ["1 anotado", "3 anotados", "Se quitó 1 anotación"], f"234 Spanish one-forms ({one})")  # pinned: es table

    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
