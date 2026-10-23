"""
ROBO SURVIVORS — First-party analytics + admin API.

Mounted into the existing leaderboard FastAPI app (see leaderboard.py).

Public:
  POST /api/events              batched gameplay events from game.js (text/plain JSON body)

Admin (cookie session, password login):
  POST /api/admin/login         {"password": "..."} -> sets HttpOnly session cookie
  POST /api/admin/logout
  GET  /api/admin/me
  GET  /api/admin/stats?range=24h|7d|30d|all

Storage: SQLite at $RS_ANALYTICS_DB (default /var/lib/robosurvivors/analytics.db),
deliberately OUTSIDE the Nginx web root. The admin password is never stored in the
repo: $RS_ADMIN_PASSWORD_HASH holds a PBKDF2-SHA256 hash written by the deploy job.

Privacy: no cookies for players, no IP storage, no fingerprinting. A random anonymous
visitor id (localStorage) and per-tab session id are generated client-side.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response

DB_PATH = os.environ.get("RS_ANALYTICS_DB", "/var/lib/robosurvivors/analytics.db")
ADMIN_HASH = os.environ.get("RS_ADMIN_PASSWORD_HASH", "")
COOKIE_SECURE = os.environ.get("RS_COOKIE_SECURE", "1") != "0"
try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:  # tzdata missing: fall back to fixed Eastern Standard offset rather than crash
    TZ = timezone(timedelta(hours=-5))

COOKIE_NAME = "rs_admin"
SESSION_TTL_S = 12 * 3600
LOCKOUT_MAX_FAILS = 5
LOCKOUT_WINDOW_S = 15 * 60

EVENT_TYPES = {"visit", "session_start", "heartbeat", "run_start", "run_end", "hs_submit"}
ID_RE = re.compile(r"^[a-z0-9]{8,40}$")
MAX_BODY = 16_000
MAX_EVENTS_PER_BATCH = 40

router = APIRouter()


# ---------------------------------------------------------------- storage

def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    if os.path.dirname(DB_PATH):
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY,
              ts INTEGER NOT NULL,          -- server-adjusted epoch ms
              type TEXT NOT NULL,
              vid TEXT NOT NULL,
              sid TEXT NOT NULL,
              device TEXT, orient TEXT, ref TEXT,
              data TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_events_ts ON events(ts);
            CREATE INDEX IF NOT EXISTS ix_events_vid ON events(vid);

            -- Historical page views imported from Nginx access logs
            CREATE TABLE IF NOT EXISTS nginx_hits (
              line_hash TEXT PRIMARY KEY,
              ts INTEGER NOT NULL,
              visitor_hash TEXT NOT NULL,   -- salted hash of ip+ua+day, raw IP never stored
              path TEXT, status INTEGER, ref TEXT, device TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_nginx_ts ON nginx_hits(ts);

            CREATE TABLE IF NOT EXISTS admin_sessions (
              token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_failures (
              ip TEXT NOT NULL, ts INTEGER NOT NULL
            );
            """
        )


init_db()


# ---------------------------------------------------------------- ingestion

def _clean_ref(ref):
    if not isinstance(ref, str) or not ref:
        return ""
    m = re.match(r"^https?://([^/:?#]+)", ref.strip().lower())
    if not m:
        return ""
    host = m.group(1)
    host = host[4:] if host.startswith("www.") else host
    if host in ("robosurvivors.com", "robosurvivors.org"):
        return ""  # internal navigation is not a referrer
    return host[:80]


def _num(v, lo=0, hi=10**9):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return None
    return max(lo, min(hi, v))


def _clean_data(etype, d):
    d = d if isinstance(d, dict) else {}
    out = {}
    if etype == "run_end":
        for k, hi in (("score", 999_999_999), ("wave", 10_000), ("level", 1_000),
                      ("secs", 86_400), ("kills", 10**7), ("rescues", 10**6)):
            n = _num(d.get(k), 0, hi)
            if n is not None:
                out[k] = n
        r = d.get("reason")
        out["reason"] = r if r in ("death", "humans_lost", "quit", "abandon") else "unknown"
    elif etype == "run_start":
        inp = d.get("input")
        out["input"] = inp if inp in ("touch", "gamepad", "keyboard") else "unknown"
    elif etype == "heartbeat":
        out["playing"] = bool(d.get("playing"))
    elif etype == "hs_submit":
        for k in ("score", "wave"):
            n = _num(d.get(k), 0, 999_999_999)
            if n is not None:
                out[k] = n
    elif etype == "visit":
        out["returning"] = bool(d.get("returning"))
    return json.dumps(out, separators=(",", ":"))


