# Play store images for Sumate: phone screenshots (1080x1920) in English and Spanish, and the feature graphic.
# Makes a demo sheet on the live site, photographs it, deletes it. Run: python make_store.py [base-url]
import sys, os, json, base64, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://signup.jurisgames.com"
HERE = os.path.dirname(os.path.abspath(__file__))
PHONE = dict(viewport={"width": 360, "height": 640}, device_scale_factor=3, is_mobile=True, has_touch=True)

DEMO = {
    "en": {
        "title": "Saturday lunch at grandma's",
        "details": "Saturday 21, 13:00. Bring a chair!",
        "rows": [("Food", None), ("Main dish", 2), ("Salad", 1), ("Dessert", 2), ("Bread", 1),
                 ("Drinks", None), ("Soda and water", 1), ("Wine", 1),
                 ("Help", None), ("Set the table", 2), ("Wash the dishes", 0)],
        "signups": [("Main dish", "Marta", "vegan lasagna"), ("Main dish", "Leo", "roast chicken"),
                    ("Salad", "Ana", ""), ("Dessert", "Sofi", "flan"), ("Soda and water", "Tomás", ""),
                    ("Wash the dishes", "Pablo", ""), ("Wash the dishes", "Juli", "")],
        "new": ("Bread", "Caro", "two baguettes"),
    },
    "es": {
        "title": "Almuerzo del sábado en lo de la abuela",
        "details": "Sábado 21, 13 h. ¡Traé una silla!",
        "rows": [("Comida", None), ("Plato principal", 2), ("Ensalada", 1), ("Postre", 2), ("Pan", 1),
                 ("Bebidas", None), ("Gaseosa y agua", 1), ("Vino", 1),
                 ("Ayuda", None), ("Poner la mesa", 2), ("Lavar los platos", 0)],
        "signups": [("Plato principal", "Marta", "lasaña vegana"), ("Plato principal", "Leo", "pollo al horno"),
                    ("Ensalada", "Ana", ""), ("Postre", "Sofi", "flan"), ("Gaseosa y agua", "Tomás", ""),
                    ("Lavar los platos", "Pablo", ""), ("Lavar los platos", "Juli", "")],
        "new": ("Pan", "Caro", "dos baguettes"),
    },
}

def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (sumate store script)", **(headers or {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def token(name):
    return (name.lower().encode().hex() + "a" * 20)[:20].replace("0", "a").replace("1", "b")

def shoot(page, path):
    page.wait_for_timeout(300)
    page.screenshot(path=path)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    for lang, d in DEMO.items():
        made = call("POST", "/api/sheets", {"title": d["title"], "details": d["details"],
                                             "rows": [{"text": t, "heading": n is None, "need": n} for t, n in d["rows"]]})
        sid, key = made["id"], made["key"]
        view = call("GET", f"/api/sheets/{sid}")
        rid = {r["text"]: r["id"] for r in view["sheet"]["rows"]}
        for row, name, note in d["signups"]:
            call("POST", f"/api/sheets/{sid}/signups", {"row": rid[row], "name": name, "note": note, "token": token(name)})
        loc = "en-US" if lang == "en" else "es-AR"
        try:
            # 1-2: Sofi's phone: the sheet with her own name marked, then the sign-up box (as Caro, on a fresh phone)
            g = b.new_context(locale=loc, **PHONE)
            g.add_init_script(f"localStorage.setItem('sumate.token', '{token('Sofi')}'); localStorage.setItem('sumate.name', 'Sofi');")
            gp = g.new_page()
            gp.goto(f"{BASE}/s/{sid}")
            gp.wait_for_selector(".person.me")
            shoot(gp, os.path.join(HERE, f"1-sheet-{lang}.png"))
            c = b.new_context(locale=loc, **PHONE)
            c.add_init_script("localStorage.setItem('sumate.name', 'Caro');")
            cp = c.new_page()
            cp.goto(f"{BASE}/s/{sid}")
            cp.wait_for_selector("#srows .srow")
            row = cp.locator("#srows .srow", has_text=d["new"][0])
            row.scroll_into_view_if_needed()
            row.locator(".join").click()
            cp.fill("#signNote", d["new"][2])
            cp.locator("#signNote").blur()
            shoot(cp, os.path.join(HERE, f"2-signup-{lang}.png"))
            # 3-5: the organizer's phone: editor, share, home with the sheet listed
            o = b.new_context(locale=loc, **PHONE)
            op = o.new_page()
            op.goto(f"{BASE}/s/{sid}#k={key}")
            op.wait_for_selector("#editBtn:not([hidden])")
            op.click("#editBtn")
            op.wait_for_selector("#edit:not([hidden])")
            op.locator("#title").blur()
            shoot(op, os.path.join(HERE, f"3-editor-{lang}.png"))
            op.click("#editBack")
            op.wait_for_selector("#sheet:not([hidden])")
            op.click("#shareBtn")
            op.wait_for_selector("#shareBox:not([hidden])")
            shoot(op, os.path.join(HERE, f"4-share-{lang}.png"))
            op.click("#shareClose")
            op.locator("#srows .srow", has_text=d["rows"][-1][0]).scroll_into_view_if_needed()
            shoot(op, os.path.join(HERE, f"5-organizer-{lang}.png"))
        finally:
            call("DELETE", f"/api/sheets/{sid}", headers={"X-Sheet-Key": key})

    # feature graphic 1024x500
    icon = base64.b64encode(open(os.path.join(HERE, "..", "..", "web", "img", "icon-512.png"), "rb").read()).decode()
    for lang, tag, rows in [
        ("en", "Free sign-up sheets", [("Main dish", "Marta · Leo", "Full"), ("Dessert", "Sofi", "1 of 2"), ("Wash the dishes", "Pablo · Juli", "")]),
        ("es", "Listas para anotarse, gratis", [("Plato principal", "Marta · Leo", "Completo"), ("Postre", "Sofi", "1 de 2"), ("Lavar los platos", "Pablo · Juli", "")]),
    ]:
        cards = "".join(f'<div class="r"><div class="t"><b>{a}</b><span>{c}</span></div><div class="n">{n}</div></div>' for a, n, c in rows)
        html = f"""<html><body style="margin:0"><div style="width:1024px;height:500px;background:#0f5e57;display:flex;align-items:center;
        font-family:'Segoe UI',system-ui,sans-serif;color:#fff;box-sizing:border-box;padding:0 56px;gap:40px">
        <div style="flex:1"><img src="data:image/png;base64,{icon}" style="width:116px;height:116px;border-radius:28px;box-shadow:0 0 0 4px #f7f4ee33">
        <div style="font-size:84px;font-weight:800;margin-top:14px;line-height:1">Sumate</div>
        <div style="font-size:30px;color:#cfe9e4;margin-top:12px">{tag}</div></div>
        <div style="width:410px;display:flex;flex-direction:column;gap:14px">{cards}</div></div>
        <style>.r{{background:#f7f4ee;color:#17262a;border-radius:18px;padding:16px 20px}}.t{{display:flex;justify-content:space-between;font-size:24px}}
        .t span{{color:#0f5e57;font-weight:700;font-size:19px}}.n{{display:inline-block;margin-top:10px;background:#e3f1ee;border-radius:99px;padding:5px 14px;font-size:19px}}</style>
        </body></html>"""
        pg = b.new_page(viewport={"width": 1024, "height": 500})
        pg.set_content(html)
        pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(HERE, f"feature-{lang}.png"))
    b.close()
print("done")
