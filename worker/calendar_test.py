# A day and time on lines, and "Add to my calendar" (like SignUpGenius' dates/times, "Add Time Slots", and the Google /
# Outlook / iCal buttons after signing up). The organizer is in Buenos Aires; Ana, on a small phone, is in Madrid: she
# sees the times as written with "Buenos Aires time", and her calendar gets the right moment.
#   python worker/calendar_test.py [site]   (local: cd worker && npx wrangler dev -c wrangler.test.toml --port 8790)
import csv
import io
import sys
from urllib.parse import unquote_plus as unquote
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
    b = p.chromium.launch(headless=True, channel="msedge", args=["--disable-gpu"])

    def page(tz, **kw):
        pg = b.new_context(locale="en-US", timezone_id=tz, accept_downloads=True, **kw).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    # the organizer, in Buenos Aires
    o = page("America/Argentina/Buenos_Aires", **PHONE)
    o.goto(SITE + "/")
    o.click("#makeBtn")
    o.fill("#title", "Beach clean-up")
    o.fill("#place", "Costanera Sur")
    first = o.locator("#rows .erow").nth(0)
    first.locator("input.text").fill("Set up tables")
    check(first.locator(".ewhen").is_hidden(), "a line has no day or time unless asked for")
    first.locator(".clock").click()
    first.locator("input[name=date]").fill("2026-12-05")
    first.locator("input[name=start]").fill("08:00")
    first.locator("input[name=end]").fill("09:30")
    o.click("#addSlots")
    o.fill("#genDay", "2026-12-05")
    o.fill("#genFrom", "10:00")
    o.fill("#genTo", "11:00")
    o.select_option("#genEvery", "20")
    o.fill("#genWhat", "Volunteer")
    check(o.inner_text("#genSay").startswith("3"), "the slot maker says how many (10 to 11 every 20 min = 3)")
    o.click("#genAdd")
    check(o.locator("#rows .erow").count() == 4, "three slots added, the empty lines gone")
    wide = o.evaluate("document.documentElement.scrollWidth <= innerWidth")
    check(wide, "the editor fits a small phone")
    o.click("#saveBtn")
    o.wait_for_selector("#shareBox:not([hidden])")
    link = o.input_value("#shareLink")
    o.click("#shareClose")
    check("Costanera Sur" in o.inner_text("#sPlace"), "the sheet says where")
    when0 = o.inner_text("#srows .srow >> nth=0")
    check("Sat, Dec 5 · 8:00 AM – 9:30 AM" in when0 and "time" not in when0.split("\n")[-1].lower().replace("set up tables", ""),
          f"the organizer sees the day and time as written ({when0!r})")
    check("10:20 AM – 10:40 AM" in o.inner_text("#srows .srow >> nth=2"), "each slot has its own time")
    check(o.locator("#srows .cal").count() == 0, "no calendar button before signing up")

    # Ana, in Madrid, on a small phone
    ana = page("Europe/Madrid", **PHONE)
    ana.goto(link)
    card = ana.locator("#srows .srow").nth(1)
    check("10:00 AM – 10:20 AM · Buenos Aires time" in card.inner_text(), f"someone elsewhere is told whose time it is ({card.inner_text()!r})")
    card.locator(".join").click()
    ana.fill("#signName", "Ana")
    ana.click("#signForm .btn.primary")
    ana.wait_for_selector("#calBox:not([hidden])", timeout=15000)
    check(ana.inner_text("#calWhat") == "Volunteer",  # the line she typed in the slot maker
          "after signing up: straight to the calendar buttons")
    inview = ana.evaluate("""() => ['#calGoogle', '#calOutlook', '#calIcs', '#calClose'].map(s => {
      const e = document.querySelector(s); e.scrollIntoView({block: 'nearest'}); const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; })""")
    check(all(inview), f"on a small phone every calendar button can be reached ({inview})")
    g = unquote(ana.get_attribute("#calGoogle", "href"))
    check("dates=20261205T130000Z/20261205T132000Z" in g and "Costanera Sur" in g and link in g, "Google Calendar gets the right moment, the place and the link")
    ol = unquote(ana.get_attribute("#calOutlook", "href"))
    check("startdt=2026-12-05T13:00:00.000Z" in ol, "and Outlook.com")
    with ana.expect_download() as dl:
        ana.click("#calIcs")
    ics = open(dl.value.path(), encoding="utf-8", newline="").read()
    check("DTSTART:20261205T130000Z\r\nDTEND:20261205T132000Z" in ics and "LOCATION:Costanera Sur" in ics and dl.value.suggested_filename.endswith(".ics"),
          "the .ics file has the right moment and place")
    check("TRIGGER:-P1D\r\n" in ics, "with a reminder a day before, unless she picks otherwise")  # pinned: default reminder 1 day before
    ana.select_option("#calRemind", "h1")
    with ana.expect_download() as dl:
        ana.click("#calIcs")
    ics = open(dl.value.path(), encoding="utf-8", newline="").read()
    check("TRIGGER:-PT1H\r\n" in ics, "she can pick an hour before")
    check(ana.evaluate("document.documentElement.scrollWidth <= innerWidth"), "the calendar box still fits a small phone")
    ana.click("#calClose")
    check(ana.locator("#srows .cal").count() == 1 and ana.locator("#srows .srow").nth(1).locator(".cal").count() == 1,
          "later: Add to my calendar on her own line only")
    ana.locator("#srows .srow").nth(1).locator(".cal").click()
    check(ana.input_value("#calRemind") == "h1", "her reminder choice is remembered")
    ana.click("#calClose")

    # the organizer's list
    o.reload()
    o.wait_for_selector("#srows .person", timeout=15000)
    with o.expect_download() as dl:
        o.click("#csvBtn")
    rows = list(csv.reader(io.StringIO(open(dl.value.path(), encoding="utf-8-sig").read())))
    a = next(x for x in rows if x[1] == "Ana")
    check(rows[0][4:6] == ["Day", "Time"] and a[4:6] == ["2026-12-05", "10:00-10:20"], f"the list has the day and time ({rows})")

    # editing keeps them
    o.click("#editBtn")
    o.wait_for_selector("#rows .erow")
    r0 = o.locator("#rows .erow").nth(0)
    check(r0.locator(".ewhen").is_visible() and r0.locator("input[name=start]").input_value() == "08:00"
          and o.input_value("#place") == "Costanera Sur", "the editor shows them again")
    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
