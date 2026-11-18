// "Send feedback": the same small sheet in every free Jurisgames app (Juntos, Ronda, Sumate). The person picks what
// it is (a problem, an idea, something else), writes it, may leave an email for a reply, and may include technical
// details (on by default; "See what's sent" shows exactly what goes). It is sent to feedback.jurisgames.com, which
// emails it to hello@jurisgames.com and keeps nothing. Source of truth: github.com/kleiders3010/jurisgames-feedback
// (client/feedback.js); each app keeps a copy.
//
//   openFeedback({ app: "juntos", version: "1.4", t, toast, detailsLabel: "Include recent call technical details",
//                  details: () => ({ ... }) })

const ENDPOINT = "https://feedback.jurisgames.com/send";
const KINDS = [
  ["bug", "Something isn't working"],
  ["idea", "An idea"],
  ["other", "Something else"],
];

const CSS = `
.fbSheet { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 12px; }
.fbBox { background: var(--paper, var(--bg, #fff)); color: var(--ink, var(--fg, #111)); width: min(520px, 100%); max-height: calc(100dvh - 24px); overflow: auto; border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
.fbBox h3 { margin: 0; font-size: 20px; }
.fbBox p { margin: 0; }
.fbKinds { display: flex; gap: 6px; flex-wrap: wrap; }
.fbKinds button { border: 1.5px solid var(--line, #6b7280); border-radius: 999px; padding: 8px 14px; }
.fbKinds button[aria-pressed="true"] { background: var(--accent, #3b82f6); border-color: var(--accent, #3b82f6); color: #fff; }
.fbBox textarea, .fbBox input[type="email"] { font: inherit; color: inherit; background: var(--card, transparent); border: 1.5px solid var(--line, #6b7280); border-radius: 12px; padding: 10px 12px; width: 100%; box-sizing: border-box; }
.fbBox textarea { min-height: 120px; resize: vertical; }
.fbCheck { display: flex; gap: 10px; align-items: flex-start; }
.fbCheck input { width: 20px; height: 20px; margin: 2px 0 0; accent-color: var(--accent, #3b82f6); flex: none; }
.fbSmall { font-size: 13px; color: var(--muted, #6b7280); }
.fbLink { color: var(--accent, #3b82f6); text-decoration: underline; padding: 0; align-self: flex-start; font-size: 14px; }
.fbPre { font: 12px/1.4 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; background: rgba(127,127,127,.12); border-radius: 10px; padding: 10px; margin: 0; }
.fbRow { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.fbRow button { border-radius: 999px; padding: 10px 18px; font-weight: 600; }
.fbSend { background: var(--accent, #3b82f6); color: #fff; }
.fbSend:disabled { opacity: .5; }
.fbMsg { min-height: 1.2em; font-size: 14px; }
.fbMsg.err { color: #dc2626; }
.fbHp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
`;

const ERRORS = {
  limit: "Too many reports from this network today. Please try again tomorrow, or write to hello@jurisgames.com.",
  email: "That email doesn't look right.",
  long: "That is too long. Please keep it under 4,000 characters.",
  details: "The technical details are too big. Untick them and send again.",
};

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}

/** The basics every report can carry: browser, system, screen, language, connection type. No names, no content. */
export function basicDetails() {
  const c = navigator.connection || {};
  return {
    browser: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || "",
    mobile: navigator.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/.test(navigator.userAgent),
    language: navigator.language,
    screen: `${screen.width}x${screen.height} @${devicePixelRatio}`,
    window: `${innerWidth}x${innerHeight}`,
    connection: c.effectiveType ? { type: c.type || "", effectiveType: c.effectiveType, downlinkMbps: c.downlink, rttMs: c.rtt, saveData: !!c.saveData } : undefined,
    installed: matchMedia("(display-mode: standalone)").matches,
  };
}

