# ROBO SURVIVORS — Lessons Learned

A running log of corrections from the user. Every entry pairs a mistake with a rule to prevent it next time.

---

## 2026-05-27 — Guessing about portrait mode

**Mistake:** Claimed twin-stick games "play badly in portrait" and recommended landscape-only submission without testing. Made architectural assumptions about the touch HUD layout I had never verified.

**Reality:** Portrait mode actually works great — sticks at bottom, BOMB/DASH buttons on the right, playfield uses vertical space well.

**Rule:** Before making any claim about how the game looks or feels in any orientation, viewport, or input mode — **run Playwright with that exact viewport and screenshot it.** No exceptions, no guessing from intuition or first principles.

---

## 2026-05-27 — Mid-task deploys without QA or PR

**Mistake:** Throughout earlier sessions, committed directly to `main` and ran `deploy_website` without a PR, without showing QA evidence, and without asking before deploying.

**Rule:** Every feature gets a branch + PR. Every change gets Playwright QA. Every deploy gets confirmation from the user first. See CLAUDE.md "Non-Negotiable Working Rules".

---

## 2026-10-22 — Droplet web root is a public git checkout (discovery, not a correction)

**Finding:** `/var/www/robosurvivors` is a `git clone` of this repo and Nginx served *everything* in it: `/.git/`, `/.venv/`, `leaderboard.py`, `setup-leaderboard.sh`, `CLAUDE.md`, raw `scores.json`. Verified with curl from outside before the admin-portal work.

**Rule:** Never put databases, secrets, or env files under `/var/www/robosurvivors`. Server data lives in `/var/lib/robosurvivors/`, secrets in `/etc/robosurvivors/` (root-only). `deploy/nginx-hardening.conf` blocks dotfiles, server code, docs and data; any new server-side file type must be checked against it. The repo is public — never commit passwords or password hashes; they go in GitHub Actions secrets.

---

## 2026-10-22 — Deploy path: GitHub CLI from the cloud workspace (correction)

**Mistake:** After merge I handed the user an SSH command as part of the deploy path, then tried routing work through the DGX Spark. The user corrected: "use github cli as we always do" and "work on cloud from this computer not the spark".

**Rule:** Deploys run from the cloud workspace with `gh workflow run deploy.yml -R sallisonhome/robo-survivors --ref main`, then watch the run and read its log with `gh run view --log` — the same pattern as HMAP. Do not route work through the Spark or other local devices unless the user asks. If a one-time server bootstrap is unavoidable, say so *before* merge, give one QA'd paste-run command, and use the user's web console session.

## 2026-10-22 — The Droplet is shared (discovery)

**Finding:** 104.236.239.46 has the hostname `saber-apps-suite` and also serves the Saber Intelligence Suite (`http://104.236.239.46/`, `/signal/`). The default Nginx access log mixes all sites (the first backfill saw 3,736 non-Robo page loads).

**Rule:** Deploy changes must touch only the Nginx site whose `root` is `/var/www/robosurvivors` and only the `robo-leaderboard` service. After every deploy, check that `http://104.236.239.46/` and `/signal/` still return 200. Never reboot the server or restart Nginx/shared services as part of a Robo Survivors deploy (reload after `nginx -t` only).
