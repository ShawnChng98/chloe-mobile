// Chloe Mobile: the page. Tap to talk (the phone's recogniser), type, or use the chips. Replies are spoken only
// when you spoke (setting), and every reply has ▶ to hear it. Data: the private second-brain repo via GH.
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PENDING = "chloe.pending";
let listening = null, triageCache = null;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- clock ----------
function tick() {
  const s = Chloe.sgt().t;
  $("clock").textContent = `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`;
  $("date").textContent = s.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase() + " SGT";
}
setInterval(tick, 10000); tick();

// ---------- state on the reactor ----------
const CORE = { idle: ["STANDING BY", "TAP TO TALK"], listening: ["LISTENING", "MIC LIVE"], thinking: ["THINKING", "ONE MOMENT"],
  waiting: ["ASKED", "CHLOE WILL ANSWER"], speaking: ["SPEAKING", "TAP TO STOP"] };
function setState(s) {
  HUD.setState(s === "waiting" ? "thinking" : s);
  $("core-state").textContent = CORE[s][0];
  $("core-sub").textContent = CORE[s][1];
  $("talk").setAttribute("aria-pressed", String(s === "listening"));
  $("talk").textContent = s === "listening" ? "LISTENING… TAP TO SEND" : s === "speaking" ? "TAP TO STOP" : "TAP TO TALK";
}
const voiceOn = () => $("voice-on").checked;
$("voice-on").checked = localStorage.getItem("chloe.voice") !== "off";
$("voice-on").onchange = () => localStorage.setItem("chloe.voice", $("voice-on").checked ? "on" : "off");

function say(text) {
  setState("speaking");
  Speech.speak(text, (l) => { if (l) HUD.pulse(); else setState("idle"); });
}

// ---------- conversation ----------
function addTurn({ q, spoken, screen, by, wait, id }) {
  const box = $("turns");
  box.querySelector(".dim")?.remove();
  const el = document.createElement("div");
  el.className = "turn" + (wait ? " wait" : "");
  if (id) el.dataset.id = id;
  el.innerHTML = `<div class="q">› ${esc(q)}</div><div class="a"><b>${esc(spoken || "")}</b></div>` +
    (screen ? `<div class="s">${esc(screen)}</div>` : "") +
    `<div class="m">${esc(by || "")} ${spoken ? '<button class="link play">▶ HEAR</button>' : ""}</div>`;
  el.querySelector(".play")?.addEventListener("click", () => say(spoken));
  box.prepend(el);
  $("cap-you").textContent = q;
  $("cap-am").textContent = spoken || "…";
  return el;
}

// ---------- handling what Shawn says or types ----------
async function handle(text, spoken) {
  text = text.trim();
  if (!text) return;
  if (!GH.hasKey) { openSettings(); return; }
  const kind = Chloe.route(text);
  setState("thinking");
  try {
    if (kind === "note") {
      const n = Chloe.noteCommand(text);
      await Chloe.fileNote(n.kind, n.words);
      const reply = n.kind === "remind" ? "Got it, I'll make sure that's remembered." : n.kind === "correct"
        ? "Thanks, I've passed that correction on." : "Got it, noted.";
      addTurn({ q: text, spoken: `${reply} The Second Brain will file it.`, screen: n.words, by: "CODE · SHARED INBOX" });
      return finish(reply, spoken);
    }
    if (kind === "urgent") {
      const [tr, cm] = await Promise.all([Chloe.triage(), Chloe.commitments()]);
      const s = Chloe.urgentSpoken(tr, cm) + " It's all on screen.";
      const lines = tr.items.filter((i) => i.tier !== "brief").map((i) => `• ${i.tier.toUpperCase()} ${i.rule} · ${i.alert_text}`);
      cm.overdue.forEach((c) => lines.push(`• OVERDUE ${c.due} · ${c.project} · ${c.what}`));
      addTurn({ q: text, spoken: s, screen: lines.join("\n") || "Nothing logged today.", by: "CODE" });
      return finish(s, spoken);
    }
    if (kind === "brief") {
      const b = await Chloe.brief();
      const s = b ? b.text : "There's no brief yet.";
      addTurn({ q: text, spoken: b ? `Your brief for ${b.date}.` : s, screen: b ? b.text : "", by: "CODE · SECOND BRAIN" });
      return finish(s, spoken);
    }
    const id = await Chloe.ask(text, spoken);
    const pend = JSON.parse(localStorage.getItem(PENDING) || "[]");
    pend.push({ id, q: text, spoken, at: Date.now() });
    localStorage.setItem(PENDING, JSON.stringify(pend));
    addTurn({ q: text, spoken: "Asked. The laptop answers in seconds; if it's off, the next hourly run will.", wait: true, id, by: "WAITING" });
    setState("waiting");
    pollPending(true);
  } catch (e) {
    addTurn({ q: text, spoken: "That didn't go through.", screen: String(e.message || e), by: "ERROR" });
    setState("idle");
  }
}
function finish(text, spoken) {
  if (spoken && voiceOn()) say(text); else setState("idle");
}

