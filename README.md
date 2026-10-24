# Chloe Mobile

Phone front end for **Agent Manager / Chloe**, Shawn Chng's work coordinator. A static web app (installable to the
home screen) served by GitHub Pages.

**This repository holds code only.** It contains no work data. Everything the app shows is read at run time from a
private repository with a GitHub key that the owner stores on his own phone. Without that key the app does nothing.

- Talks only to `api.github.com` (Content-Security-Policy `connect-src https://api.github.com`).
- Writes only new files: notes to the shared inbox, questions, grade lines. Never edits or deletes anything.
- Questions are answered by Chloe on the owner's laptop (seconds) or by an hourly cloud run.

Master copy: `C:\CLAUDE\Agent Manager\mobile` on the owner's laptop.
