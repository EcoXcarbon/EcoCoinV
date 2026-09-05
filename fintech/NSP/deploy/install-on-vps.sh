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
mkdir -p /var/www/certbot
CONF=/etc/nginx/sites-available/$DOMAIN
CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem

install_conf() {   # $1 = filename under deploy/
  cp "deploy/$1" "$CONF"
  sed -i "s/nsp\.ppmc\.pk/$DOMAIN/g" "$CONF"
  # The TLS vhost assumes the SNI multiplexer used on the ppmc.pk VPS
  # (nginx.conf stream block -> 127.0.0.1:8443, proxy_protocol). On a host
  # without one, terminate TLS on :443 directly instead.
  if ! grep -q ssl_preread /etc/nginx/nginx.conf 2>/dev/null; then
    sed -i 's|listen 127.0.0.1:8443 ssl proxy_protocol;|listen 443 ssl;\n    listen [::]:443 ssl;|' "$CONF"
  fi
  ln -sf "$CONF" /etc/nginx/sites-enabled/$DOMAIN
  nginx -t && systemctl reload nginx
}

if [ -f "$CERT" ]; then
  install_conf nsp.ppmc.pk.conf
else
  # No certificate yet: the TLS vhost would fail nginx -t, so start on HTTP
  # only. This also keeps /.well-known/acme-challenge/ served from disk rather
  # than proxied to the app, which is what certbot needs to validate.
  install_conf nsp.ppmc.pk.bootstrap.conf
fi

echo "== TLS (Let's Encrypt) =="
if [ -f "$CERT" ]; then
  echo "certificate already present for $DOMAIN — expires $(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2)"
elif getent hosts "$DOMAIN" >/dev/null; then
  apt-get install -y certbot >/dev/null
  # webroot, not --nginx: the nginx plugin would write its own "listen 443 ssl"
  # block, which the SNI multiplexer never routes to.
  if certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
       --non-interactive --agree-tos --register-unsafely-without-email; then
    install_conf nsp.ppmc.pk.conf
    echo "TLS enabled for https://$DOMAIN"
  else
    echo "certbot failed — site is serving over HTTP. Check $DOMAIN resolves to this server, then rerun this script."
  fi
else
  echo "DNS for $DOMAIN does not resolve yet. Add an A record -> $(curl -s -4 ifconfig.me), then rerun this script to obtain the certificate."
fi

echo "== Done: $DOMAIN  (registry desk key is in $APP/.env) =="
