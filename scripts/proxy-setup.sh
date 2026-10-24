#!/usr/bin/env bash
#
# proxy-setup.sh — detect the web server fronting this VPS and PRINT the exact
# reverse-proxy + TLS commands to put lodeprop.com in front of the Lode app.
#
# It changes NOTHING. It reads which server owns 80/443 and emits a copy-paste
# block tailored to it, so a box already serving other sites is never touched
# until you run the printed commands yourself.
#
# Usage:   bash scripts/proxy-setup.sh [domain] [port]
# Example: bash scripts/proxy-setup.sh lodeprop.com 3000
set -euo pipefail

DOMAIN="${1:-lodeprop.com}"
PORT="${2:-3000}"
UP="http://127.0.0.1:${PORT}"

say() { printf '%s\n' "$*"; }
rule() { say "------------------------------------------------------------"; }

say ""
say "Lode reverse-proxy setup for ${DOMAIN}  ->  ${UP}"
rule

# --- what owns 80/443, and what is installed ------------------------------
say "Listening on 80/443:"
(ss -tlnp 2>/dev/null | grep -E ':80 |:443 ') || say "  (could not read; run with sudo for process names)"
say ""

HAS_NGINX=0; HAS_APACHE=0; HAS_OLS=0
command -v nginx >/dev/null 2>&1 && HAS_NGINX=1
[ -d /etc/nginx ] && HAS_NGINX=1
{ command -v apache2 >/dev/null 2>&1 || command -v httpd >/dev/null 2>&1; } && HAS_APACHE=1
{ [ -d /etc/apache2 ] || [ -d /etc/httpd ]; } && HAS_APACHE=1
[ -d /usr/local/lsws ] && HAS_OLS=1

DETECTED=""
[ "$HAS_OLS" = 1 ] && DETECTED="${DETECTED} openlitespeed"
[ "$HAS_NGINX" = 1 ] && DETECTED="${DETECTED} nginx"
[ "$HAS_APACHE" = 1 ] && DETECTED="${DETECTED} apache"
DETECTED="${DETECTED# }"

say "Detected: ${DETECTED:-none}"
rule

if [ "$HAS_OLS" = 1 ]; then
  say "### OpenLiteSpeed / CyberPanel ###"
  say "Mostly in the panel — do these, then paste the vHost context below:"
  say ""
  say "1. Websites -> Create Website -> ${DOMAIN}"
  say "2. Manage -> SSL -> Issue SSL (Let's Encrypt)"
  say "3. Manage -> vHost Conf -> paste this, then Save:"
  say ""
  cat <<EOF
extprocessor lode {
  type        proxy
  address     127.0.0.1:${PORT}
  maxConns    100
  initTimeout 60
  retryTimeout 0
  respBuffer  0
}
context / {
  type    proxy
  handler lode
  addDefaultCharset off
}
EOF
  say ""
  say "4. Restart:   systemctl restart lsws"
  rule
fi

if [ "$HAS_NGINX" = 1 ]; then
  # Debian/Ubuntu use sites-available; RHEL uses conf.d.
  if [ -d /etc/nginx/sites-available ]; then
    CONF="/etc/nginx/sites-available/${DOMAIN}.conf"
    ENABLE="ln -sf ${CONF} /etc/nginx/sites-enabled/${DOMAIN}.conf"
  else
    CONF="/etc/nginx/conf.d/${DOMAIN}.conf"
    ENABLE="# (conf.d is auto-included; no symlink needed)"
  fi
  say "### nginx ###"
  say "Write the server block:"
  say ""
  cat <<EOF
sudo tee ${CONF} >/dev/null <<'CONF'
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    location / {
        proxy_pass ${UP};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF
${ENABLE}
sudo nginx -t && sudo systemctl reload nginx
EOF
  say ""
  say "Then issue TLS (free, auto-renewing):"
  say "  sudo apt install -y certbot python3-certbot-nginx 2>/dev/null || sudo dnf install -y certbot python3-certbot-nginx"
  say "  sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
  rule
fi

if [ "$HAS_APACHE" = 1 ]; then
  if [ -d /etc/apache2 ]; then
    CONF="/etc/apache2/sites-available/${DOMAIN}.conf"
    ENABLE="sudo a2enmod proxy proxy_http headers && sudo a2ensite ${DOMAIN} && sudo systemctl reload apache2"
    CERT="sudo apt install -y certbot python3-certbot-apache && sudo certbot --apache -d ${DOMAIN} -d www.${DOMAIN}"
  else
    CONF="/etc/httpd/conf.d/${DOMAIN}.conf"
    ENABLE="sudo systemctl reload httpd   # proxy modules are usually built in on RHEL"
    CERT="sudo dnf install -y certbot python3-certbot-apache && sudo certbot --apache -d ${DOMAIN} -d www.${DOMAIN}"
  fi
  say "### Apache ###"
  say "Write the virtual host:"
  say ""
  cat <<EOF
sudo tee ${CONF} >/dev/null <<'CONF'
<VirtualHost *:80>
    ServerName ${DOMAIN}
    ServerAlias www.${DOMAIN}
    ProxyPreserveHost On
    ProxyPass        / ${UP}/
    ProxyPassReverse / ${UP}/
    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
CONF
${ENABLE}
EOF
  say ""
  say "Then issue TLS (free, auto-renewing):"
  say "  ${CERT}"
  rule
fi

if [ -z "${DETECTED}" ]; then
  say "No web server detected on this box."
  say "If nothing else serves 80/443, you can let the app's own Caddy do TLS"
  say "(see docs/DEPLOY-HOSTINGER.md). Otherwise install nginx and re-run this."
  rule
fi

say "Final check after you run the above:"
say "  curl -sI https://${DOMAIN}/api/health   # expect HTTP/2 200 + valid cert"
say ""
