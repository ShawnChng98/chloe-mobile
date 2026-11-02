// Chloe Mobile: what Chloe knows and does (mirrors voice/answers.py and voice/inbox.py on the laptop).
// Code answers "brief" and "what's urgent"; notes go to the shared inbox; anything else is a question that the
// laptop (when on, ~15 s) or the hourly cloud watcher answers through asks/ and answers/ on the agent-manager branch.
"use strict";

const Chloe = (() => {
  const AM = "agent-manager";
  const p2 = (n) => String(n).padStart(2, "0");
  function sgt(d = new Date()) {                              // Singapore time, whatever the phone's zone
    const t = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
    return { date: `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`, hm: `${p2(t.getHours())}${p2(t.getMinutes())}`,
      at: `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())} ${p2(t.getHours())}:${p2(t.getMinutes())}`, t };
  }
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function itemKey(id) {                                // = sha1(id)[:10], same as the laptop and the cloud
    const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(id));
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
  }

  // ---- triage (what the hourly watcher would alert) ----
  async function triage() {
    const day = sgt().date;
    const text = await GH.read(`triage/${day}.jsonl`, AM) || "";
    const recs = text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const items = recs.filter((r) => r.type === "item");
    const graded = new Map();
    const gtext = await GH.read(`grades/${day}.jsonl`, AM) || "";
    gtext.split("\n").filter((l) => l.trim()).forEach((l) => { try { const g = JSON.parse(l); if (g.id) graded.set(g.id, g); } catch { /* skip */ } });
    return { day, items, graded, runs: recs.filter((r) => r.type === "run").length,
      counts: ["urgent", "attention", "brief"].reduce((o, k) => ({ ...o, [k]: items.filter((i) => i.tier === k).length }), {}) };
  }
  async function grade(day, item, code) {
    const map = { u: ["useful", null], n: ["noise", null], up: ["useful", "urgent"], dn: ["useful", "attention"], br: ["noise", "brief"] };
    const [g, should] = map[code];
    const rec = { id: item.id, grade: g, should_be: should, via: "phone", at: sgt().at };
    await GH.append(`grades/${day}.jsonl`, JSON.stringify(rec), `grade: ${g} via phone (Agent Manager)`, AM);
    return rec;
  }

  // ---- the live checklist (built hourly in the cloud, ticks from anywhere) ----
  async function checklist() {
    const t = await GH.read("checklist.json", AM);
    return t ? JSON.parse(t) : null;
  }
  async function tick(id, action) {
    const rec = { id, action, by: "shawn", at: sgt().at, evidence: "ticked by Shawn (phone)" };
    await GH.append(`closures/${sgt().date}.jsonl`, JSON.stringify(rec), `checklist: ${action} by Shawn (phone)`, AM);
    return rec;
  }

  // ---- commitments (Second Brain) ----
  async function commitments() {
    const md = await GH.read("commitments.md") || "";
    let section = "";
    const today = sgt().date, rows = [];
    for (const line of md.split("\n")) {
      if (line.startsWith("## ")) section = line.slice(3).trim().toLowerCase();
      if (section !== "i owe" || !line.startsWith("| [ ]")) continue;
      const c = line.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      if (c.length < 5) continue;
      const due = (c[3].replace(/since\s+\d{4}-\d{2}-\d{2}/i, "").match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
      rows.push({ what: c[1].replace(/\*\*/g, ""), to: c[2], due, project: c[4] });
    }
    const overdue = rows.filter((r) => r.due && r.due < today).sort((a, b) => a.due.localeCompare(b.due));
    const next = rows.filter((r) => r.due && r.due >= today).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3);
    return { open: rows.length, overdue, next, today };
  }

  // ---- brief (Second Brain daily note, "## Brief") ----
  async function brief() {
    const files = (await GH.list("daily") || []).map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort();
    for (const name of files.reverse()) {
      const md = await GH.read(`daily/${name}`) || "";
      const m = md.match(/^## Brief[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
      if (m && m[1].trim()) return { date: name.slice(0, 10), text: m[1].trim() };
    }
    return null;
  }

  // ---- notes (shared inbox on main; the Second Brain files them) ----
  const NOTE_RE = /^\W*(?:please\W+)?(note that|note:|make a note(?: that)?|take a note(?: that)?|remember that|for the record|remind me(?: to)?|correction:?|correct that|correct this)\W*([\s\S]*)$/i;
  function noteCommand(text) {
    const m = text.trim().match(NOTE_RE);
    if (!m || m[2].trim().split(/\s+/).length < 2) return null;
    const trig = m[1].toLowerCase();
    const kind = trig.startsWith("remind") ? "remind" : trig.startsWith("correct") ? "correct" : "note";
    return { kind, words: kind === "remind" ? text.trim() : m[2].trim() };
  }
  async function fileNote(kind, words) {
    const s = sgt(), nid = `${s.date}_${s.hm}_phone_${hex(2)}`;
    const body = ["---", `id: ${nid}`, `at: ${s.at}`, "from: phone", `kind: ${kind}`, "project: ", "status: new", "---", "", words, ""].join("\n");
    await GH.create(`inbox/${nid}.md`, body, `inbox: ${kind} from phone (Agent Manager)`);
    return nid;
  }

  // ---- questions (answered by the laptop or the hourly cloud watcher) ----
  async function ask(text, voice) {
    const s = sgt(), id = `${s.date}_${s.hm}_${hex(3)}`;
    const body = JSON.stringify({ id, at: s.at, from: "phone", voice: !!voice, text }) + "\n";
    await GH.create(`asks/${id}.json`, body, "ask from phone (Agent Manager)", AM);
    return id;
  }
  async function answer(id) {
    const t = await GH.read(`answers/${id}.json`, AM);
    return t ? JSON.parse(t) : null;
  }

  // ---- routing ----
  const BRIEF = ["brief", "briefing", "morning summary"];
  const URGENT = ["urgent", "needs me", "need me", "what's waiting", "anything for me", "what's on fire"];
  function route(text) {
    const t = text.toLowerCase();
    if (noteCommand(text)) return "note";
    if (t.length < 60 && BRIEF.some((w) => t.includes(w))) return "brief";
    if (t.length < 60 && URGENT.some((w) => t.includes(w))) return "urgent";
    return "ask";
  }
  function urgentSpoken(tr, cm) {
    const u = tr.counts.urgent, a = tr.counts.attention, od = cm.overdue.length;
    let s = u ? `${u === 1 ? "One thing is" : `${u} things are`} urgent today${a ? `, and ${a} more need${a === 1 ? "s" : ""} a look.` : "."}`
      : a ? `Nothing urgent, but ${a === 1 ? "one thing needs" : `${a} things need`} a look today.` : "Nothing urgent today.";
    if (od) s += ` ${od === 1 ? "One of your commitments is" : `${od} of your commitments are`} overdue, though.`;
    return s;
  }

  return { sgt, itemKey, triage, grade, commitments, brief, noteCommand, fileNote, ask, answer, route, urgentSpoken,
    checklist, tick };
})();
