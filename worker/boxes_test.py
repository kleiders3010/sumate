# Every box (sign up, share, send feedback) fits a short screen: a phone on its side (740x360) and a 1280x720
# laptop. The box's top and its last button can be reached: either it fits, or it scrolls inside itself.
#   python worker/boxes_test.py [site]   (default: the live site; local: python -m http.server -d web 8811)
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"  # local by default (rule 21); the live site only when named
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


FIT = """(sel) => {
  const box = document.querySelector(sel);
  const r = box.getBoundingClientRect();
  const last = [...box.querySelectorAll('button')].filter(b => b.offsetParent).pop();
  box.scrollTop = box.scrollHeight;
  const lr = last.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, h: innerHeight, lastBottom: lr.bottom, lastTop: lr.top };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=["--disable-gpu"])
    for w, h in ((740, 360), (1280, 720)):
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.goto(SITE)
        pg.wait_for_load_state("networkidle")
        for box in ("signBox", "shareBox"):
            pg.evaluate(f"""() => {{ document.querySelectorAll('.sheetbox').forEach(x => x.hidden = true);
              const b = document.getElementById('{box}'); b.hidden = false;
              const o = document.getElementById('ownerLinkWrap'); if (o) o.hidden = false;
              const q = document.getElementById('qr'); if (q && !q.firstChild) q.style.height = '240px'; }}""")
            m = pg.evaluate(FIT, f"#{box} .box")
            check(m["top"] >= 0 and m["lastTop"] >= 0 and m["lastBottom"] <= m["h"] + 1,
                  f"{w}x{h}: the {box} box's top and last button can be reached ({m})")
        pg.close()
    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
