#!/usr/bin/env bash
# Redeploy Academic Portal on the Lightsail host (used by GitHub Actions + manual SSH).
# Does NOT overwrite backend/.env or frontend/.env.local.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/academic-portal}"
cd "$APP_DIR"

echo "==> Backend deps"
cd "$APP_DIR/backend"
npm install --no-audit --no-fund

echo "==> Frontend deps + production build"
cd "$APP_DIR/frontend"
npm install --no-audit --no-fund
npm run build

echo "==> Restart PM2"
mkdir -p "$HOME/.pm2"
cd "$APP_DIR/backend"
pm2 delete academic-api >/dev/null 2>&1 || true
pm2 start ./node_modules/tsx/dist/cli.mjs --name academic-api --time -- src/index.ts

cd "$APP_DIR/frontend"
pm2 delete academic-web >/dev/null 2>&1 || true
pm2 start npm --name academic-web --time -- start

pm2 save
pm2 status

echo "==> Health checks"
sleep 3
curl -fsS -o /dev/null -w "api=%{http_code}\n" http://127.0.0.1:4000/api/health
curl -fsS -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3000/ || true
curl -fsS -o /dev/null -w "nginx=%{http_code}\n" http://127.0.0.1/ || true

echo "DEPLOY_OK"
