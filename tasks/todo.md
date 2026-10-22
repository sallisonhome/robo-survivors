# Admin portal (feat/admin-portal) — 2026-10-22

Requested: admin portal on robosurvivors.com for visits, sessions and engagement KPIs; password supplied by user.
Decisions (user): anonymous localStorage visitor id = yes · backfill from Nginx logs = yes · deploy via GitHub CLI.

- [x] Verify live site == repo main (game.js md5 match), map hook points in game.js
- [x] analytics.py: /api/events ingest, admin login/logout/me, /api/admin/stats (SQLite outside web root)
- [x] game.js Analytics module: visit, session_start, heartbeat(30s), run_start(input), run_end(reason/score/wave/level/secs), hs_submit; live-domain only, opt-out flag
- [x] Title-screen disclosure line
- [x] admin/index.html dashboard (24h/7d/30d/all, KPIs, trend, wave distribution, breakdowns, log history)
- [x] deploy/backfill_nginx_logs.py (bot + other-site filtering, idempotent, hashed visitors)
- [x] deploy/deploy.sh + robo-deploy + nginx-hardening.conf + .github/workflows/deploy.yml (manual dispatch)
- [x] Local QA: Playwright desktop / mobile portrait / mobile landscape, auth, lockout, KPI-vs-SQL, real nginx config test
- [ ] User approves → push + PR, set repo secrets
- [ ] User merges → one-time Droplet setup → `gh workflow run deploy.yml` → live verification

## Review
QA evidence is in the PR description.
