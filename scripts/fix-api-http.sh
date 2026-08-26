#!/usr/bin/env bash
set -euo pipefail
BE="$HOME/academic-portal/backend/.env"

if grep -q '^AP_ALLOW_INSECURE_HTTP=' "$BE"; then
  sed -i 's|^AP_ALLOW_INSECURE_HTTP=.*|AP_ALLOW_INSECURE_HTTP=true|' "$BE"
else
  echo 'AP_ALLOW_INSECURE_HTTP=true' >> "$BE"
fi

if grep -q '^AP_SESSION_SECURE=' "$BE"; then
  sed -i 's|^AP_SESSION_SECURE=.*|AP_SESSION_SECURE=false|' "$BE"
else
  echo 'AP_SESSION_SECURE=false' >> "$BE"
fi

grep -E '^(NODE_ENV|PORT|CORS_ORIGIN|AP_SESSION_SECURE|AP_ALLOW_INSECURE_HTTP)=' "$BE"

cd "$HOME/academic-portal/backend"
pm2 restart backend --update-env 2>/dev/null || pm2 restart academic-api --update-env
sleep 4
pm2 status
pm2 logs backend --lines 25 --nostream 2>/dev/null || pm2 logs academic-api --lines 25 --nostream
curl -s -w '\nhealth=%{http_code}\n' http://127.0.0.1:4000/api/health | head -c 400
echo
curl -s -o /dev/null -w 'nginx_api=%{http_code}\n' http://127.0.0.1/api/health
