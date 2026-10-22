<!-- BEGIN PROJECT NON-NEGOTIABLES -->

## ROBO SURVIVORS — Non-Negotiable Working Rules

These rules apply to ROBO SURVIVORS and every related build (web, CrazyGames, Steam). They override anything below if there's ever a conflict. Established 2026-05-27.

### 1. Never Guess About the App
- Before stating how anything in the game works, **verify** by reading the relevant code, running it, or asking.
- Do not infer behavior from filenames, function names, or screenshots alone.
- If unsure, say "let me check" — then check.

### 2. QA Every Change Before Deploying
- Every code change must be validated with **Playwright** (or appropriate testing) before any deploy or push.
- Mobile changes must be tested in mobile viewport with touch events, not just desktop.
- Take screenshots and visually verify state transitions — don't trust that "it should work."

### 3. PRs Per Feature, Never Direct to `main`
- Each new feature gets its own branch and PR. Do not commit features directly to `main`.
- Bug fixes for live issues may go to a `fix/` branch and merge via PR.
- I (the user) review and merge the PR after Computer presents the QA evidence.

### 4. Confirm Deploys and Significant Changes
- Before deploying to the preview site, pushing to GitHub, or telling me to update the Droplet: **confirm with me first**.
- Show me a summary of what changed and the QA evidence, then wait for approval.
- Exception: trivial doc/comment edits or rolling back a clearly-broken change.

### 5. Self-Improvement
- After any correction from me, log the pattern in `tasks/lessons.md` and (if it's a permanent rule) update this CLAUDE.md.
- Review this file at session start for ROBO SURVIVORS work.

### 6. Deploying robosurvivors.com
- Deploy only after the user approves and the PR is merged, from the cloud workspace: `gh workflow run deploy.yml -R sallisonhome/robo-survivors --ref main`, then watch the run and read its log with `gh run view <id> -R sallisonhome/robo-survivors --log`.
- The deploy key can only run `/usr/local/sbin/robo-deploy` (git pull, then `deploy/deploy.sh`), which auto-rolls back on failure.
- The Droplet (104.236.239.46, `saber-apps-suite`) is shared with the Saber Intelligence Suite: touch only the robosurvivors Nginx site and the `robo-leaderboard` service, and re-check `http://104.236.239.46/` + `/signal/` after deploys.
- Admin portal: `https://robosurvivors.com/admin/`. Password hash is in the `ADMIN_PASSWORD_HASH` GitHub secret only — never in the repo.

<!-- END PROJECT NON-NEGOTIABLES -->

<!-- BEGIN PRINCIPLES PROMPT COPY -->

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately – don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes – don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests – then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

### 7. QA Before Commit/Deploy (always-on, all projects)
- **Run every applicable QA gate before asking the user to commit, push, deploy, merge, or otherwise make a change permanent.** This rule supersedes any contrary instruction in a single session.
- "QA gate" means whatever is appropriate for the file types changed: `npm run build`, `tsc --noEmit`, `nginx -t`, `python -m py_compile`, `pytest`, ESLint, JSX parse, schema migrations dry-run, smoke tests against staging, or — at minimum — a manual diff review confirming intent.
- Confirm SEO/copy/content edits match the **actual current behavior** of the page or feature, not a stale spec or placeholder. Read the live page (or the rendered component) when the copy describes user-visible behavior.
- Check for stray conflict markers (`<<<<<<<`, `>>>>>>>`, `=======`) outside of `node_modules`/`dist`.
- Verify imports/exports/types remain consistent (e.g. dropped `useEffect` import when refactoring to `<SEOHead>`).
- If a QA check cannot be run in the current environment (no nginx binary, no docker, no test DB, etc.), **explicitly state which check was skipped and why**. Do not silently treat "couldn't run" as "passed."
- Never say "ready to commit", "looks good, push it", or generate a commit/deploy command until every applicable gate has either passed or been explicitly skipped with a reason.


### 8. No Placeholder Commands — QA'd Commands Only (always-on, all projects)
- **Never give the user commands that contain placeholders requiring manual substitution.** Examples of forbidden placeholders: `/path/to/project`, `<your-domain>`, `your-server`, `<container-name>`, `<branch>`, `your-key.pem`, `REPLACE_ME`, `...`, etc.
- Before issuing any shell, deploy, or operational command, **look up the actual values first** — from this CLAUDE.md, the repo (compose files, workflows, scripts, READMEs), memory, prior session context, connected services, or live inspection of the server. If a value isn't available, find it before producing the command.
- Every command you give must be **paste-and-run executable verbatim** on the user's machine or server, with no fill-in-the-blanks step.
- If a required value genuinely cannot be obtained, **stop and ask one targeted question for that specific value** — do not paper over it with a placeholder.
- This rule applies on top of (not instead of) the §7 QA-Before-Commit/Deploy gate: commands must be both correct and QA'd before being handed to the user.

## Task Management
1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

<!-- END PRINCIPLES PROMPT COPY -->
---

## Canonical Principles

The canonical truth-and-accuracy, QA, and command-execution rules for this repo live in [`PRINCIPLES.md`](./PRINCIPLES.md). When in doubt, that file is the source of truth. Priority order on conflict: **Truth > QA > Style.**

The sections above contain project-specific operational details that remain in effect alongside `PRINCIPLES.md`.
