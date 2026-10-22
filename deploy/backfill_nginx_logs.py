#!/usr/bin/env python3
"""
Import historical page views from Nginx access logs into analytics.db (nginx_hits).

Usage:  python3 backfill_nginx_logs.py /var/log/nginx/access.log*   (plain or .gz)

- Expects the Nginx default "combined" log format.
- Idempotent: each log line is keyed by a SHA-256 of its raw text, so re-runs skip duplicates.
- Shared-log safe: the Droplet's default access.log may contain other sites. A "/" page view is
  only counted when the same IP+UA also requested a Robo Survivors-specific asset that day
  (game.js, style.css, a game .wav, or /api/scores). Bots/crawlers are dropped.
- Raw IPs are never stored: visitor_hash = sha256(salt + ip + ua + day), salt kept in the DB.
"""
import gzip
import hashlib
import os
import re
import secrets
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime

DB_PATH = os.environ.get("RS_ANALYTICS_DB", "/var/lib/robosurvivors/analytics.db")

LINE_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] "(?P<method>[A-Z]+) (?P<path>\S+)[^"]*" '
    r'(?P<status>\d{3}) \S+ "(?P<ref>[^"]*)" "(?P<ua>[^"]*)"'
)
BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|curl|wget|python|httpx|go-http|java/|headless|scan|monitor|"
    r"uptime|preview|facebookexternalhit|embedly|discordbot|whatsapp|telegram|zgrab|masscan|"
    r"nmap|censys|expanse|okhttp|axios|node-fetch|libwww|semrush|ahrefs|bing|yandex|baidu|petal",
    re.I,
)
ROBO_ASSET_RE = re.compile(
    r"^/(game\.js|style\.css|rescue\.wav|smartbomb-award\.wav|wave5\.wav|stompy-[a-z]+\.wav|api/scores)(\?|$)"
)
PAGE_RE = re.compile(r"^/(index\.html)?(\?.*)?$")


def device_of(ua):
    if re.search(r"iPad|Tablet", ua):
        return "tablet"
    if re.search(r"Mobi|Android|iPhone|iPod", ua):
        return "mobile"
    return "desktop"


def ref_host(ref):
    m = re.match(r"^https?://([^/:?#]+)", ref.lower())
    if not m:
        return ""
    h = m.group(1)
    h = h[4:] if h.startswith("www.") else h
    return "" if h in ("robosurvivors.com", "robosurvivors.org") else h[:80]


def open_log(p):
    return gzip.open(p, "rt", errors="replace") if p.endswith(".gz") else open(p, errors="replace")


def main(paths):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")
    row = conn.execute("SELECT v FROM meta WHERE k='log_salt'").fetchone()
    salt = row[0] if row else secrets.token_hex(16)
    if not row:
        conn.execute("INSERT INTO meta VALUES ('log_salt', ?)", (salt,))

    parsed = bad = bots = 0
    pages = []                       # candidate page views
    robo_days = set()                # (ip, ua, day) that fetched robo-specific assets
    for p in paths:
        if not os.path.isfile(p):
            continue
        with open_log(p) as f:
            for line in f:
                m = LINE_RE.match(line)
                if not m:
                    bad += 1
                    continue
                parsed += 1
                ua = m["ua"]
                if not ua or BOT_RE.search(ua):
                    bots += 1
                    continue
                if m["method"] != "GET" or m["status"] not in ("200", "304"):
                    continue
                try:
                    dt = datetime.strptime(m["time"], "%d/%b/%Y:%H:%M:%S %z")
                except ValueError:
                    bad += 1
                    continue
                day = dt.date().isoformat()
                key = (m["ip"], ua, day)
                if ROBO_ASSET_RE.match(m["path"]):
                    robo_days.add(key)
                if PAGE_RE.match(m["path"]):
                    pages.append((line, dt, key, m["path"], int(m["status"]), m["ref"], ua))

    inserted = skipped_other_site = 0
    for line, dt, key, path, status, ref, ua in pages:
        if key not in robo_days:
            skipped_other_site += 1
            continue
        ip, ua_, day = key
        cur = conn.execute(
            "INSERT OR IGNORE INTO nginx_hits(line_hash,ts,visitor_hash,path,status,ref,device) VALUES (?,?,?,?,?,?,?)",
            (
                hashlib.sha256(line.encode()).hexdigest(),
                int(dt.timestamp() * 1000),
                hashlib.sha256(f"{salt}|{ip}|{ua_}|{day}".encode()).hexdigest(),
                path.split("?")[0],
                status,
                ref_host(ref),
                device_of(ua_),
            ),
        )
        inserted += cur.rowcount
    conn.commit()
    lo, hi, total = conn.execute("SELECT MIN(ts), MAX(ts), COUNT(*) FROM nginx_hits").fetchone()
    fmt = lambda ms: datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d") if ms else "-"
    print(f"  lines parsed: {parsed:,}  unparseable: {bad:,}  bot/crawler lines dropped: {bots:,}")
    print(f"  page-view candidates: {len(pages):,}  not Robo Survivors (other site/no game assets): {skipped_other_site:,}")
    print(f"  newly imported page views: {inserted:,}  total in DB: {total:,}  coverage: {fmt(lo)} -> {fmt(hi)}")


if __name__ == "__main__":
    main(sys.argv[1:])
