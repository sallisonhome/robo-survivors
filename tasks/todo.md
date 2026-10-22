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
- [x] User approves → push + PR #1, set repo secrets
- [x] Merged (e4eb94a) → one-time key install via web console → `gh workflow run deploy.yml` (run 39836809024) → live verification

## Review
- Deploy run 39836809024: success. 9 server checks + external checks passed. Backfill imported 154 page views (Oct 8–22), with 31,103 bot lines and 3,736 other-site page loads excluded.
- Live: game.js matches main; the game plays and quits normally; /api/events returns 200; /admin login works on desktop + mobile; cookie is Secure, HttpOnly and SameSite=Strict; logout returns 401.
- Hardening live: /.git, /.venv, setup script, scores.json return 404; the leaderboard still has 200 scores; Saber suite / and /signal/ return 200.
- First recorded in-game visit (Oct 22, 3:04 PM ET) is QA traffic from the cloud workspace.