@router.post("/api/events")
async def ingest(request: Request):
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "bad json")
    vid, sid = body.get("vid"), body.get("sid")
    if not (isinstance(vid, str) and ID_RE.match(vid) and isinstance(sid, str) and ID_RE.match(sid)):
        raise HTTPException(400, "bad ids")
    device = body.get("device") if body.get("device") in ("mobile", "tablet", "desktop") else "unknown"
    orient = body.get("orient") if body.get("orient") in ("portrait", "landscape") else "unknown"
    ref = _clean_ref(body.get("ref"))
    events = body.get("events")
    if not isinstance(events, list):
        raise HTTPException(400, "bad events")
    now = int(time.time() * 1000)
    rows = []
    for e in events[:MAX_EVENTS_PER_BATCH]:
        if not isinstance(e, dict) or e.get("type") not in EVENT_TYPES:
            continue
        age = _num(e.get("age"), 0, 120_000) or 0  # how long ago the client queued it
        rows.append((now - age, e["type"], vid, sid, device, orient,
                     ref if e["type"] == "visit" else "", _clean_data(e["type"], e.get("d"))))
    if rows:
        with db() as c:
            c.executemany(
                "INSERT INTO events(ts,type,vid,sid,device,orient,ref,data) VALUES (?,?,?,?,?,?,?,?)",
                rows,
            )
    return {"ok": True, "stored": len(rows)}


# ---------------------------------------------------------------- admin auth

def hash_password(password, salt=None, iterations=240_000):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${dk.hex()}"


def verify_password(password, stored):
    try:
        algo, iters, salt, hexdigest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(dk.hex(), hexdigest)
    except (ValueError, AttributeError):
        return False


def _client_ip(request: Request):
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "?")


def _tok_hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def require_admin(request: Request):
    tok = request.cookies.get(COOKIE_NAME)
    if not tok:
        raise HTTPException(401, "not logged in")
    with db() as c:
        row = c.execute("SELECT expires FROM admin_sessions WHERE token_hash=?", (_tok_hash(tok),)).fetchone()
    if not row or row["expires"] < time.time():
        raise HTTPException(401, "session expired")


@router.post("/api/admin/login")
async def login(request: Request, response: Response):
    ip = _client_ip(request)
    now = int(time.time())
    with db() as c:
        c.execute("DELETE FROM login_failures WHERE ts < ?", (now - LOCKOUT_WINDOW_S,))
        fails = c.execute("SELECT COUNT(*) FROM login_failures WHERE ip=?", (ip,)).fetchone()[0]
    if fails >= LOCKOUT_MAX_FAILS:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        body = {}
    pw = body.get("password") if isinstance(body.get("password"), str) else ""
    if not ADMIN_HASH or not verify_password(pw, ADMIN_HASH):
        with db() as c:
            c.execute("INSERT INTO login_failures(ip,ts) VALUES (?,?)", (ip, now))
        raise HTTPException(401, f"Wrong password ({LOCKOUT_MAX_FAILS - fails - 1} attempts left)")
    tok = secrets.token_urlsafe(32)
    with db() as c:
        c.execute("DELETE FROM admin_sessions WHERE expires < ?", (now,))
        c.execute("DELETE FROM login_failures WHERE ip=?", (ip,))
        c.execute("INSERT INTO admin_sessions VALUES (?,?)", (_tok_hash(tok), now + SESSION_TTL_S))
    response.set_cookie(COOKIE_NAME, tok, max_age=SESSION_TTL_S, httponly=True,
                        secure=COOKIE_SECURE, samesite="strict", path="/api/admin")
    return {"ok": True}


@router.post("/api/admin/logout")
def logout(request: Request, response: Response):
    tok = request.cookies.get(COOKIE_NAME)
    if tok:
        with db() as c:
            c.execute("DELETE FROM admin_sessions WHERE token_hash=?", (_tok_hash(tok),))
    response.delete_cookie(COOKIE_NAME, path="/api/admin")
    return {"ok": True}


