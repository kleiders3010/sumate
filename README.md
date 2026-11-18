# Sumate: free sign-up sheets

Who brings what, turns, shifts, volunteers: make a list of what you need, share one link (or a QR code), and
people add their name to a free spot. No account for anyone, no ads, no limits, open source. English and Spanish.

**Use it:** https://signup.jurisgames.com · **Android app:** [Google Play](https://play.google.com/store/apps/details?id=com.jurisgames.sumate) · [Privacy](https://signup.jurisgames.com/privacy)

- One line per thing or time slot, with how many people it needs (or any number). Headings group lines by day
  or kind.
- People sign up with their name and an optional note ("vegan lasagna") and can remove themselves later.
- The organizer can edit, remove anyone, close the sheet, show names only to themselves, and download the list
  as a spreadsheet (CSV). Editing works from any device with the organizer link.
- The page updates by itself, and the server refuses a spot that was just taken.
- Send feedback (start page and every sheet): a problem or an idea, an optional email for an answer and, if you keep the tick, technical details (browser, page, errors; never the sheet or names). "See what's sent" shows it all first. Emailed to hello@jurisgames.com through [jurisgames-feedback](https://github.com/kleiders3010/jurisgames-feedback), which stores nothing.

## How it works
A small Cloudflare Worker (`worker/`) serves the web app (`web/`, plain HTML/CSS/JS, no build step) and keeps
each sheet in its own Durable Object. A sheet nobody changes for 90 days is deleted automatically.

## Run locally
    cd worker && npx wrangler dev --port 8790
    # open http://127.0.0.1:8790
    node test.mjs              # checks on what the server accepts
    python e2e.py [base-url]   # whole flow in a headless browser (playwright)

License: Apache-2.0. QR codes: qrcode-generator by Kazuhiko Arase (MIT, `web/vendor/qrcode.js`).
