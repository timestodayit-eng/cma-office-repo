#!/bin/sh
# Take a site off the shared proxy:   sh remove-site.sh <domain>
# (Its files in www/<domain> are kept.)
set -e
cd "$(dirname "$0")"
[ -n "$1" ] || { echo "Usage: sh remove-site.sh <domain>"; exit 1; }
rm -f "sites/$1.caddy"
docker exec proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "Removed $1. Sites now:"; ls sites | sed -n 's/\.caddy$//p'
