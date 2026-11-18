# Sumate UI spec

Written 2026-11-18 from reference material pulled that morning (kept out of this repo: the images belong to their
makers): SignUpGenius "Sign Ups" page with its sample phone sheet and its "How to Create a Potluck Sign Up" guide
(dated 2026-09-17), the SignUp.com (VolunteerSpot) Play listing (8 screenshots), the SignUpGenius Play listing (8,
turned out to be a payments companion app, not the sheet).

## What the references actually do

- **Participant sheet** (SignUpGenius sample phone): banner image, group name, sheet title, one line "Please review
  the available slots below and click on the button to sign up". A dark date bar ("06/24 Saturday"), a place line,
  a grey time bar ("3:00PM - 5:00PM"), then slot rows: name, "(4)", "Maximum 4 ppl / slot", a green "Sign Up" button
  with a checkbox. Potluck sample: rows "Main Dish / 1 of 4 slots filled" (a pill) with an orange "Sign Up" button.
- **SignUp.com**: list of rows with a round avatar "14/30 Signed Up" or "FULL", the time and "19 Participants"; a
  progress bar "118 / 202 Spots Filled"; "Notify me when a Spot becomes available"; share sheet with six big
  buttons (email, copy link, text, Facebook, Twitter, Remind); "Create New SignUp" wizard in 4 steps (name, welcome
  message, location, theme image).
- **Organizer flow** (SignUpGenius guide): log in, Create, Design tab (title, group with email addresses, category,
  theme), Slots tab (format "sort by date" or "single date RSVP", end date, add slots: title + "number wanted" +
  comment, "Save and add another"), Settings tab (participants must enter their name; email / comments / phone /
  address optional), Share tab. Paid only: hide number wanted, waitlist, custom questions, removing ads and branding.
- Participants need no account in either; organizers do.

## Best of them, for Sumate (Tasklist feel: one screen, type and go)

1. **Home**: one button "Make a sign-up sheet"; under it "Your sheets" (made by you, and ones you signed up on,
   from this device). One line saying what it is: free, no account, no ads.
2. **Editor**, one page, no wizard: title, details (when, where, a note; free text), then the rows. A row is a text
   and how many people it needs (1, 2, 3 ... or "any number"). "Add row" focuses the next empty row (Enter adds one,
   like Tasklist). A row can be a heading instead ("Saturday", "Desserts") for grouping by day or kind. Two
   switches: "Show names to everyone" (on), "Open for sign-ups" (on). Save -> the sheet, with Share open.
3. **Sheet** (what everyone sees): title, details, "12 of 20 spots filled" with a thin bar. Rows grouped under
   headings; each row: text, the names already on it (chips), and one button per free spot "Sign up" (or "Full").
   Tapping "Sign up" opens a small box right there: name (remembered), an optional note ("vegan lasagna"), "Add me".
   Your own entries are highlighted with "Remove". No email, no account.
4. **Organizer** (same page, via the private organizer link): plus Edit, Share (copy link, QR, the phone's share
   sheet), Download (CSV), remove anyone, close or reopen, delete. The organizer link is shown once with "keep this
   link: it is the only way to edit" and kept in "Your sheets" on this device.
5. Updates: the sheet refreshes by itself every few seconds while open, so two people never take the same last spot
   unseen (the server also refuses a full row).
6. Own look: deep teal and warm paper, no stock photos, no themes gallery; English and Spanish (rioplatense vos).
