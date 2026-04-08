#!/bin/bash
# ROBO SURVIVORS — Leaderboard Setup Script
# Run on the Droplet as root: sudo bash setup-leaderboard.sh
#
# Safe to re-run — won't overwrite existing scores or break SSL config.

set -e

echo "=== [1/5] Installing Python dependencies ==="
pip3 install fastapi uvicorn 2>/dev/null || pip install fastapi uvicorn
echo "  ✓ FastAPI + Uvicorn installed"

echo ""
echo "=== [2/5] Creating scores file ==="
if [ ! -f /var/www/robosurvivors/scores.json ]; then
    echo "[]" > /var/www/robosurvivors/scores.json
    echo "  ✓ Created new scores.json"
else
    echo "  ✓ scores.json already exists — leaving it alone"
fi
chmod 666 /var/www/robosurvivors/scores.json

echo ""
echo "=== [3/5] Creating systemd service ==="
cat > /etc/systemd/system/robo-leaderboard.service << 'EOF'
[Unit]
Description=ROBO SURVIVORS Leaderboard API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/robosurvivors
ExecStart=/usr/bin/python3 -m uvicorn leaderboard:app --host 127.0.0.1 --port 8090
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable robo-leaderboard
systemctl restart robo-leaderboard
echo "  ✓ robo-leaderboard service started"
sleep 2

# Verify the service is running
if systemctl is-active --quiet robo-leaderboard; then
    echo "  ✓ Service is running"
    curl -sf http://127.0.0.1:8090/api/scores/health && echo ""
else
    echo "  ✗ Service failed to start! Check: journalctl -u robo-leaderboard"
    exit 1
fi

echo ""
echo "=== [4/5] Updating Nginx config ==="
NGINX_CONF="/etc/nginx/sites-available/robosurvivors"

# Check if /api/ location block already exists
if grep -q "location /api/" "$NGINX_CONF" 2>/dev/null; then
    echo "  ✓ /api/ proxy block already exists in Nginx config"
else
    # Insert the /api/ location block before the first 'location /' block
    # This is safe because Nginx matches location blocks by specificity
    sed -i '/location \/ {/i\
    # Leaderboard API proxy\
    location /api/ {\
        proxy_pass http://127.0.0.1:8090;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
        proxy_read_timeout 10s;\
    }\
' "$NGINX_CONF"
    echo "  ✓ Added /api/ proxy block to Nginx config"
fi

# Test and reload
echo "  Testing Nginx config..."
if nginx -t 2>&1; then
    systemctl reload nginx
    echo "  ✓ Nginx reloaded"
else
    echo "  ✗ Nginx config test failed! Check the config manually:"
    echo "    nano $NGINX_CONF"
    exit 1
fi

echo ""
echo "=== [5/5] Verifying ==="
echo -n "  Local API:  "
curl -sf http://127.0.0.1:8090/api/scores/health && echo ""
echo -n "  Via Nginx:  "
curl -sf http://127.0.0.1/api/scores/health && echo ""
echo ""
echo "=== ALL DONE ==="
echo "Leaderboard API is live at /api/scores"
echo "  GET  /api/scores        — fetch scores"
echo "  POST /api/scores        — submit score"
echo "  GET  /api/scores/health — health check"
echo ""
echo "Useful commands:"
echo "  systemctl status robo-leaderboard"
echo "  journalctl -u robo-leaderboard -f"
echo "  curl https://robosurvivors.com/api/scores/health"
