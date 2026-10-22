#!/bin/bash
# ROBO SURVIVORS — server deploy for the analytics + admin portal.
# Run by /usr/local/sbin/robo-deploy (after git pull). Safe to re-run.
# stdin (optional): first line = PBKDF2 admin password hash (from the GitHub secret).
set -euo pipefail
WEB=/var/www/robosurvivors
DATA=/var/lib/robosurvivors
ETC=/etc/robosurvivors
SVC=robo-leaderboard
PREV_COMMIT=${PREV_COMMIT:-}
NGINX_CONF=$(grep -lE "root $WEB/?;" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 || true)

rollback() {
  echo "✗ Deploy failed — rolling back"
  if [ -n "$PREV_COMMIT" ]; then (cd $WEB && git reset --hard --quiet "$PREV_COMMIT") && echo "  code reset to $PREV_COMMIT"; fi
  [ -f /tmp/robosurvivors-nginx.bak ] && [ -n "$NGINX_CONF" ] && cp /tmp/robosurvivors-nginx.bak "$NGINX_CONF" && nginx -t -q && systemctl reload nginx && echo "  nginx config restored"
  systemctl restart $SVC || true
}
trap rollback ERR

echo "=== [1/6] Secrets + data dirs"
install -d -m 700 $ETC $DATA
HASH=""
if [ ! -t 0 ]; then read -r HASH || true; fi
if [[ "$HASH" == pbkdf2_sha256\$* ]]; then
  (umask 077; printf 'RS_ADMIN_PASSWORD_HASH=%s\n' "$HASH" > $ETC/admin.env)
  echo "  ✓ admin password hash written to $ETC/admin.env (root-only)"
elif [ -f $ETC/admin.env ]; then echo "  ✓ keeping existing $ETC/admin.env"
else echo "  ✗ no admin hash supplied and none on disk"; false; fi

echo "=== [2/6] systemd drop-in"
install -d /etc/systemd/system/$SVC.service.d
cat > /etc/systemd/system/$SVC.service.d/analytics.conf <<UNIT
[Service]
EnvironmentFile=$ETC/admin.env
Environment=RS_ANALYTICS_DB=$DATA/analytics.db
UNIT
systemctl daemon-reload
systemctl restart $SVC
sleep 2
systemctl is-active --quiet $SVC
echo "  ✓ $SVC restarted"

echo "=== [3/6] Nginx hardening + /admin"
[ -n "$NGINX_CONF" ] || { echo "  ✗ no nginx site with root $WEB"; false; }
cp "$NGINX_CONF" /tmp/robosurvivors-nginx.bak
install -m 644 $WEB/deploy/nginx-hardening.conf /etc/nginx/snippets/robosurvivors-hardening.conf
if ! grep -q "robosurvivors-hardening.conf" "$NGINX_CONF"; then
  sed -i "s#^\(\s*\)root $WEB/\?;#&\n\1include /etc/nginx/snippets/robosurvivors-hardening.conf;#" "$NGINX_CONF"
fi
echo "  include lines: $(grep -c robosurvivors-hardening.conf "$NGINX_CONF") in $NGINX_CONF"
nginx -t -q
systemctl reload nginx
echo "  ✓ nginx reloaded"

echo "=== [4/6] Backfill history from Nginx logs"
$WEB/.venv/bin/python $WEB/deploy/backfill_nginx_logs.py /var/log/nginx/access.log* || echo "  ! backfill reported an error (non-fatal)"

echo "=== [5/6] Verify"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check() { local want=$1 got=$2 what=$3; if [ "$got" = "$want" ]; then echo "  ✓ $what → $got"; else echo "  ✗ $what → $got (want $want)"; false; fi; }
check 200 "$(code https://robosurvivors.com/)" "game page"
check 200 "$(code https://robosurvivors.com/api/scores/health)" "leaderboard health"
check 200 "$(code https://robosurvivors.com/admin/)" "admin page"
check 401 "$(code https://robosurvivors.com/api/admin/stats)" "stats without login"
check 404 "$(code https://robosurvivors.com/.git/HEAD)" ".git blocked"
check 404 "$(code https://robosurvivors.com/leaderboard.py)" "server code blocked"
check 404 "$(code https://robosurvivors.com/scores.json)" "raw scores file blocked"
check 200 "$(code -X POST https://robosurvivors.com/api/events -H 'Content-Type: text/plain' --data '{"vid":"deploycheck0001","sid":"deploycheck0001","events":[]}')" "event endpoint"
check 401 "$(code -X POST https://robosurvivors.com/api/admin/login -H 'Content-Type: text/plain' --data '{"password":"__deploy_check_wrong__"}')" "login rejects wrong password"
"$WEB/.venv/bin/python" - <<'PY'
import sqlite3; c=sqlite3.connect('/var/lib/robosurvivors/analytics.db'); c.execute("DELETE FROM login_failures WHERE ip IN ('127.0.0.1','104.236.239.46')"); c.commit()
PY

trap - ERR
echo "=== [6/6] DONE — deployed $(cd $WEB && git rev-parse --short HEAD)"