let polling = null;
async function pollPending(fast) {
  clearTimeout(polling);
  let pend = JSON.parse(localStorage.getItem(PENDING) || "[]");
  for (const p of [...pend]) {
    let a = null;
    try { a = await Chloe.answer(p.id); } catch { /* offline: try later */ }
    if (!a) continue;
    pend = pend.filter((x) => x.id !== p.id);
    document.querySelector(`.turn[data-id="${p.id}"]`)?.remove();
    addTurn({ q: p.q, spoken: a.spoken, screen: a.screen, by: `CLAUDE · ${String(a.by || "").toUpperCase()} · ${a.answered_at || ""}` });
    if (p.spoken && voiceOn()) say(a.spoken); else setState("idle");
  }
  localStorage.setItem(PENDING, JSON.stringify(pend));
  if (pend.length) {
    const young = pend.some((p) => Date.now() - p.at < 180000);
    polling = setTimeout(() => pollPending(young), young ? 4000 : 30000);
  } else if (!Speech.speaking) setState("idle");
}

// ---------- cards ----------
function gauge(id, n, total) {
  $(id).querySelector("b").textContent = n;
  $(id).style.setProperty("--p", total ? (n / total).toFixed(3) : 0);
}
async function refresh() {
  if (!GH.hasKey) { $("conn").textContent = "no key: open ⚙"; return; }
  try {
    const tr = await Chloe.triage();
    triageCache = tr;
    const total = tr.counts.urgent + tr.counts.attention + tr.counts.brief;
    gauge("g-urgent", tr.counts.urgent, total); gauge("g-attention", tr.counts.attention, total); gauge("g-brief", tr.counts.brief, total);
    HUD.setCounts(tr.counts);
    $("runs").textContent = `${tr.runs} RUN${tr.runs === 1 ? "" : "S"} · PRACTICE`;
    const al = $("alerts"); al.innerHTML = "";
    for (const it of tr.items.filter((i) => i.tier !== "brief")) {
      const g = tr.graded.get(it.id);
      const li = document.createElement("li");
      li.className = it.tier;
      li.innerHTML = `<div class="t">${it.tier.toUpperCase()} · ${esc(it.rule)}</div><div class="x">${esc(it.alert_text)}</div><div class="b">` +
        (it.link && it.link.startsWith("https://") ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">OPEN ↗</a>` : "") +
        (g ? `<button class="done" disabled>GRADED · ${esc(g.grade.toUpperCase())}${g.should_be ? " → " + esc(g.should_be.toUpperCase()) : ""}</button>`
           : `<button data-g="u">✓ USEFUL</button><button data-g="n">✗ NOISE</button><button data-g="${it.tier === "urgent" ? "dn" : "up"}">${it.tier === "urgent" ? "↓ LOWER" : "↑ URGENT"}</button>`) + "</div>";
      li.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", async () => {
        b.parentElement.querySelectorAll("button").forEach((x) => { x.disabled = true; });
        try { await Chloe.grade(tr.day, it, b.dataset.g); refresh(); } catch (e) { b.textContent = "RETRY"; b.disabled = false; }
      }));
      al.appendChild(li);
    }
    if (!al.children.length) al.innerHTML = '<li class="dim">No would-be alerts yet today.</li>';
    renderChecklist(await Chloe.checklist());
    $("conn").textContent = `synced ${Chloe.sgt().at.slice(11)}`;
  } catch (e) {
    $("conn").textContent = `offline (${e.message})`;
  }
}

