// UI language: the browser's, or ?lang=xx in the link. English text is the key; other languages map it.
// Add a language: copy the "es" block, translate the right-hand side.

const DICT = {
  es: { // Spanish as spoken in Argentina (vos)
    "Sumate · free sign-up sheets": "Sumate · listas para anotarse, gratis",
    "Who brings what, turns, shifts, volunteers: share one link and people add their name.": "Quién trae qué, turnos, horarios, voluntarios: compartís un enlace y cada uno se anota.",
    "Make a sign-up sheet": "Crear una lista",
    "Your sheets": "Tus listas",
    "Free, no account, no ads": "Gratis, sin cuenta, sin anuncios",
    "Open source": "Código abierto",
    "Free, no account, no ads · Open source": "Gratis, sin cuenta, sin anuncios · Código abierto",
    "Privacy": "Privacidad",
    "Back": "Volver",
    "New sheet": "Lista nueva",
    "Edit sheet": "Editar lista",
    "Save": "Guardar",
    "Title, e.g. Saturday lunch at grandma's": "Título, por ej. Almuerzo del sábado en lo de la abuela",
    "When, where, anything people should know (optional)": "Cuándo, dónde, lo que haya que saber (opcional)",
    "What you need": "Qué hace falta",
    "One line per thing or time slot, and how many people it needs.": "Una línea por cosa o por horario, y cuántas personas hacen falta.",
    "+ Add a line": "+ Agregar una línea",
    "+ Add a heading": "+ Agregar un título",
    "Everyone can see who signed up": "Todos ven quién se anotó",
    "Open for sign-ups": "Abierta para anotarse",
    "Delete this sheet": "Borrar esta lista",
    "Tap again to delete it for everyone": "Tocá de nuevo para borrarla para todos",
    "Sheet deleted": "Lista borrada",
    "Sumate": "Sumate",
    "Edit": "Editar",
    "Share": "Compartir",
    "Sign-ups are closed.": "La lista está cerrada.",
    "Download (CSV)": "Descargar (CSV)",
    "This sheet doesn't exist": "Esta lista no existe",
    "It was deleted, or the link is not complete.": "La borraron, o el enlace está incompleto.",
    "Make your own": "Crear la tuya",
    "Sign up for": "Anotarte en",
    "Your name": "Tu nombre",
    "Note (optional)": "Nota (opcional)",
    "e.g. vegan lasagna, I'll be 10 min late": "por ej. lasaña vegana, llego 10 min tarde",
    "Cancel": "Cancelar",
    "Add me": "Anotarme",
    "Share this sheet": "Compartir esta lista",
    "Copy": "Copiar",
    "Send with…": "Enviar por…",
    "Your organizer link": "Tu enlace de organizador",
    ": only with it can you edit this sheet. Keep it; don't share it.": ": solo con él podés editar esta lista. Guardalo y no lo compartas.",
    "Close": "Cerrar",
    "Copied": "Copiado",
    "Select the link and copy it": "Seleccioná el enlace y copialo",
    "No connection. Try again.": "Sin conexión. Probá de nuevo.",
    "Someone just took the last spot.": "Alguien acaba de tomar el último lugar.",
    "Something went wrong. Try again.": "Algo salió mal. Probá de nuevo.",
    "Sheet": "Lista",
    "Yours": "Tuya",
    "Signed up": "Anotado",
    "Heading, e.g. Saturday or Desserts": "Título, por ej. Sábado o Postres",
    "e.g. Salad, or 10:00 - 12:00": "por ej. Ensalada, o 10:00 - 12:00",
    "Fewer people": "Menos personas",
    "More people": "Más personas",
    "How many people (∞ = any number)": "Cuántas personas (∞ = sin límite)",
    "Remove": "Quitar",
    "Give the sheet a title.": "Ponele un título a la lista.",
    "Add at least one line.": "Agregá al menos una línea.",
    "You are the organizer: you can edit, remove anyone, and download the list.": "Sos quien organiza: podés editar, quitar a cualquiera y descargar la lista.",
    "You are the organizer. Only you see the names; others see how many signed up.": "Sos quien organiza. Solo vos ves los nombres; los demás ven cuántos se anotaron.",
    "Full": "Completo",
    "{n} of {m}": "{n} de {m}",
    "{n} signed up": "{n} anotados",
    "Taken": "Ocupado",
    "Remove me": "Sacarme",
    "Remove {name}": "Quitar a {name}",
    "Sign up": "Anotarme",
    "{n} of {m} spots filled": "{n} de {m} lugares ocupados",
    "Removed you": "Te sacamos de la lista",
    "Removed {name}": "Quitaste a {name}",
    "You're in: {what}": "Te anotaste: {what}",
    "Saved. Now share it.": "Guardada. Ahora compartila.",
    "Line": "Línea",
    "Name": "Nombre",
    "Note": "Nota",
    "When": "Cuándo",
  },
};
function pick() {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked) {
    try { localStorage.setItem("lang", asked); } catch {}
  }
  const want = [asked, safeGet("lang"), ...(navigator.languages || [navigator.language])].filter(Boolean);
  for (const l of want) {
    const base = String(l).toLowerCase().split("-")[0];
    if (base === "en") return "en";
    if (DICT[base]) return base;
  }
  return "en";
}

function safeGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}

export const LANG = pick();
const table = DICT[LANG] || {};

/** t("{name} left", { name }) -> the text in the UI language, placeholders filled. */
export function t(text, vars) {
  let s = table[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Translates the static page: text nodes and title / placeholder / alt attributes. */
export function translatePage(root = document) {
  document.documentElement.lang = LANG;
  if (LANG === "en") return;
  document.title = t(document.title);
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue;
    const s = raw.trim();
    if (!s) continue;
    // "Open source · <a>" keeps its separator
    const core = s.replace(/\s*·\s*$/, "");
    if (table[core]) n.nodeValue = raw.replace(core, table[core]);
  }
  for (const el of (root.body || root).querySelectorAll("[title],[placeholder]")) {
    for (const a of ["title", "placeholder"]) if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
  }
}
