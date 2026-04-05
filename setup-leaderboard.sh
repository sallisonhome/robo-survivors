#!/bin/bash
# ROBO SURVIVORS — Leaderboard Setup Script
# Run this on the Droplet as root

set -e

echo "=== Installing Python dependencies ==="
pip3 install fastapi uvicorn 2>/dev/null || pip install fastapi uvicorn

echo "=== Creating scores file ==="
touch /var/www/robosurvivors/scores.json
echo "[]" > /var/www/robosurvivors/scores.json
chmod 666 /var/www/robosurvivors/scores.json

echo "=== Creating systemd service ==="
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

echo "=== Starting leaderboard service ==="
systemctl daemon-reload
systemctl enable robo-leaderboard
systemctl start robo-leaderboard

echo "=== Updating Nginx config ==="
# Add API proxy to existing robosurvivors config
cat > /etc/nginx/sites-available/robosurvivors << 'NGINX'
server {
    listen 80;
    server_name robosurvivors.com www.robosurvivors.com robosurvivors.org www.robosurvivors.org;

    root /var/www/robosurvivors;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.(js|css|wav|png|jpg|ico)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

nginx -t && systemctl reload nginx

echo "=== Re-running certbot to update SSL config ==="
certbot --nginx -d robosurvivors.com -d www.robosurvivors.com -d robosurvivors.org -d www.robosurvivors.org --non-interactive --agree-tos

echo ""
echo "=== DONE! ==="
echo "Test: curl http://localhost:8090/api/scores/health"
echo "Leaderboard API is live at /api/scores"