@router.get("/api/admin/me")
def me(request: Request):
    require_admin(request)
    return {"ok": True}


# ---------------------------------------------------------------- KPIs

RANGES = {"24h": 1, "7d": 7, "30d": 30, "all": None}
SESSION_GAP_MS = 30 * 60 * 1000


def _day(ts_ms):
    return datetime.fromtimestamp(ts_ms / 1000, TZ).date()


def _median(xs):
    xs = sorted(xs)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def compute_stats(range_key, now_ms=None):
    now_ms = now_ms or int(time.time() * 1000)
    days = RANGES[range_key]
    start_ms = now_ms - days * 86_400_000 if days else 0

    with db() as c:
        rows = c.execute(
            "SELECT ts,type,vid,sid,device,orient,ref,data FROM events WHERE ts>=? ORDER BY ts",
            (start_ms,),
        ).fetchall()
        first_seen = {r["vid"]: r["f"] for r in c.execute(
            "SELECT vid, MIN(ts) AS f FROM events GROUP BY vid").fetchall()}
        # visitor -> set of active days (all time, for retention)
        vday_rows = c.execute("SELECT vid, ts FROM events WHERE type IN ('visit','session_start','run_start')").fetchall()
        nginx = c.execute(
            "SELECT ts, visitor_hash, ref, device FROM nginx_hits WHERE ts>=? ORDER BY ts", (start_ms,)
        ).fetchall()
        nginx_bounds = c.execute("SELECT MIN(ts), MAX(ts), COUNT(*) FROM nginx_hits").fetchone()
        tracking_start = c.execute("SELECT MIN(ts) FROM events").fetchone()[0]

    # ---- sessions
    sess = {}
    visits = 0
    visitors = set()
    device_c, orient_c, ref_c, input_c, reason_c = Counter(), Counter(), Counter(), Counter(), Counter()
    runs = []
    run_starts = 0
    hs_submits = 0
    daily = defaultdict(lambda: {"visits": 0, "visitors": set(), "sessions": set(), "runs": 0, "new": set()})

    for r in rows:
        ts, typ, vid, sid = r["ts"], r["type"], r["vid"], r["sid"]
        d = json.loads(r["data"] or "{}")
        day = _day(ts).isoformat()
        visitors.add(vid)
        s = sess.setdefault(sid, {"vid": vid, "start": ts, "end": ts, "runs": 0, "device": r["device"]})
        s["end"] = max(s["end"], ts)
        daily[day]["visitors"].add(vid)
        daily[day]["sessions"].add(sid)
        if first_seen.get(vid) is not None and _day(first_seen[vid]).isoformat() == day:
            daily[day]["new"].add(vid)
        if typ == "visit":
            visits += 1
            daily[day]["visits"] += 1
            device_c[r["device"]] += 1
            orient_c[r["orient"]] += 1
            ref_c[r["ref"] or "(direct)"] += 1
        elif typ == "run_start":
            run_starts += 1
            s["runs"] += 1
            daily[day]["runs"] += 1
            input_c[d.get("input", "unknown")] += 1
        elif typ == "run_end":
            runs.append(d)
            reason_c[d.get("reason", "unknown")] += 1
        elif typ == "hs_submit":
            hs_submits += 1

    sessions = list(sess.values())
    durations = [(s["end"] - s["start"]) / 1000 for s in sessions]
    engaged = [s for s in sessions if s["runs"] > 0]
    new_visitors = [v for v in visitors if first_seen.get(v, 0) >= start_ms]
    returning_visitors = len(visitors) - len(new_visitors)

    secs = [x["secs"] for x in runs if "secs" in x]
    waves = [x["wave"] for x in runs if "wave" in x]
    scores = [x["score"] for x in runs if "score" in x]

    wave_buckets = Counter()
    for w in waves:
        b = ("1-2" if w <= 2 else "3-4" if w <= 4 else "5-9" if w <= 9 else
             "10-19" if w <= 19 else "20-49" if w <= 49 else "50+")
        wave_buckets[b] += 1
    bucket_order = ["1-2", "3-4", "5-9", "10-19", "20-49", "50+"]

    # ---- retention (all-time cohorts, so it is meaningful even for short ranges)
    active_days = defaultdict(set)
    for r in vday_rows:
        active_days[r["vid"]].add(_day(r["ts"]))
    today = _day(now_ms)
    d1_elig = d1_ret = d7_elig = d7_ret = 0
    for vid, f in first_seen.items():
        fd = _day(f)
        days_set = active_days.get(vid, set())
        if fd + timedelta(days=1) < today:  # D+1 fully elapsed
            d1_elig += 1
            d1_ret += (fd + timedelta(days=1)) in days_set
        if fd + timedelta(days=7) < today:
            d7_elig += 1
            d7_ret += any(fd + timedelta(days=k) in days_set for k in range(1, 8))

    # ---- daily series (fill gaps)
    series_days = []
    if rows or nginx:
        firsts = ([rows[0]["ts"]] if rows else []) + ([nginx[0]["ts"]] if nginx else [])
        first_day = _day(min(firsts))
        if days:
            first_day = max(first_day, _day(start_ms))
        dcur = first_day
        while dcur <= today:
            series_days.append(dcur.isoformat())
            dcur += timedelta(days=1)

    nginx_daily = defaultdict(lambda: {"views": 0, "visitors": set()})
    nginx_ref = Counter()
    for h in nginx:
        dd = _day(h["ts"]).isoformat()
        nginx_daily[dd]["views"] += 1
        nginx_daily[dd]["visitors"].add(h["visitor_hash"])
        nginx_ref[h["ref"] or "(direct)"] += 1

    series = [{
        "day": dd,
        "visits": daily[dd]["visits"] if dd in daily else 0,
        "visitors": len(daily[dd]["visitors"]) if dd in daily else 0,
        "new_visitors": len(daily[dd]["new"]) if dd in daily else 0,
        "sessions": len(daily[dd]["sessions"]) if dd in daily else 0,
        "runs": daily[dd]["runs"] if dd in daily else 0,
        "log_views": nginx_daily[dd]["views"] if dd in nginx_daily else 0,
        "log_visitors": len(nginx_daily[dd]["visitors"]) if dd in nginx_daily else 0,
    } for dd in series_days]

    return {
        "range": range_key,
        "generated_at": now_ms,
        "tracking_started_at": tracking_start,
        "kpis": {
            "visits": visits,
            "sessions": len(sessions),
            "unique_visitors": len(visitors),
            "new_visitors": len(new_visitors),
            "returning_visitors": returning_visitors,
            "avg_session_secs": round(sum(durations) / len(durations), 1) if durations else None,
            "median_session_secs": _median(durations),
            "gameplay_sessions": len(engaged),
            "engaged_session_pct": _pct(len(engaged), len(sessions)),
            "runs_started": run_starts,
            "runs_finished": len(runs),
            "runs_per_engaged_session": round(run_starts / len(engaged), 2) if engaged else None,
            "avg_run_secs": round(sum(secs) / len(secs), 1) if secs else None,
            "median_run_secs": _median(secs),
            "median_wave": _median(waves),
            "max_wave": max(waves) if waves else None,
            "median_score": _median(scores),
            "reach_wave5_pct": _pct(sum(w >= 5 for w in waves), len(waves)),
            "reach_wave10_pct": _pct(sum(w >= 10 for w in waves), len(waves)),
            "hs_submits": hs_submits,
            "hs_submit_pct": _pct(hs_submits, len(runs)),
            "d1_retention_pct": _pct(d1_ret, d1_elig), "d1_cohort": d1_elig,
            "d7_retention_pct": _pct(d7_ret, d7_elig), "d7_cohort": d7_elig,
        },
        "breakdowns": {
            "device": dict(device_c),
            "orientation": dict(orient_c),
            "input": dict(input_c),
            "run_end_reason": dict(reason_c),
            "referrers": ref_c.most_common(10),
            "wave_buckets": [[b, wave_buckets.get(b, 0)] for b in bucket_order],
        },
        "history": {
            "log_page_views": len(nginx),
            "log_unique_visitors": len({h["visitor_hash"] for h in nginx}),
            "log_referrers": nginx_ref.most_common(10),
            "log_coverage": {"from": nginx_bounds[0], "to": nginx_bounds[1], "rows": nginx_bounds[2]},
        },
        "series": series,
    }


@router.get("/api/admin/stats")
def stats(request: Request, range: str = "7d"):
    require_admin(request)
    if range not in RANGES:
        raise HTTPException(400, "range must be one of 24h, 7d, 30d, all")
    return compute_stats(range)
