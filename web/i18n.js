// UI language: the browser's, or ?lang=xx in the link. English text is the key; other languages map it.
// Add a language: copy the "es" block, translate the right-hand side.

import { FEEDBACK_ES } from "./feedback.js";

const DICT = {
  es: { // Spanish as spoken in Argentina (vos)
    ...FEEDBACK_ES,
    "Report a problem or idea": "Contar un problema o una idea",
    "Feedback": "Comentarios",
    "Include technical details": "Incluir detalles técnicos",
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
    "Questions for people who sign up": "Preguntas para quien se anota",
    "Optional. Only you see the answers.": "Opcional. Las respuestas las ves solo vos.",
    "+ Add a question": "+ Agregar una pregunta",
    "e.g. T-shirt size? or Any allergies?": "por ej. ¿Talle de remera? o ¿Alguna alergia?",
    "Question": "Pregunta",
    "Choices, one per line (leave empty for a written answer)": "Opciones, una por línea (vacío para una respuesta escrita)",
    "Choices": "Opciones",
    "Required": "Obligatoria",
    "{q} (optional)": "{q} (opcional)",
    "Choose one": "Elegí una",
    "Answer the questions marked as required.": "Respondé las preguntas obligatorias.",
    "Where (optional)": "Dónde (opcional)",
    "+ Add time slots": "+ Agregar turnos",
    "Time slots": "Turnos",
    "Day": "Día",
    "From": "Desde",
    "To": "Hasta",
    "Every": "Cada",
    "For": "Para",
    "e.g. Volunteer, Appointment": "por ej. Voluntario, Turno",
    "1 hour": "1 hora",
    "2 hours": "2 horas",
    "3 hours": "3 horas",
    "4 hours": "4 horas",
    "Add": "Agregar",
    "{n} slots": "{n} turnos",
    "Added {n} slots": "Se agregaron {n} turnos",
    "Spot": "Lugar",
    "Day and time": "Día y hora",
    "Time": "Hora",
    "{place} time": "hora de {place}",
    "Add to my calendar": "Agregar a mi calendario",
    "Remind me": "Avisarme",
    "No reminder": "Sin aviso",
    "1 hour before": "1 hora antes",
    "That morning": "Esa mañana",
    "1 day before": "1 día antes",
    "2 days before": "2 días antes",
    "1 week before": "1 semana antes",
    "Make a copy": "Hacer una copia",
    "{title} (copy)": "{title} (copia)",
    "Copy of the sheet": "Copia de la lista",
    "Move every day": "Mover todos los días",
    "Keep the days": "Dejar los días",
    "1 day later": "1 día después",
    "1 week later": "1 semana después",
    "2 weeks later": "2 semanas después",
    "4 weeks later": "4 semanas después",
    "Put it on a website": "Ponerla en una página web",
    "The sheet itself, on your page": "La planilla misma, en tu página",
    "A button that opens it": "Un botón que la abre",
    "Copy the code": "Copiar el código",
    "Paste it into your page's HTML.": "Pegalo en el HTML de tu página.",
    "Sign up: {title}": "Anotate: {title}",
    "⏱ Open and close at set times": "⏱ Abrir y cerrar en un horario",
    "Opens": "Abre",
    "Closes": "Cierra",
    "Lines with a day take sign-ups": "Las líneas con día reciben anotados",
    "Any time": "Siempre",
    "Until they start": "Hasta que empiezan",
    "Until 1 hour before": "Hasta 1 hora antes",
    "Until 3 hours before": "Hasta 3 horas antes",
    "Until 6 hours before": "Hasta 6 horas antes",
    "Until 12 hours before": "Hasta 12 horas antes",
    "Until 1 day before": "Hasta 1 día antes",
    "Until 2 days before": "Hasta 2 días antes",
    "Until 3 days before": "Hasta 3 días antes",
    "Until 1 week before": "Hasta 1 semana antes",
    "Once closed, people can't remove themselves": "Una vez cerrada, nadie puede borrarse solo",
    "It has to close after it opens.": "Tiene que cerrar después de abrir.",
    "Sign-ups open {when}.": "Se abre para anotarse el {when}.",
    "Sign-ups close {when}.": "Se cierra para anotarse el {when}.",
    "Sign-ups aren't open yet.": "Todavía no se puede anotar.",
    "This one isn't taking sign-ups any more.": "Esta ya no recibe anotados.",
    "No more sign-ups for this one": "Ya no recibe anotados",
    "The list is final: ask the organizer if you can't come.": "La lista es definitiva: si no podés ir, avisale a quien organiza.",
    "Add to your calendar": "Agregalo a tu calendario",
    "You're in. Add it to your calendar?": "¡Listo! ¿Lo agregás a tu calendario?",
    "Apple, Outlook, other (.ics file)": "Apple, Outlook, otro (archivo .ics)",
    "e.g. vegan lasagna, I'll be 10 min late": "por ej. lasaña vegana, llego 10 min tarde",
    "Cancel": "Cancelar",
    "Add me": "Anotarme",
    "People can check themselves in when they arrive": "Cada uno puede marcar que llegó",
    "✓ Check-in": "✓ Asistencia",
    "Check-in": "Asistencia",
    "Check-in link": "Enlace de asistencia",
    ": for helpers at the door. They see the names, mark who came and can add someone who just turned up; they can't edit or remove anyone.": ": para quienes reciben a la gente. Ven los nombres, marcan quién llegó y pueden sumar a alguien que vino sin anotarse; no pueden editar ni sacar a nadie.",
    "Make a check-in link": "Crear un enlace de asistencia",
    "New link (the old one stops working)": "Enlace nuevo (el anterior deja de andar)",
    "Turn it off": "Desactivarlo",
    "Check-in link ready": "Enlace de asistencia listo",
    "Check-in link turned off": "Enlace de asistencia desactivado",
    "Find a name or a line": "Buscá un nombre o una línea",
    "Nobody by that name.": "No hay nadie con ese nombre.",
    "Someone who just came: added and checked in.": "Alguien que vino sin anotarse: queda anotado y presente.",
    "{n} of {m} here": "{n} de {m} llegaron",
    "Here since {when}": "Llegó a las {when}",
    "✓ Here": "✓ Llegó",
    "Here": "Llegó",
    "Check in": "Marcar",
    "Tap again to undo": "Tocá de nuevo para deshacer",
    "Someone who just came": "Alguien que vino sin anotarse",
    "Add and check in": "Sumar y marcar presente",
    "{name} added and checked in": "{name} anotado y presente",
    "Checked in {when}": "Llegó a las {when}",
    "You're checked in": "Ya marcaste que llegaste",
    "I'm here: check in": "Llegué: marcar presente",
    "Checked in": "Llegó",
    "This check-in link was turned off or replaced. Ask the organizer for the new one.": "Este enlace de asistencia se desactivó o se cambió. Pedile el nuevo a quien organiza.",
    "You can check in from the day it happens.": "Podés marcar que llegaste desde el día en que es.",
    "Still on the waiting list: not in yet.": "Sigue en la lista de espera: todavía no tiene lugar.",
    "Share this sheet": "Compartir esta lista",
    "Copy": "Copiar",
    "Send with…": "Enviar por…",
    "Your organizer link": "Tu enlace de organizador",
    ": keep it private. It's the only way to edit.": ": guardalo para vos. Es la única forma de editar.",
    "Close": "Cerrar",
    "Copied": "Copiado",
    "Select the link and copy it": "Seleccioná el enlace y copialo",
    "No connection. Try again.": "Sin conexión. Probá de nuevo.",
    "Can't reach the sheet right now. This is the copy saved on this device ({when}). Signing up works again when it's back.": "No se puede llegar a la lista ahora. Esta es la copia guardada en este dispositivo ({when}). Vas a poder anotarte cuando vuelva.",
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
    "You can remove anyone and download the list.": "Podés quitar a cualquiera y descargar la lista.",
    "You are the organizer. Only you see the names; others see how many signed up.": "Sos quien organiza. Solo vos ves los nombres; los demás ven cuántos se anotaron.",
    "Full": "Completo",
    "{n} of {m}": "{n} de {m}",
    "{n} signed up": "{n} anotados",
    "Taken": "Ocupado",
    "Waiting list when a line is full": "Lista de espera cuando una línea se llena",
    "The line is full. You go on the waiting list, and if a spot opens you're in by yourself, in order.": "Está completa. Quedás en la lista de espera y, si se libera un lugar, entrás solo, por orden.",
    "Full · {n} waiting": "Completo · {n} esperando",
    "Waiting list": "Lista de espera",
    "People can take more than one (e.g. 2 dozen cookies)": "Cada uno puede anotarse para más de uno (por ej. 2 docenas de galletitas)",
    "👤 Limit per person": "👤 Límite por persona",
    "No limit": "Sin límite",
    "Most one person can take on the sheet": "Lo máximo que puede tomar cada persona en la lista",
    "Most one person can take on each line": "Lo máximo que puede tomar cada persona en cada línea",
    "How many": "Cuántos",
    "{n} taken": "{n} tomados",
    "Up to {n} per person on this sheet": "Hasta {n} por persona en esta lista",
    "You have the most one person can take": "Ya tenés lo máximo que puede tomar una persona",
    "Up to {n} per person on each line": "Hasta {n} por persona en cada línea",
    "You already have {n} on this line, the most one person can take.": "Ya tenés {n} en esta línea, lo máximo que puede tomar una persona.",
    "You already have {n} on this sheet, the most one person can take.": "Ya tenés {n} en esta lista, lo máximo que puede tomar una persona.",
    "There aren't that many spots left.": "No quedan tantos lugares.",
    "That's more than one person can take on this sheet.": "Es más de lo que puede tomar una persona en esta lista.",
    "Join the waiting list": "Anotarme en la lista de espera",
    "You're on the waiting list, number {n}": "Estás en la lista de espera, número {n}",
    "A spot opened: you're in for {what}": "Se liberó un lugar: entraste en {what}",
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
