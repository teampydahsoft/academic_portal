#!/usr/bin/env bash
set -euo pipefail

IP="13.204.83.221"
APP="$HOME/academic-portal"
BE="$APP/backend/.env"
FE="$APP/frontend/.env.local"

upsert() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

upsert "$BE" "NODE_ENV" "production"
upsert "$BE" "PORT" "4000"
upsert "$BE" "CORS_ORIGIN" "http://${IP}"
upsert "$BE" "AP_SESSION_SECURE" "false"
upsert "$FE" "NEXT_PUBLIC_API_BASE_URL" "http://${IP}/api"
echo "ENV_PATCHED"

cd "$APP/backend"
npm install
echo "BACKEND_DEPS_OK"

cd "$APP/frontend"
npm install
npm run build
echo "FRONTEND_BUILT"

sudo tee /etc/nginx/conf.d/academic-portal.conf >/dev/null <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 20M;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Cookie $http_cookie;
        proxy_pass_header Set-Cookie;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

sudo rm -f /etc/nginx/conf.d/default.conf || true
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
echo "NGINX_OK"

cd "$APP/backend"
pm2 delete academic-api >/dev/null 2>&1 || true
pm2 start ./node_modules/tsx/dist/cli.mjs --name academic-api --time -- src/index.ts

cd "$APP/frontend"
pm2 delete academic-web >/dev/null 2>&1 || true
pm2 start npm --name academic-web --time -- start

pm2 save
STARTUP_CMD=$(pm2 startup systemd -u ec2-user --hp /home/ec2-user | grep -E 'sudo .*pm2' || true)
if [ -n "${STARTUP_CMD:-}" ]; then
  eval "$STARTUP_CMD" || true
fi
pm2 status
echo "PM2_OK"

sleep 3
curl -s -o /dev/null -w "api_health_http=%{http_code}\n" http://127.0.0.1:4000/api/health || true
curl -s -o /dev/null -w "web_http=%{http_code}\n" http://127.0.0.1:3000/ || true
curl -s -o /dev/null -w "nginx_http=%{http_code}\n" http://127.0.0.1/ || true
echo "DEPLOY_DONE"
