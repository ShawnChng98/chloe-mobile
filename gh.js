// Chloe Mobile: GitHub data layer. Talks only to api.github.com, with Shawn's fine-grained key (kept in this
// phone's storage, never sent anywhere else). Reads the private second-brain repo; writes only new notes,
// questions and grade lines, never edits memory files.
"use strict";

const GH = (() => {
  const API = "https://api.github.com/repos/ShawnChng98/second-brain";
  const KEY = "chloe.pat";
  let token = localStorage.getItem(KEY) || "";

  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
  const b64 = (s) => { const b = new TextEncoder().encode(s); let bin = ""; b.forEach((x) => { bin += String.fromCharCode(x); }); return btoa(bin); };
  const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

  async function req(method, path, body, raw = false) {
    if (!token) throw new Error("no key");
    const r = await fetch(`${API}/${path}`, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28",
        Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 404) return null;
    if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
    return raw ? r.text() : r.json();
  }

  return {
    get hasKey() { return !!token; },
    setKey(t) { token = t.trim(); localStorage.setItem(KEY, token); },
    forget() { token = ""; localStorage.removeItem(KEY); },
    async test() {                                         // can this key read and write second-brain?
      const repo = await req("GET", "");
      if (!repo) throw new Error("repo not visible to this key");
      if (!repo.permissions || !repo.permissions.push) throw new Error("key can read but not write");
      return true;
    },
    read: (path, ref = "main") => req("GET", `contents/${encPath(path)}?ref=${ref}`, null, true),
    list: (path, ref = "main") => req("GET", `contents/${encPath(path)}?ref=${ref}`),
    async create(path, text, message, branch = "main") {   // add a new file; refuses to overwrite
      return req("PUT", `contents/${encPath(path)}`, { message, content: b64(text), branch });
    },
    async append(path, line, message, branch) {            // add one line; retries if someone wrote meanwhile
      for (let i = 0; i < 4; i++) {
        const m = await req("GET", `contents/${encPath(path)}?ref=${branch}`);
        const old = m ? unb64(m.content) : "";
        const text = (old && !old.endsWith("\n") ? old + "\n" : old) + line.replace(/\n+$/, "") + "\n";
        try {
          return await req("PUT", `contents/${encPath(path)}`, { message, content: b64(text), branch, ...(m ? { sha: m.sha } : {}) });
        } catch (e) {
          if (![409, 422].includes(e.status)) throw e;
          await new Promise((r) => setTimeout(r, 600 * (i + 1)));
        }
      }
      throw new Error("GitHub busy, try again");
    },
  };
})();
