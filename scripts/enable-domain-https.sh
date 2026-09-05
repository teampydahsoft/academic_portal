#!/usr/bin/env bash
# Point Academic Portal at acad.pydah.edu.in and enable HTTPS (Let's Encrypt).
# Run on the Lightsail host: bash ~/academic-portal/scripts/enable-domain-https.sh
set -euo pipefail

DOMAIN="${DOMAIN:-acad.pydah.edu.in}"
APP="${APP_DIR:-$HOME/academic-portal}"
BE="$APP/backend/.env"
FE="$APP/frontend/.env.local"
EMAIL="${LETSENCRYPT_EMAIL:-}"

upsert() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

echo "==> Patching env for https://${DOMAIN}"
upsert "$BE" "CORS_ORIGIN" "https://${DOMAIN}"
upsert "$BE" "AP_SESSION_SECURE" "true"
upsert "$BE" "AP_ALLOW_INSECURE_HTTP" "false"
upsert "$FE" "NEXT_PUBLIC_API_BASE_URL" "https://${DOMAIN}/api"
echo "ENV_PATCHED"

echo "==> Nginx HTTP vhost for ${DOMAIN}"
sudo tee /etc/nginx/conf.d/academic-portal.conf >/dev/null <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN};
    client_max_body_size 20M;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;
        proxy_pass_header Set-Cookie;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

sudo mkdir -p /var/www/certbot
sudo rm -f /etc/nginx/conf.d/default.conf || true
sudo nginx -t
sudo systemctl reload nginx
echo "NGINX_HTTP_OK"

echo "==> Install certbot if needed"
if ! command -v certbot >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y certbot python3-certbot-nginx || sudo dnf install -y certbot
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y certbot python3-certbot-nginx || sudo amazon-linux-extras install -y epel || true
    sudo yum install -y certbot python3-certbot-nginx || true
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y certbot python3-certbot-nginx
  fi
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "ERROR: certbot not installed. Open Lightsail firewall TCP 443, install certbot, re-run."
  exit 1
fi

echo "==> Request / renew Let's Encrypt certificate"
CERTBOT_ARGS=(certonly --webroot -w /var/www/certbot -d "${DOMAIN}" --agree-tos --non-interactive --keep-until-expiring)
if [ -n "${EMAIL}" ]; then
  CERTBOT_ARGS+=(--email "${EMAIL}")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
fi
sudo certbot "${CERTBOT_ARGS[@]}"

LIVE="/etc/letsencrypt/live/${DOMAIN}"
if ! sudo test -f "${LIVE}/fullchain.pem" || ! sudo test -f "${LIVE}/privkey.pem"; then
  echo "ERROR: certificate files missing under ${LIVE}"
  exit 1
fi

echo "==> Nginx HTTPS vhost for ${DOMAIN}"
sudo tee /etc/nginx/conf.d/academic-portal.conf >/dev/null <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN};
    client_max_body_size 20M;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};
    client_max_body_size 20M;

    ssl_certificate     ${LIVE}/fullchain.pem;
    ssl_certificate_key ${LIVE}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Cookie \$http_cookie;
        proxy_pass_header Set-Cookie;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

sudo nginx -t
sudo systemctl reload nginx
echo "NGINX_HTTPS_OK"

# Renew timer (best-effort)
sudo systemctl enable --now certbot-renew.timer 2>/dev/null || \
  (sudo crontab -l 2>/dev/null | grep -q certbot || \
    (sudo crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | sudo crontab -) || true

echo "==> Rebuild frontend (NEXT_PUBLIC_* baked at build time) + restart PM2"
cd "$APP/frontend"
npm run build

cd "$APP/backend"
pm2 delete backend >/dev/null 2>&1 || true
pm2 delete frontend >/dev/null 2>&1 || true
pm2 delete academic-api >/dev/null 2>&1 || true
pm2 delete academic-web >/dev/null 2>&1 || true

pm2 start ./node_modules/tsx/dist/cli.mjs --name backend --time -- src/index.ts
cd "$APP/frontend"
pm2 start npm --name frontend --time -- start
pm2 save
pm2 status

sleep 3
curl -fsS -o /dev/null -w "local_api=%{http_code}\n" http://127.0.0.1:4000/api/health
curl -fsS -o /dev/null -w "https_web=%{http_code}\n" "https://${DOMAIN}/" || true
curl -fsS -o /dev/null -w "https_api=%{http_code}\n" "https://${DOMAIN}/api/health" || true
echo "DOMAIN_HTTPS_OK https://${DOMAIN}"