// ---------- the live checklist (same list as the pinned Telegram message) ----------
const CL_TITLE = { urgent: "URGENT TODAY", reply: "WAITING FOR YOUR REPLY", owe: "YOU OWE", others: "WAITING ON OTHERS" };
function ageText(i) {
  const d = i.kind === "owe" ? i.due : i.since;
  if (!d) return "";
  const days = Math.round((Date.now() - new Date(d + "T00:00:00+08:00")) / 86400000);
  return i.kind === "owe" ? (days > 0 ? `${days} days late` : `due ${d.slice(5)}`) : (days > 0 ? `${days} days` : "");
}
function renderChecklist(c) {
  if (!c) { $("cl-list").innerHTML = '<li class="dim">The list appears after the next hourly run.</li>'; return; }
  for (const k of ["urgent", "reply", "owe", "others"]) $(`cl-${k}`).textContent = c.counts[k] || 0;
  $("cl-when").textContent = c.updated ? c.updated.slice(11) : "";
  let html = "", last = "";
  for (const i of c.items) {
    if (i.kind !== last) { html += `<li class="sec">${CL_TITLE[i.kind]}</li>`; last = i.kind; }
    const done = i.status !== "open";
    const main = i.kind === "urgent" ? i.what : `${i.who.split("(")[0].trim()} · ${i.what}`;
    html += `<li class="k-${i.kind}${done ? " done" : ""}" data-id="${esc(i.id)}"><span class="n">${i.n}</span>` +
      `<span class="t">${esc(main)}<i>${esc(done ? (i.evidence || "done") : [i.project, ageText(i)].filter(Boolean).join(" · "))}</i></span>` +
      `<button data-a="${done ? "undo" : "done"}" aria-label="${done ? "Put back" : "Mark done"}">${done ? "↺" : "✓"}</button></li>`;
  }
  $("cl-list").innerHTML = html || '<li class="dim">All clear.</li>';
  $("cl-list").querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
    const li = b.closest("li");
    b.disabled = true; b.textContent = "…";
    try {
      await Chloe.tick(li.dataset.id, b.dataset.a);
      li.classList.toggle("done", b.dataset.a === "done");
      b.dataset.a = b.dataset.a === "done" ? "undo" : "done";
      b.textContent = b.dataset.a === "done" ? "✓" : "↺";
    } catch { b.textContent = "!"; }
    b.disabled = false;
  }));
}

// ---------- input ----------
function startListening(prefix = "") {
  Speech.stop();
  if (listening) { listening.stop(); return; }
  setState("listening");
  listening = Speech.listen({
    onPartial: (t) => { $("cap-you").textContent = prefix + t; HUD.setLevel(0.05); },
    onFinal: (t) => { listening = null; HUD.setLevel(0); handle(prefix + t, true); },
    onEnd: () => { if (listening) { listening = null; setState("idle"); } HUD.setLevel(0); },
    onError: (err) => { listening = null; setState("idle"); $("cap-am").textContent = `Mic: ${err}`; },
  });
}
$("talk").addEventListener("click", () => { if (Speech.speaking) { Speech.stop(); setState("idle"); } else startListening(); });
$("q-urgent").addEventListener("click", () => handle("what's urgent", false));
$("q-brief").addEventListener("click", () => handle("brief", false));
$("q-note").addEventListener("click", () => startListening("note that "));
$("type-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("text").value; $("text").value = ""; handle(v, false); });

// ---------- settings ----------
function openSettings() { $("settings").classList.add("open"); $("settings").setAttribute("aria-hidden", "false"); }
function closeSettings() { $("settings").classList.remove("open"); $("settings").setAttribute("aria-hidden", "true"); }
$("open-settings").onclick = openSettings;
$("set-close").onclick = () => { closeSettings(); refresh(); };
$("pat-save").onclick = async () => {
  const v = $("pat").value.trim();
  if (v) GH.setKey(v);
  $("pat").value = "";
  $("pat-status").textContent = "testing…";
  try { await GH.test(); $("pat-status").textContent = "✓ connected to second-brain"; refresh(); }
  catch (e) { $("pat-status").textContent = `✗ ${e.message}`; }
};
$("pat-forget").onclick = () => { if (confirm("Remove the GitHub key from this phone?")) { GH.forget(); $("pat-status").textContent = "key removed"; refresh(); } };

// ---------- start ----------
setState("idle");
if (!GH.hasKey) openSettings();
refresh();
pollPending(false);
setInterval(refresh, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); pollPending(true); } });
