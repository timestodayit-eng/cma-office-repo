#!/bin/sh
# Add (or change) one site on the shared proxy, with its own HTTPS certificate.
#
#   sh add-site.sh <domain> <where>
#
# <where> is one of:
#   container:port     a Docker container on the "web" network     e.g.  cma-office-web:3000
#   localhost:port     a program running straight on the VPS        e.g.  localhost:8080
#   static             plain HTML files in  www/<domain>/  (index.html ...)
#   redirect:URL       send visitors to another address             e.g.  redirect:https://example.com
#
# Examples:
#   sh add-site.sh office.example.com cma-office-web:3000
#   sh add-site.sh shop.example.com localhost:8080
#   sh add-site.sh example.com static
#   sh add-site.sh www.example.com redirect:https://example.com
set -e
cd "$(dirname "$0")"
DOMAIN="$1"; WHERE="$2"
if [ -z "$DOMAIN" ] || [ -z "$WHERE" ]; then sed -n '2,19p' "$0"; exit 1; fi
case "$DOMAIN" in *[!a-zA-Z0-9.-]*) echo "Domain looks wrong: $DOMAIN"; exit 1;; esac

FILE="sites/$DOMAIN.caddy"
case "$WHERE" in
  static)
    mkdir -p "www/$DOMAIN"
    [ -f "www/$DOMAIN/index.html" ] || echo "<h1>$DOMAIN</h1><p>Site is ready. Put your files in $(pwd)/www/$DOMAIN</p>" > "www/$DOMAIN/index.html"
    BODY="	root * /srv/www/$DOMAIN
	file_server"
    ;;
  redirect:*)
    BODY="	redir ${WHERE#redirect:}{uri} permanent"
    ;;
  localhost:*|127.0.0.1:*)
    BODY="	reverse_proxy host.docker.internal:${WHERE#*:}"
    ;;
  *:*)
    BODY="	reverse_proxy $WHERE"
    ;;
  *) echo "Don't understand <where>: $WHERE"; exit 1;;
esac

printf '%s {\n\tencode gzip\n%s\n}\n' "$DOMAIN" "$BODY" > "$FILE"
echo "Wrote $FILE"
if docker ps --format '{{.Names}}' | grep -qx proxy; then
  docker exec proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "Done. In a minute open: https://$DOMAIN  (the domain's DNS A record must point at this VPS)"
else
  echo "Proxy is not running yet. Start it:  cd $(pwd) && docker compose up -d"
fi
