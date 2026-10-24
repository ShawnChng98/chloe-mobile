// Agent Manager Voice: the reactor (canvas 2D, no libraries).
// Rings carry real data: the segmented ring is today's urgent / attention / brief share; the radial bars are the
// last ~3 s of mic level (listening) or speech energy (speaking); the scanner sweeps while transcribing / thinking.
"use strict";

const HUD = (() => {
  const cv = document.getElementById("reactor");
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COL = {
    idle: [79, 216, 255], listening: [255, 77, 77], transcribing: [255, 179, 71], thinking: [255, 179, 71],
    speaking: [150, 236, 255],
  };
  const AMBER = "255,179,71", RED = "255,77,77", CYAN = "79,216,255";
  const LABEL = " AGENT MANAGER · VOICE · TRIAGE · DISPATCH · SECOND BRAIN ·";
  let W = 0, H = 0, R = 0, dpr = 1;
  const noBoot = reduce || new URLSearchParams(location.search).has("noboot");
  let state = "idle", level = 0, energy = 0, speakE = 0, voiceLvl = 0, boot = noBoot ? 1 : 0;
  let col = COL.idle.slice();
  let counts = { urgent: 0, attention: 0, brief: 0 };
  const hist = new Array(96).fill(0);
  let last = performance.now(), histT = 0, t = 0;

  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    R = Math.min(W, H - 56) / 2 * 0.94;                 // leave room under the ring for the state label
    cv.parentElement.style.setProperty("--r", `${R}px`);
    cv.parentElement.style.setProperty("--cy", `${(H - 56) / 2}px`);
  }
  new ResizeObserver(resize).observe(cv);

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const lerp = (a, b, k) => a + (b - a) * k;

  function arc(r, a0, a1, width, style, glow = 0) {
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.lineWidth = width; ctx.strokeStyle = style;
    ctx.shadowBlur = glow; ctx.shadowColor = style;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function ticks(r, n, rot, a) {
    ctx.save(); ctx.rotate(rot);
    for (let i = 0; i < n * boot; i++) {
      const long = i % 5 === 0, ang = (i / n) * Math.PI * 2;
      const r0 = r - (long ? R * 0.035 : R * 0.018);
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
      ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
      ctx.lineWidth = long ? 1.6 : 1; ctx.strokeStyle = rgba(col, long ? a : a * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  function curvedText(text, r, rot, a) {
    ctx.save(); ctx.rotate(rot);
    ctx.font = `600 ${Math.max(9, R * 0.032)}px Bahnschrift, "Segoe UI", sans-serif`;
    ctx.fillStyle = rgba(col, a); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const step = (Math.PI * 2) / text.length;
    for (let i = 0; i < text.length * boot; i++) {
      ctx.save(); ctx.rotate(i * step); ctx.translate(0, -r); ctx.fillText(text[i], 0, 0); ctx.restore();
    }
    ctx.restore();
  }

  function dataRing(r, rot) {
    // urgent / attention / brief as arcs on one ring; an empty day draws a calm dashed ring
    const total = counts.urgent + counts.attention + counts.brief;
    ctx.save(); ctx.rotate(rot);
    const full = Math.PI * 2 * boot, gap = 0.05;
    if (!total) {
      ctx.setLineDash([R * 0.02, R * 0.03]);
      arc(r, 0, full, R * 0.022, rgba(col, 0.28));
      ctx.setLineDash([]);
    } else {
      let a = 0;
      for (const [k, c] of [["urgent", RED], ["attention", AMBER], ["brief", CYAN]]) {
        if (!counts[k]) continue;
        const span = full * counts[k] / total;
        arc(r, a + gap / 2, a + span - gap / 2, R * 0.03, `rgba(${c},0.9)`, 10);
        a += span;
      }
    }
    ctx.restore();
  }

  function levelBars(r0, rot) {
    ctx.save(); ctx.rotate(rot);
    const n = hist.length;
    for (let i = 0; i < n * boot; i++) {
      const v = hist[(i + n) % n];
      const ang = (i / n) * Math.PI * 2;
      const len = R * (0.012 + v * 0.16);
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
      ctx.lineTo(Math.cos(ang) * (r0 + len), Math.sin(ang) * (r0 + len));
      ctx.lineWidth = Math.max(1.5, R * 0.011); ctx.lineCap = "round";
      ctx.strokeStyle = rgba(col, 0.35 + v * 0.65);
      ctx.stroke();
    }
    ctx.restore();
  }

  function scanner(r, rot) {
    const g = ctx.createConicGradient ? ctx.createConicGradient(rot, 0, 0) : null;
    if (!g) return;
    g.addColorStop(0, rgba(col, 0.32)); g.addColorStop(0.12, rgba(col, 0)); g.addColorStop(1, rgba(col, 0));
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  }

  function coils(r0, r1, rot, a) {
    // the classic reactor: ten trapezoid coils round the core
    ctx.save(); ctx.rotate(rot);
    const n = 10, w0 = 0.16, w1 = 0.11;
    for (let i = 0; i < n * boot; i++) {
      const c = (i / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(c - w0) * r0, Math.sin(c - w0) * r0);
      ctx.lineTo(Math.cos(c - w1) * r1, Math.sin(c - w1) * r1);
      ctx.lineTo(Math.cos(c + w1) * r1, Math.sin(c + w1) * r1);
      ctx.lineTo(Math.cos(c + w0) * r0, Math.sin(c + w0) * r0);
      ctx.closePath();
      ctx.fillStyle = rgba(col, a * 0.16); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(col, a); ctx.stroke();
    }
    ctx.restore();
  }

  function core(r, e) {
    const rr = r * (1 + e * 0.55);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr * 1.9);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.28, rgba(col, 0.95));
    g.addColorStop(0.55, rgba(col, 0.28));
    g.addColorStop(1, rgba(col, 0));
    ctx.beginPath(); ctx.arc(0, 0, rr * 1.9, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    arc(rr, 0, Math.PI * 2, 2, rgba([255, 255, 255], 0.9), 24);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += reduce ? 0 : dt;
    if (boot < 1) boot = Math.min(1, boot + dt / 1.2);
    const target = COL[state] || COL.idle;
    for (let i = 0; i < 3; i++) col[i] = lerp(col[i], target[i], 0.08);

    speakE *= Math.pow(0.04, dt);                       // word pulses decay in about a second
    const breathe = 0.06 + 0.035 * Math.sin(t * 1.6);
    const goal = state === "listening" ? Math.min(1, level * 14)
      : state === "speaking" ? (voiceLvl > 0.002 ? Math.min(1, 0.15 + voiceLvl * 7) : 0.2 + speakE * 0.6)
      : state === "idle" ? breathe : 0.22 + 0.08 * Math.sin(t * 5);
    energy = lerp(energy, goal, 0.18);
    histT += dt;
    if (histT > 0.03) { histT = 0; hist.push(state === "idle" ? breathe * 0.5 : energy); hist.shift(); }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!R) { requestAnimationFrame(frame); return; }
    ctx.translate(W / 2, (H - 56) / 2);
    ctx.globalAlpha = 0.25 + 0.75 * boot;

    const spin = (s) => t * s;
    arc(R, 0, Math.PI * 2 * boot, 1, rgba(col, 0.35));
    ticks(R * 0.985, 120, spin(0.02), 0.75);
    dataRing(R * 0.9, spin(-0.06));
    ctx.save(); ctx.rotate(spin(0.18)); ctx.setLineDash([R * 0.05, R * 0.025]);
    arc(R * 0.83, 0, Math.PI * 2 * boot, 2, rgba(col, 0.55)); ctx.setLineDash([]); ctx.restore();
    arc(R * 0.79, spin(-0.4), spin(-0.4) + Math.PI * 0.35 * boot, 3, `rgba(${AMBER},0.85)`, 8);
    arc(R * 0.79, spin(-0.4) + Math.PI, spin(-0.4) + Math.PI * (1 + 0.18 * boot), 3, `rgba(${AMBER},0.6)`, 6);
    curvedText(LABEL, R * 0.735, spin(0.03), 0.6);
    arc(R * 0.69, 0, Math.PI * 2 * boot, 1, rgba(col, 0.3));
    if (state === "transcribing" || state === "thinking") scanner(R * 0.69, spin(2.6));
    levelBars(R * 0.47, spin(0.05));
    arc(R * 0.44, 0, Math.PI * 2 * boot, 1.5, rgba(col, 0.6));
    coils(R * 0.27, R * 0.42, spin(-0.12), 0.85);
    arc(R * 0.26, 0, Math.PI * 2 * boot, 2, rgba(col, 0.8), 14);
    core(R * 0.13, energy);

    if (state === "listening") {                         // unmistakable MIC LIVE ring
      arc(R * 1.0, 0, Math.PI * 2, 3, `rgba(${RED},${0.55 + 0.45 * Math.abs(Math.sin(t * 4))})`, 18);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setState(s) { state = s; },
    setLevel(l) { level = l; },
    pulse() { speakE = 1; },
    setVoice(l) { voiceLvl = l; },
    setCounts(c) { counts = { urgent: c.urgent || 0, attention: c.attention || 0, brief: c.brief || 0 }; },
    get state() { return state; },
  };
})();