// recent errors on this page (message and place only), for "Something isn't working" reports
const ERR = [];
if (typeof window !== "undefined" && !window.__fbErrors) {
  window.__fbErrors = ERR;
  const keep = (msg, where) => {
    ERR.push({ at: new Date().toISOString(), msg: String(msg).slice(0, 300), where: String(where || "").replace(/^https?:\/\/[^/]+/, "").slice(0, 120) });
    if (ERR.length > 10) ERR.shift();
  };
  window.addEventListener("error", (e) => keep(e.message, `${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => keep(e.reason?.message || e.reason, e.reason?.stack?.split("\n")[1]));
}
export const recentErrors = () => [...(window.__fbErrors || ERR)];

export function openFeedback(o) {
  const t = o.t || ((s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v?.[k] ?? ""));
  if (document.querySelector(".fbSheet")) return;
  if (!document.getElementById("fbCss")) document.head.append(el("style", { id: "fbCss", textContent: CSS }));
  const sheet = el("div", { className: "fbSheet", role: "dialog", ariaModal: "true" });
  const box = el("form", { className: "fbBox", noValidate: true });
  sheet.append(box);
  let kind = o.kind || "bug";
  const kinds = el("div", { className: "fbKinds", role: "group" });
  for (const [k, label] of KINDS) {
    const b = el("button", { type: "button", name: `kind-${k}`, textContent: t(label) });
    b.setAttribute("aria-pressed", String(k === kind));
    b.onclick = () => {
      kind = k;
      for (const x of kinds.children) x.setAttribute("aria-pressed", String(x === b));
      paintPreview();
    };
    kinds.append(b);
  }
  const msg = el("textarea", { name: "message", maxLength: 4000, placeholder: t("What happened, or what would make it better?") });
  const email = el("input", { type: "email", name: "email", maxLength: 254, autocomplete: "email", placeholder: t("Your email, if you'd like an answer (optional)") });
  const hp = el("input", { name: "website", tabIndex: -1, autocomplete: "off", className: "fbHp" });
  hp.setAttribute("aria-hidden", "true");
  const inc = el("input", { type: "checkbox", name: "details", checked: o.details ? true : false });
  const incRow = el("label", { className: "fbCheck" }, inc, el("span", { textContent: t(o.detailsLabel || "Include technical details") }));
  const incNote = el("p", { className: "fbSmall", textContent: t(o.detailsNote || "Browser, system, screen size and recent errors. Nothing you made in the app, and no names.") });
  const pre = el("pre", { className: "fbPre", hidden: true });
  const see = el("button", { type: "button", className: "fbLink", name: "see", textContent: t("See what's sent") });
  const report = () => {
    const r = { app: o.app, kind, message: msg.value.trim(), lang: document.documentElement.lang || navigator.language };
    if (o.version) r.version = o.version;
    if (email.value.trim()) r.email = email.value.trim();
    if (inc.checked) {
      try {
        r.details = { ...basicDetails(), errors: recentErrors(), ...(o.details ? o.details() : {}) };
      } catch (e) {
        r.details = { ...basicDetails(), detailsError: String(e).slice(0, 200) };
      }
    }
    return r;
  };
  const paintPreview = () => {
    if (!pre.hidden) pre.textContent = JSON.stringify(report(), null, 2);
  };
  see.onclick = () => {
    pre.hidden = !pre.hidden;
    see.textContent = pre.hidden ? t("See what's sent") : t("Hide what's sent");
    paintPreview();
  };
  for (const x of [msg, email, inc]) x.addEventListener("input", paintPreview);
  inc.addEventListener("change", paintPreview);
  const out = el("p", { className: "fbMsg", role: "status" });
  const cancel = el("button", { type: "button", name: "cancel", textContent: t("Cancel") });
  const send = el("button", { type: "submit", className: "fbSend", name: "send", textContent: t("Send") });
  const close = () => {
    sheet.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  cancel.onclick = close;
  sheet.onclick = (e) => {
    if (e.target === sheet) close(); // a block: an onclick that returns false cancels the click (Send stopped working)
  };
  box.onsubmit = async (e) => {
    e.preventDefault();
    out.className = "fbMsg";
    if (!msg.value.trim()) {
      out.className = "fbMsg err";
      out.textContent = t("Write a few words first.");
      return msg.focus();
    }
    const r = report();
    if (hp.value) r.website = hp.value;
    send.disabled = true;
    out.textContent = t("Sending…");
    try {
      const res = await fetch(o.endpoint || ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw Object.assign(new Error("send"), { code: j.error });
      close();
      (o.toast || alert)(t("Thanks! Your message was sent."));
    } catch (err) {
      send.disabled = false;
      out.className = "fbMsg err";
      out.textContent = t(ERRORS[err.code] || "It couldn't be sent. Check your connection and try again, or write to hello@jurisgames.com.");
    }
  };
  box.append(
    el("h3", { textContent: t("Send feedback") }),
    el("p", { className: "fbSmall", textContent: t("It goes to the person who makes this app. Thanks for helping!") }),
    kinds,
    msg,
    email,
    hp,
    ...(o.details !== false ? [incRow, incNote, see, pre] : []),
    out,
    el("div", { className: "fbRow" }, cancel, send),
  );
  document.body.append(sheet);
  msg.focus();
  return sheet;
}

// Spanish (Argentina, vos) for the apps' dictionaries: spread into DICT.es
export const FEEDBACK_ES = {
  "Send feedback": "Enviar comentarios",
  "Something isn't working": "Algo no funciona",
  "An idea": "Una idea",
  "Something else": "Otra cosa",
  "What happened, or what would make it better?": "¿Qué pasó, o qué lo haría mejor?",
  "Your email, if you'd like an answer (optional)": "Tu email, si querés una respuesta (opcional)",
  "Include technical details": "Incluir detalles técnicos",
  "Browser, system, screen size and recent errors. Nothing you made in the app, and no names.": "Navegador, sistema, tamaño de pantalla y errores recientes. Nada de lo que hiciste en la app, y ningún nombre.",
  "See what's sent": "Ver lo que se envía",
  "Hide what's sent": "Ocultar lo que se envía",
  "Cancel": "Cancelar",
  "Send": "Enviar",
  "Write a few words first.": "Escribí algunas palabras primero.",
  "Sending…": "Enviando…",
  "Thanks! Your message was sent.": "¡Gracias! Tu mensaje se envió.",
  "It goes to the person who makes this app. Thanks for helping!": "Le llega a quien hace esta app. ¡Gracias por ayudar!",
  "Too many reports from this network today. Please try again tomorrow, or write to hello@jurisgames.com.": "Demasiados mensajes desde esta red hoy. Probá mañana, o escribí a hello@jurisgames.com.",
  "That email doesn't look right.": "Ese email no parece correcto.",
  "That is too long. Please keep it under 4,000 characters.": "Es demasiado largo. Usá menos de 4.000 caracteres.",
  "The technical details are too big. Untick them and send again.": "Los detalles técnicos son demasiado grandes. Destildalos y enviá de nuevo.",
  "It couldn't be sent. Check your connection and try again, or write to hello@jurisgames.com.": "No se pudo enviar. Revisá tu conexión y probá de nuevo, o escribí a hello@jurisgames.com.",
};
