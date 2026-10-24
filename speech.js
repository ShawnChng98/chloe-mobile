// Chloe Mobile: speech in (the phone's own recogniser) and out (the phone's British voice).
// speakable() mirrors voice/tts.py on the laptop: dates, times, units, digit-by-digit project numbers.
"use strict";

const Speech = (() => {
  const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const SAY_AS_WORD = ["OK"];                               // all-caps words NOT to spell out letter by letter
  const digits = (s) => [...s].filter((c) => /\d/.test(c)).map((c) => DIGITS[+c]).join(" ");
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));

  function speakable(text) {
    let t = String(text || "").replace(/[*_`#>|]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    t = t.replace(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, (m, y, mo, d) => {
      const dt = new Date(+y, +mo - 1, +d);
      return isNaN(dt) ? m : `${DAYS[dt.getDay()]} the ${ord(+d)} of ${MONTHS[+mo - 1]}`;
    });
    t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mm) => {
      h = +h; if (h > 23) return m;
      const h12 = h % 12 || 12, ap = h < 12 ? "am" : "pm";
      return mm === "00" ? `${h12} ${ap}` : `${h12} ${mm} ${ap}`;
    });
    t = t.replace(/\bSTG-?SG(\d+)\b/gi, (m, n) => `S T G, S G, ${digits(n)}`);
    t = t.replace(/\b\d{5,}\b/g, (m) => digits(m));
    t = t.replace(/(\d)\s*(µm|μm)/g, "$1 microns").replace(/(\d)\s*Hz\b/g, "$1 hertz").replace(/(\d)\s*mm\b/g, "$1 millimetres")
      .replace(/(\d)\s*kg\b/g, "$1 kilograms").replace(/(\d)\s*%/g, "$1 percent").replace(/~\s*/g, "about ")
      .replace(/\bvs\.?\b/gi, "versus").replace(/&/g, " and ").replace(/→|->/g, " to ").replace(/\bSüss\b/g, "Suess");
    t = t.replace(/\b[A-Z]{2,4}\b/g, (a) => (SAY_AS_WORD.includes(a) ? a : a.split("").join(" ")));  // PID -> P I D
    t = t.replace(/\(\s*[\w./\\-]*\.(?:md|jsonl?|py|pdf)\s*\)/g, "").replace(/\(\s*\)/g, "");
    return t.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  }

  // ---- out: the phone's voice, British female if the phone has one ----
  let voices = [];
  const load = () => { voices = speechSynthesis.getVoices(); };
  if ("speechSynthesis" in window) { speechSynthesis.onvoiceschanged = load; load(); }
  function pick() {
    const gb = voices.filter((v) => /en[-_]GB/i.test(v.lang));
    return gb.find((v) => /female|libby|sonia|hazel|susan|amy|emma|kate|serena/i.test(v.name)) || gb[0]
      || voices.find((v) => /^en/i.test(v.lang)) || null;
  }
  let speaking = false;
  function speak(text, onLevel) {
    if (!("speechSynthesis" in window) || !text) return;
    stop();
    const parts = speakable(text).match(/[^.!?]+[.!?]*\s*/g) || [text];
    const v = pick();
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p.trim());
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-GB";
      u.rate = 1.0; u.pitch = 1.08;                                   // a touch brighter, like Chloe on the laptop
      u.onboundary = () => onLevel && onLevel(1);
      if (i === 0) u.onstart = () => { speaking = true; };
      if (i === parts.length - 1) u.onend = u.onerror = () => { speaking = false; onLevel && onLevel(0); };
      speechSynthesis.speak(u);
    });
  }
  function stop() { if ("speechSynthesis" in window) speechSynthesis.cancel(); speaking = false; }

  // ---- in: the phone's recogniser (on Android this is Google's, like keyboard voice typing) ----
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listen({ onPartial, onFinal, onEnd, onError }) {
    if (!Rec) { onError && onError("This browser has no speech recognition; type instead."); return null; }
    const r = new Rec();
    r.lang = "en-SG"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let text = "", final = false;
      for (const res of e.results) { text += res[0].transcript; final = final || res.isFinal; }
      (final ? onFinal : onPartial)?.(text.trim());
    };
    r.onerror = (e) => onError && onError(e.error);
    r.onend = () => onEnd && onEnd();
    r.start();
    return r;
  }

  return { speakable, speak, stop, listen, get speaking() { return speaking; }, available: !!Rec };
})();
