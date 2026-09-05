#!/usr/bin/env bash
# Installs / updates the NSP registry on the VPS as https://nsp.ppmc.pk
# Run as root on the VPS after the NSP folder has been uploaded to /opt/nsp
#   bash /opt/nsp/deploy/install-on-vps.sh
set -euo pipefail
DOMAIN="${DOMAIN:-nsp.ppmc.pk}"
APP=/opt/nsp

echo "== Node.js 22 =="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== System user & files =="
id -u nsp >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin nsp
mkdir -p "$APP/data"
cd "$APP"
npm ci --no-audit --no-fund

if [ ! -f .env ]; then
  KEY=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
  cat > .env <<ENV
PORT=4100
HOST=127.0.0.1
NSP_PUBLIC_URL=https://$DOMAIN
NSP_ISSUER_COUNTRY=PK
NSP_ISSUER_NAME=National Skill Passport Registry
NSP_ISSUER_SHORT=NSP Registry
NSP_ISSUER_AUTHORITY=Power Planning & Monitoring Company (PPMC) — TalentLedger
NSP_ISSUER_DID=did:web:$DOMAIN
NSP_CARD_VALIDITY_YEARS=5
NSP_REGISTRY_KEYS=registrar:$KEY
NSP_CORS_ORIGINS=https://$DOMAIN
NSP_RATE_LIMIT=60
ENV
  echo "Generated registry key (save it): $KEY"
fi
chown -R nsp:nsp "$APP"
chmod 600 .env

echo "== systemd =="
cp deploy/nsp-registry.service /etc/systemd/system/nsp-registry.service
systemctl daemon-reload
systemctl enable --now nsp-registry
systemctl restart nsp-registry
sleep 2
curl -fsS http://127.0.0.1:4100/api/v1/health && echo

echo "== nginx =="
apt-get install -y nginx >/dev/null
cp deploy/nsp.ppmc.pk.conf /etc/nginx/sites-available/$DOMAIN
sed -i "s/nsp.ppmc.pk/$DOMAIN/g" /etc/nginx/sites-available/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx

echo "== TLS (Let's Encrypt) =="
if getent hosts "$DOMAIN" >/dev/null; then
  apt-get install -y certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "certbot failed — check that $DOMAIN points to this server, then rerun: certbot --nginx -d $DOMAIN"
else
  echo "DNS for $DOMAIN does not resolve yet. Add an A record -> $(curl -s ifconfig.me), then run: certbot --nginx -d $DOMAIN"
fi

echo "== Done: http://$DOMAIN  (registry desk key is in $APP/.env) =="
