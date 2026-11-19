# Sumate: free sign-up sheets

Who brings what, turns, shifts, volunteers: make a list of what you need, share one link (or a QR code), and
people add their name to a free spot. No account for anyone, no ads, no limits, open source. English and Spanish.

**Use it:** https://signup.jurisgames.com · **Android app:** [Google Play](https://play.google.com/store/apps/details?id=com.jurisgames.sumate) · [Privacy](https://signup.jurisgames.com/privacy)

- One line per thing or time slot, with how many people it needs (or any number). Headings group lines by day
  or kind.
- A line can have a day and a start and end time, and "+ Add time slots" makes a run of them at once (from, to, every
  so many minutes). The sheet can say where. Someone in another time zone sees "Buenos Aires time" next to the time.
- After signing up for a line with a day: "Add to my calendar" (Google Calendar, Outlook.com, or an .ics file for
  Apple Calendar, Outlook and the rest), at the right moment wherever you are.
- People sign up with their name and an optional note ("vegan lasagna") and can remove themselves later.
- The organizer can ask up to 5 questions of their own on signing up (a written answer or one of a few choices,
  required or not). Only the organizer (and each person, their own) sees the answers; the download has a column per question.
- The organizer can edit, remove anyone, close the sheet, show names only to themselves, and download the list
  as a spreadsheet (CSV). Editing works from any device with the organizer link.
- The page updates by itself, and the server refuses a spot that was just taken.
- Send feedback (start page and every sheet): a problem or an idea, an optional email for an answer and, if you keep the tick, technical details (browser, page, errors; never the sheet or names). "See what's sent" shows it all first. Emailed to hello@jurisgames.com through [jurisgames-feedback](https://github.com/kleiders3010/jurisgames-feedback), which stores nothing.

## How it works
A small Cloudflare Worker (`worker/`) serves the web app (`web/`, plain HTML/CSS/JS, no build step) and keeps
each sheet in its own Durable Object. A sheet nobody changes for 90 days is deleted automatically.

**Two servers.** Every sheet is also kept on a second server, `kinetic/server.mjs`, which runs the very same Worker
and Sheet code on Node (on the game host at games.jurisgames.com/sumate). Either one takes sign-ups and edits; after
each change a server sends its copy to the other (`POST /api/sync/<id>`, with a key both share: `SYNC_KEY`, a Worker
secret, and `DATA_DIR/sync-key` on the game host), which merges it and answers with the result. Merging never loses a
sign-up (they add up by id, removed ones are remembered), the sheet's text is the one edited last, and a deleted sheet
stays deleted. A server that can't reach the other tries again (every 15 s up to every 5 minutes); a server asked for
a sheet it doesn't have asks the other one. The app asks the other server when one doesn't answer, and with no server
at all shows the device's last copy of the sheet, read only.

**A copy of the site** is published on GitHub Pages (https://kleiders3010.github.io/sumate/, by
`.github/workflows/pages.yml` with `tools/mirror.mjs`), for when signup.jurisgames.com is down; it uses the same two
servers.

## Run locally
    cd worker && npx wrangler dev --port 8790
    # open http://127.0.0.1:8790
    node test.mjs              # checks on what the server accepts
    node cal_test.mjs          # days, times and time zones; the .ics file and calendar links
    python calendar_test.py    # time slots and Add to my calendar, organizer and someone in another zone
    python questions_test.py   # the organizer's own questions
    python e2e.py [base-url]   # whole flow in a headless browser (playwright)
    python failover_test.py    # two sheet servers (kinetic/server.mjs) killed in turn, the device copy
    python mirror_test.py      # the GitHub Pages copy, built and served locally (live: mirror_test.py <pages url> <site>)
    python live_test.py        # the live site: copies both ways, the app through the second server

License: Apache-2.0. QR codes: qrcode-generator by Kazuhiko Arase (MIT, `web/vendor/qrcode.js`).
