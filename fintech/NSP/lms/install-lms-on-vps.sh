#!/usr/bin/env bash
# Brings NSP Learning up at nsp.ppmc.pk/lms. Idempotent: safe to re-run.
#
# Run as root on the VPS, from /opt/nsp-lms (the deploy script does this):
#   BUILD=1 bash /opt/nsp-lms/install-lms-on-vps.sh
set -euo pipefail

ROOT=/opt/nsp-lms
BUILD=${BUILD:-1}
cd "$ROOT"

# ── secrets ──────────────────────────────────────────────────────────────────
# Generated once and then left alone, so a redeploy never invalidates every
# learner's session or makes previously encrypted fields unreadable.
if [ ! -f .env ]; then
  echo "== generating compose secrets =="
  cat > .env <<EOF
MONGO_ROOT_USER=nsp_lms
MONGO_ROOT_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
CLIENT_URL=https://nsp.ppmc.pk/lms
EOF
  chmod 600 .env
fi

if [ ! -f server/.env ]; then
  echo "== generating application secrets =="
  cp server/.env.example server/.env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" server/.env
  sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" server/.env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" server/.env
  sed -i "s|^CSRF_SECRET=.*|CSRF_SECRET=$(openssl rand -hex 32)|" server/.env
  # Reuse the registry's mailbox so invitations and password resets work from
  # the first minute; NSP_SMTP_PASS is the same account.
  if [ -f /opt/nsp/.env ]; then
    PASS=$(grep -E '^NSP_SMTP_PASS=' /opt/nsp/.env | cut -d= -f2- || true)
    [ -n "$PASS" ] && sed -i "s|^SMTP_PASS=.*|SMTP_PASS=${PASS}|" server/.env
  fi
  chmod 600 server/.env
fi

# ── containers ───────────────────────────────────────────────────────────────
COMPOSE="docker compose"
$COMPOSE version >/dev/null 2>&1 || COMPOSE="docker-compose"

if [ "$BUILD" = "1" ]; then
  echo "== building images (this takes a few minutes) =="
  $COMPOSE build
fi
echo "== starting =="
$COMPOSE up -d

# ── nginx ────────────────────────────────────────────────────────────────────
# The /lms location lives in the registry's vhost, which install-on-vps.sh
# installs. Only reload here; deploying the registry is what puts it in place.
if grep -q "location /lms/" /etc/nginx/sites-available/nsp.ppmc.pk 2>/dev/null; then
  nginx -t && systemctl reload nginx
  echo "== nginx reloaded =="
else
  echo "!! /etc/nginx/sites-available/nsp.ppmc.pk has no /lms location."
  echo "   Deploy the registry (deploy-from-windows.ps1) to install it, then re-run this."
fi

# ── wait for health ──────────────────────────────────────────────────────────
echo "== waiting for the API =="
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3010/lms/api/health >/dev/null 2>&1; then
    echo "   healthy after ${i}s"
    break
  fi
  sleep 1
  [ "$i" = "60" ] && { echo "   API did not come up; recent logs:"; $COMPOSE logs --tail=40 server; }
done

echo "== Done: https://nsp.ppmc.pk/lms/ =="
$COMPOSE ps
